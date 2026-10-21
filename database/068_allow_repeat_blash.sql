-- 068: Allow the same phone in different Blash campaigns. Preserve job-level idempotency,
-- contact permission, opt-outs, media checks, worker checks and historical send records.
BEGIN;
create or replace function public.mc_campaign_action_before_ai_reply_preflight(p_id uuid,p_action text,p_schedule timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c mc_campaigns%rowtype;r record;s jsonb;i integer;v_status text;v_video boolean;v_image boolean;
begin
 select * into c from mc_campaigns where id=p_id for update;
 if c.id is null then raise exception 'Kampanye tidak ditemukan';end if;
 if p_action in('START','SCHEDULE','RESUME')then
  if not exists(select 1 from mc_campaign_runtime where session_name=c.session_name and last_seen>now()-interval '90 seconds')
  then raise exception 'Worker kampanye belum terhubung untuk sesi aktif';end if;
  v_image:=exists(select 1 from jsonb_array_elements(c.steps) img where img->>'type'='IMAGE');
  if v_image and not exists(select 1 from mc_campaign_runtime rt
    where rt.session_name=c.session_name and rt.image_supported and rt.last_seen>now()-interval '90 seconds')
  then raise exception 'Pengirim poster WAHA sendImage belum aktif di n8n. Perbarui workflow outbound sebelum mengirim uji.';end if;
  v_video:=exists(select 1 from jsonb_array_elements(c.steps) vid where vid->>'type'='VIDEO');
  if v_video and not c.is_test
  and not exists(select 1 from mc_campaign_runtime where session_name=c.session_name
    and video_supported and last_seen>now()-interval '90 seconds')
  and not(
    c.test_campaign_id is not null and
    exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and
      media_url is not null and status='SENT' and nullif(provider_message_id,'') is not null)
    and not exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and status<>'SENT')
  )then raise exception 'Uji video ke WhatsApp sendiri hingga diterima gateway sebelum kampanye massal';end if;
 end if;
 if p_action in('START','SCHEDULE')then
  if not c.is_test and not(c.test_campaign_id is not null and exists(
   select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id)
   and not exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and status<>'SENT'))
  then raise exception 'Kirim uji dan pastikan pesan uji diterima gateway terlebih dahulu';end if;
  if c.status not in('DRAFT','SCHEDULED')then return jsonb_build_object('ok',true,'status',c.status);end if;
  if p_action='SCHEDULE' and (p_schedule is null or p_schedule<=now())then raise exception 'Pilih waktu mendatang';end if;
  for r in select cr.*,cc.consent,cc.opted_out_at
   from mc_campaign_recipients cr join mc_campaign_contacts cc on cc.phone=cr.phone
   where cr.campaign_id=c.id loop
   if r.excluded_reason is not null then continue;end if;
   if not r.consent or r.opted_out_at is not null then
    update mc_campaign_recipients set excluded_reason='Tidak memiliki izin promosi' where id=r.id;continue;
   end if;
   if exists(select 1 from mc_contact_exclusions ex where ex.phone=r.phone)then
    update mc_campaign_recipients set excluded_reason='Pengecualian owner' where id=r.id;continue;
   end if;
   i:=0;
   for s in select value from jsonb_array_elements(c.steps)loop
    i:=i+1;
    insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,campaign_id,recipient_id,step_no,media_url)
    values(r.phone||'@c.us',replace(s->>'body','{{nama}}',r.name),
    'CAMPAIGN','campaign:'||c.id||':'||r.id||':'||i,c.id,r.id,i,
    case when s->>'type' in('VIDEO','IMAGE') then s->>'media_url'end) on conflict(idempotency_key)do nothing;
   end loop;
   insert into mc_opportunities(chat_id,product_id,campaign_id)
   values(r.phone||'@c.us',c.product_id,c.id)on conflict(chat_id,product_id)do nothing;
  end loop;
  if not exists(select 1 from mc_outbound_jobs where campaign_id=c.id)
  then raise exception 'Tidak ada penerima dengan izin promosi yang tidak dikecualikan';end if;
  v_status:=case when p_action='SCHEDULE' then 'SCHEDULED' else 'RUNNING' end;
  update mc_campaigns set status=v_status,scheduled_at=case when p_action='SCHEDULE'then p_schedule else now()end,updated_at=now() where id=c.id;
 elsif p_action='PAUSE' and c.status in('RUNNING','SCHEDULED')then update mc_campaigns set status='PAUSED',updated_at=now()where id=c.id;
 elsif p_action='RESUME' and c.status='PAUSED'then update mc_campaigns set status='RUNNING',updated_at=now()where id=c.id;
 elsif p_action='CANCEL' and c.status not in('COMPLETED','CANCELLED')then
  update mc_campaigns set status='CANCELLED',updated_at=now()where id=c.id;
  update mc_outbound_jobs set status='CANCELLED'where campaign_id=c.id and status in('PENDING','RETRY');
 else raise exception 'Perubahan status tidak diizinkan';end if;
 insert into mc_campaign_audit(campaign_id,action)values(c.id,p_action);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.mc_campaign_readiness_before_ai_reply_preflight(p_id uuid)
returns jsonb
language sql stable security definer set search_path=public
as $$
 select jsonb_build_object(
  'recipient_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id),
  'eligible_total',(select count(*)
   from mc_campaign_recipients r join mc_campaign_contacts cc on cc.phone=r.phone
   where r.campaign_id=c.id and r.excluded_reason is null and cc.consent=true
    and cc.opted_out_at is null
    and not exists(select 1 from mc_contact_exclusions e where e.phone=r.phone)),
  'excluded_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id and r.excluded_reason is not null),
  'already_blasted_total',0,
  'test_status',case
   when c.test_campaign_id is null then 'NOT_SENT'
   when not exists(select 1 from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id) then 'NOT_SENT'
   when exists(select 1 from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id and j.status<>'SENT')
    then coalesce((select j.status from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id and j.status<>'SENT' order by j.step_no limit 1),'PENDING')
   else 'SENT' end,
  'has_image',exists(select 1 from jsonb_array_elements(c.steps) step where step->>'type'='IMAGE'),
  'image_supported',exists(select 1 from mc_campaign_runtime rt where rt.session_name=c.session_name and rt.image_supported and rt.last_seen>now()-interval '90 seconds'),
  'has_video',exists(select 1 from jsonb_array_elements(c.steps) step where step->>'type'='VIDEO'),
  'video_supported',exists(select 1 from mc_campaign_runtime runtime
   where runtime.session_name=c.session_name and runtime.video_supported=true
   and runtime.last_seen>now()-interval '90 seconds'),
  'worker_online',exists(select 1 from mc_campaign_runtime runtime
   where runtime.session_name=c.session_name and runtime.last_seen>now()-interval '90 seconds')
 ) from mc_campaigns c where c.id=p_id
$$;

CREATE OR REPLACE FUNCTION public.mc_campaign_action(
 p_id uuid,p_action text,p_schedule timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $act$
DECLARE
 c public.mc_campaigns%rowtype;
 v jsonb;
 v_steps jsonb;
 v_video_supported boolean;
 v_video_skipped boolean:=false;
BEGIN
 SELECT * INTO c FROM public.mc_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Kampanye tidak ditemukan'; END IF;
 IF p_action IN('START','SCHEDULE','RESUME') AND NOT c.is_test THEN
  IF p_action IN('START','SCHEDULE') AND c.status IN('DRAFT','SCHEDULED') THEN
   UPDATE public.mc_campaign_recipients cr
     SET excluded_reason='INVALID_PHONE'
     WHERE cr.campaign_id=p_id AND cr.excluded_reason IS NULL
       AND cr.phone !~ '^[1-9][0-9]{7,14}$';
   UPDATE public.mc_campaign_recipients cr
     SET excluded_reason='OWNER_PROMO_DISABLED'
     FROM public.mc_campaign_contacts cc
     WHERE cr.phone=cc.phone AND cr.campaign_id=p_id
       AND cr.excluded_reason IS NULL AND cc.owner_promo_disabled;
   UPDATE public.mc_campaign_recipients cr
     SET excluded_reason='OPT_OUT'
     FROM public.mc_campaign_contacts cc
     WHERE cr.phone=cc.phone AND cr.campaign_id=p_id
       AND cr.excluded_reason IS NULL AND cc.opted_out_at IS NOT NULL;
   -- Owner permission is a dispatch setting, not an assertion of customer opt-in.
   -- Keep legacy consent-compatible workers functioning; never override opt-out.
   UPDATE public.mc_campaign_contacts cc SET
     consent=true,consent_at=coalesce(cc.consent_at,now()),
     consent_evidence=coalesce(nullif(cc.consent_evidence,''),
        'OWNER_DISPATCH_POLICY_NOT_CUSTOMER_OPT_IN'),updated_at=now()
    FROM public.mc_campaign_recipients cr
    WHERE cr.campaign_id=p_id AND cr.phone=cc.phone
      AND cr.excluded_reason IS NULL AND cc.opted_out_at IS NULL
      AND NOT cc.owner_promo_disabled
      AND NOT EXISTS (SELECT 1 FROM public.mc_contact_exclusions ex WHERE ex.phone=cc.phone);
  END IF;
  v_video_supported:=EXISTS(
      SELECT 1 FROM public.mc_campaign_runtime rt
      WHERE rt.session_name=c.session_name AND rt.video_supported
        AND rt.last_seen>now()-interval '90 seconds');
  v_video_skipped:=NOT v_video_supported AND EXISTS(
      SELECT 1 FROM jsonb_array_elements(c.steps) el WHERE el->>'type'='VIDEO');
  -- Unsupported videos are omitted; their nonempty captions become text.
  SELECT coalesce(jsonb_agg(
      CASE WHEN step.value->>'type'='VIDEO' AND NOT v_video_supported
        THEN jsonb_build_object('type','TEXT','body',step.value->>'body')
        ELSE step.value END ORDER BY step.ord),'[]'::jsonb)
   INTO v_steps
   FROM jsonb_array_elements(c.steps) WITH ORDINALITY AS step(value,ord)
   WHERE step.value->>'type'<>'VIDEO' OR v_video_supported
       OR btrim(coalesce(step.value->>'body',''))<>'';
  IF jsonb_array_length(v_steps)=0 AND p_action IN('START','SCHEDULE')
    THEN RAISE EXCEPTION 'UNSUPPORTED_MEDIA: video tidak tersedia dan tidak ada teks/poster untuk dikirim'; END IF;
  UPDATE public.mc_campaigns SET is_test=true,steps=v_steps WHERE id=p_id;
  v:=public.mc_campaign_action_before_direct_send(p_id,p_action,p_schedule);
  UPDATE public.mc_campaigns SET is_test=false,steps=c.steps WHERE id=p_id;
  IF v_video_skipped THEN
   INSERT INTO public.mc_campaign_audit(campaign_id,action,detail)
     VALUES(p_id,'UNSUPPORTED_VIDEO_SKIPPED',jsonb_build_object(
       'reason','WAHA_VIDEO_UNSUPPORTED','text_and_images_continue',true));
  END IF;
  RETURN v||jsonb_build_object('direct_contact_send',true,
    'video_skipped',v_video_skipped,'one_time_reservation',false,'repeat_recipients_allowed',true);
 END IF;
 RETURN public.mc_campaign_action_before_direct_send(p_id,p_action,p_schedule);
END;
$act$;

-- 065: Show only recipients with recorded permission as send-ready; avoid
-- misleading counts when the legacy sender gate will reject staged numbers.
CREATE OR REPLACE FUNCTION public.mc_campaign_readiness(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(public.mc_campaign_readiness_before_ai_reply_preflight(p_id), '{}'::jsonb)
  || jsonb_build_object(
   'eligible_total', (
     SELECT count(*)
     FROM public.mc_campaign_recipients r
     JOIN public.mc_campaign_contacts cc ON cc.phone = r.phone
     WHERE r.campaign_id = p_id
       AND r.excluded_reason IS NULL
       AND r.phone ~ '^[1-9][0-9]{7,14}$'
       AND cc.opted_out_at IS NULL
       AND cc.consent = true
       AND NOT cc.owner_promo_disabled
       AND NOT EXISTS (
         SELECT 1 FROM public.mc_contact_exclusions e
         WHERE e.phone = r.phone
       )
   ),
   'staged_total', (
     SELECT count(*)
     FROM public.mc_campaign_recipients r
     JOIN public.mc_campaign_contacts cc ON cc.phone = r.phone
     WHERE r.campaign_id = p_id AND cc.source = 'CAMPAIGN_ONLY_STAGED'
   ),
   'campaign_ai_enabled', coalesce((
     SELECT bot_enabled FROM public.mc_campaigns WHERE id = p_id
   ), false),
   'ai_auto_reply_ready', public.mc_bot_enabled() AND coalesce((
     SELECT (value #>> '{}')::boolean
     FROM public.bot_settings WHERE key = 'ai_auto_reply'
   ), false)
  );
$function$;


-- 066: Record an owner's declaration of an actual prior customer opt-in
-- for all eligible staged recipients in ONE draft. This does not send WhatsApp,
-- start a campaign, change an opt-out, or re-authorize a disabled contact.
CREATE OR REPLACE FUNCTION public.mc_campaign_record_permission(
 p_id uuid,p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_count int;
BEGIN
 IF length(trim(coalesce(p_source,''))) NOT BETWEEN 12 AND 500
   OR trim(p_source) IN (
     'OWNER_DISPATCH_POLICY_NOT_CUSTOMER_OPT_IN',
     'Owner mengizinkan Blash langsung untuk kontak bernomor WhatsApp'
   )
 THEN RAISE EXCEPTION 'Sumber persetujuan pelanggan perlu dijelaskan'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mc_campaigns c
    WHERE c.id=p_id AND c.status='DRAFT' FOR UPDATE)
 THEN RAISE EXCEPTION 'Hanya draft yang dapat mencatat sumber izin'; END IF;
 UPDATE public.mc_campaign_contacts cc
 SET consent=true,
     consent_evidence=trim(p_source),
     consent_at=coalesce(cc.consent_at,now()),
     updated_at=now()
 FROM public.mc_campaign_recipients r
 WHERE r.campaign_id=p_id AND r.phone=cc.phone
   AND r.excluded_reason IS NULL
   AND r.phone ~ '^[1-9][0-9]{7,14}$'
   AND cc.source='CAMPAIGN_ONLY_STAGED'
   AND cc.opted_out_at IS NULL
   AND NOT cc.owner_promo_disabled
   AND NOT EXISTS(SELECT 1 FROM public.mc_contact_exclusions x WHERE x.phone=r.phone);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 INSERT INTO public.mc_campaign_audit(campaign_id,action,detail)
 VALUES(p_id,'OWNER_RECORDED_CUSTOMER_OPTIN_SOURCE',
   jsonb_build_object('count',v_count,'evidence_source',left(trim(p_source),500)));
 RETURN jsonb_build_object('ok',true,'recorded',v_count);
END;
$fn$;
REVOKE ALL ON FUNCTION public.mc_campaign_record_permission(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_campaign_record_permission(uuid,text) TO service_role;


-- Release only the old lifetime restriction on editable drafts. Keep all other exclusions
-- and completed/cancelled history intact. No campaign is started by this migration.
UPDATE public.mc_campaign_recipients r SET excluded_reason=NULL
FROM public.mc_campaigns c
WHERE c.id=r.campaign_id AND c.status='DRAFT'
  AND r.excluded_reason='Sudah pernah masuk Blash lain';
COMMENT ON FUNCTION public.mc_campaign_readiness(uuid) IS
 'Eligible contacts may receive new campaigns repeatedly; per-campaign job idempotency and contact permission checks remain enforced.';

NOTIFY pgrst,'reload schema';
COMMIT;
