-- 061: Align direct Blash launch, sender claim and preflight with readiness.
-- New numbers are recorded as CAMPAIGN_ONLY_STAGED, which intentionally has
-- consent=false (no customer consent fabricated). That MUST NOT be interpreted
-- as the owner's internal per-contact permission gate.
-- In all paths still enforce opt-out, admin exclusions, invalid phone,
-- prior one-time reservations, live sender availability and active products.
-- The campaign's AI replies remain OFF; no WhatsApp sends in this migration.
CREATE OR REPLACE FUNCTION public.mc_campaign_action_before_ai_reply_preflight(p_id uuid, p_action text, p_schedule timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if c.status not in('DRAFT','SCHEDULED')then return jsonb_build_object('ok',true,'status',c.status);end if;
  if p_action='SCHEDULE' and (p_schedule is null or p_schedule<=now())then raise exception 'Pilih waktu mendatang';end if;
  for r in select cr.*,cc.opted_out_at,cc.owner_promo_disabled
   from mc_campaign_recipients cr join mc_campaign_contacts cc on cc.phone=cr.phone
   where cr.campaign_id=c.id loop
   if r.excluded_reason is not null then continue;end if;
   if r.phone !~ '^[1-9][0-9]{7,14}
   if exists(select 1 from mc_contact_exclusions ex where ex.phone=r.phone)then
    update mc_campaign_recipients set excluded_reason='Pengecualian owner' where id=r.id;continue;
   end if;
   -- Serialize one-time Blash ownership by the normalized phone, across all campaigns.
   -- Test campaigns bypass this marketing reservation.
   if not c.is_test then
    insert into mc_campaign_one_time_phones(phone,campaign_id)
    values(r.phone,c.id) on conflict(phone)do nothing;
    if not exists(select 1 from mc_campaign_one_time_phones once
      where once.phone=r.phone and once.campaign_id=c.id)then
     update mc_campaign_recipients set excluded_reason='Sudah pernah masuk Blash lain' where id=r.id;
     continue;
    end if;
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
  then raise exception 'Tidak ada nomor tujuan yang dapat dikirim: periksa nomor duplikat, opt-out, atau pengecualian';end if;
  v_status:=case when p_action='SCHEDULE' then 'SCHEDULED' else 'RUNNING' end;
  update mc_campaigns set status=v_status,scheduled_at=case when p_action='SCHEDULE'then p_schedule else now()end,updated_at=now() where id=c.id;
 elsif p_action='PAUSE' and c.status in('RUNNING','SCHEDULED')then update mc_campaigns set status='PAUSED',updated_at=now()where id=c.id;
 elsif p_action='RESUME' and c.status='PAUSED'then update mc_campaigns set status='RUNNING',updated_at=now()where id=c.id;
 elsif p_action='CANCEL' and c.status not in('COMPLETED','CANCELLED')then
  update mc_campaigns set status='CANCELLED',updated_at=now()where id=c.id;
  update mc_outbound_jobs set status='CANCELLED'where campaign_id=c.id and status in('PENDING','RETRY');
  -- Release only untouched reservations; ambiguous or previously processed sends stay protected.
  delete from mc_campaign_one_time_phones once where once.campaign_id=c.id
   and not exists(select 1 from mc_outbound_jobs job
     where job.campaign_id=c.id and split_part(job.chat_id,'@',1)=once.phone
       and job.status<>'CANCELLED');
 else raise exception 'Perubahan status tidak diizinkan';end if;
 insert into mc_campaign_audit(campaign_id,action)values(c.id,p_action);
 return jsonb_build_object('ok',true);
end $function$
 then
    update mc_campaign_recipients set excluded_reason='INVALID_PHONE' where id=r.id;continue;
   end if;
   if r.opted_out_at is not null or r.owner_promo_disabled then
    update mc_campaign_recipients set excluded_reason=case when r.opted_out_at is not null then 'OPT_OUT' else 'OWNER_PROMO_DISABLED' end where id=r.id;continue;
   end if;
   if exists(select 1 from mc_contact_exclusions ex where ex.phone=r.phone)then
    update mc_campaign_recipients set excluded_reason='Pengecualian owner' where id=r.id;continue;
   end if;
   -- Serialize one-time Blash ownership by the normalized phone, across all campaigns.
   -- Test campaigns bypass this marketing reservation.
   if not c.is_test then
    insert into mc_campaign_one_time_phones(phone,campaign_id)
    values(r.phone,c.id) on conflict(phone)do nothing;
    if not exists(select 1 from mc_campaign_one_time_phones once
      where once.phone=r.phone and once.campaign_id=c.id)then
     update mc_campaign_recipients set excluded_reason='Sudah pernah masuk Blash lain' where id=r.id;
     continue;
    end if;
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
  -- Release only untouched reservations; ambiguous or previously processed sends stay protected.
  delete from mc_campaign_one_time_phones once where once.campaign_id=c.id
   and not exists(select 1 from mc_outbound_jobs job
     where job.campaign_id=c.id and split_part(job.chat_id,'@',1)=once.phone
       and job.status<>'CANCELLED');
 else raise exception 'Perubahan status tidak diizinkan';end if;
 insert into mc_campaign_audit(campaign_id,action)values(c.id,p_action);
 return jsonb_build_object('ok',true);
end $function$
;

CREATE OR REPLACE FUNCTION public.mc_campaign_action(p_id uuid, p_action text, p_schedule timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 c public.mc_campaigns%rowtype;
 rec record;
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
   FOR rec IN
      SELECT cr.id,cr.phone FROM public.mc_campaign_recipients cr
      JOIN public.mc_campaign_contacts cc ON cc.phone=cr.phone
      WHERE cr.campaign_id=p_id AND cr.excluded_reason IS NULL
        AND cc.opted_out_at IS NULL AND NOT cc.owner_promo_disabled
        AND NOT EXISTS(SELECT 1 FROM public.mc_contact_exclusions ex WHERE ex.phone=cr.phone)
      ORDER BY cr.phone
   LOOP
    INSERT INTO public.mc_campaign_one_time_phones(phone,campaign_id)
    VALUES(rec.phone,p_id) ON CONFLICT(phone) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.mc_campaign_one_time_phones one
        WHERE one.phone=rec.phone AND one.campaign_id=p_id) THEN
      UPDATE public.mc_campaign_recipients
        SET excluded_reason='Sudah pernah masuk Blash lain' WHERE id=rec.id;
    END IF;
   END LOOP;
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
  -- Explicit Blash dispatch is independent from AI reply settings.
  UPDATE public.mc_campaigns SET is_test=true,steps=v_steps,bot_enabled=false WHERE id=p_id;
  v:=public.mc_campaign_action_before_direct_send(p_id,p_action,p_schedule);
  UPDATE public.mc_campaigns SET is_test=false,steps=c.steps WHERE id=p_id;
  IF v_video_skipped THEN
   INSERT INTO public.mc_campaign_audit(campaign_id,action,detail)
     VALUES(p_id,'UNSUPPORTED_VIDEO_SKIPPED',jsonb_build_object(
       'reason','WAHA_VIDEO_UNSUPPORTED','text_and_images_continue',true));
  END IF;
  RETURN v||jsonb_build_object('direct_contact_send',true,
    'video_skipped',v_video_skipped,'one_time_reservation',true);
 END IF;
 RETURN public.mc_campaign_action_before_direct_send(p_id,p_action,p_schedule);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mc_claim_outbound_v2(p_worker text DEFAULT 'n8n-v2'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j mc_outbound_jobs%rowtype;
begin
 perform mc_live_test_context();
 perform mc_recover_expired_jobs();
 update mc_outbound_jobs o set status='CANCELLED'where o.kind='CAMPAIGN'and o.status in('PENDING','RETRY')and exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status in('FAILED','CANCELLED')); 
 update mc_outbound_jobs o set status='CANCELLED'from mc_lead_state l where o.chat_id=l.chat_id and o.kind<>'MANUAL'and o.status in('PENDING','RETRY')and(l.human_takeover_until>now()or(l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')and o.kind in('CAMPAIGN','FOLLOW_UP')));
 update mc_outbound_jobs o set status='CANCELLED'from mc_campaign_contacts cc where o.kind in('CAMPAIGN','FOLLOW_UP')and o.chat_id=cc.phone||'@c.us'and o.status in('PENDING','RETRY')and(cc.opted_out_at is not null or cc.owner_promo_disabled
  or (o.kind='FOLLOW_UP' and not cc.consent)
  or exists(select 1 from mc_contact_exclusions ex where ex.phone=cc.phone));
 update mc_campaigns c set status='COMPLETED',updated_at=now()where c.status in('RUNNING','PAUSED')and exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id)and not exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id and o.status in('PENDING','RETRY','PROCESSING','UNKNOWN'));
 update mc_campaigns set status='RUNNING'where status='SCHEDULED'and scheduled_at<=now();
 select o.* into j from mc_outbound_jobs o left join mc_campaigns c on c.id=o.campaign_id
 where (o.kind in('MANUAL','CAMPAIGN') or mc_reply_allowed(o.chat_id)) and o.account_id=mc_active_account() and o.status in('PENDING','RETRY')and(o.next_retry_at is null or o.next_retry_at<=now())
 and (o.kind='MANUAL'or(o.kind<>'CAMPAIGN'and mc_bot_enabled())or(o.kind='CAMPAIGN'and c.status='RUNNING'))
 and not exists(select 1 from mc_outbound_jobs busy where busy.chat_id=o.chat_id and busy.status='PROCESSING')
 and (o.kind<>'CAMPAIGN'or not exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status<>'SENT'))
 order by case when o.kind='MANUAL'then 0 when o.kind='AI_REPLY'then 1 when o.kind='FOLLOW_UP'then 2 else 3 end,o.created_at
 for update of o skip locked limit 1;
 if j.id is null then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(j.chat_id,0))then return null;end if;
 if exists(select 1 from mc_outbound_jobs where chat_id=j.chat_id and status='PROCESSING')then return null;end if;
 update mc_outbound_jobs set status='PROCESSING',locked_at=now(),locked_by=p_worker,attempt_count=attempt_count+1 where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('job_id',j.id,'session_name',coalesce((select session_name from mc_campaigns where id=j.campaign_id),'default'));
end$function$
;

CREATE OR REPLACE FUNCTION public.mc_campaign_preflight_exclusion_base(p_job_id uuid, p_attempt integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j mc_outbound_jobs%rowtype;v_ok boolean;
begin
 if not pg_try_advisory_xact_lock(hashtextextended((select chat_id from mc_outbound_jobs where id=p_job_id),0))then update mc_outbound_jobs set status='RETRY',next_retry_at=now()+interval '2 seconds',locked_at=null,locked_by=null where id=p_job_id and status='PROCESSING'and attempt_count=p_attempt;return jsonb_build_object('allowed',false);end if;
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING'or j.attempt_count<>p_attempt then return jsonb_build_object('allowed',false);end if;
 if j.inbound_event_id is not null and j.kind in('AI_REPLY','FOLLOW_UP')and exists(select 1 from mc_inbound_events newer join mc_inbound_events original on original.id=j.inbound_event_id where newer.chat_id=j.chat_id and not newer.from_me and not newer.is_group and newer.received_at>original.received_at)then update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null where id=j.id;return jsonb_build_object('allowed',false);end if;
 v_ok:=j.kind='MANUAL'or not exists(select 1 from mc_lead_state where chat_id=j.chat_id and human_takeover_until>now());
 if j.kind='CAMPAIGN'then
  v_ok:=v_ok and exists(select 1 from mc_campaigns where id=j.campaign_id and status='RUNNING')and exists(select 1 from mc_campaign_contacts where phone=split_part(j.chat_id,'@',1) and opted_out_at is null and not owner_promo_disabled)and not exists(select 1 from mc_campaign_recipients where id=j.recipient_id and replied_at is not null)
   and not exists(select 1 from mc_contact_exclusions ex where ex.phone=split_part(j.chat_id,'@',1))
   and exists(select 1 from mc_campaigns c where c.id=j.campaign_id
     and (c.is_test or exists(select 1 from mc_campaign_one_time_phones used where used.phone=split_part(j.chat_id,'@',1) and used.campaign_id=c.id)));
 else v_ok:=v_ok and(j.kind='MANUAL'or mc_bot_enabled());
  if j.kind='FOLLOW_UP' then v_ok:=v_ok and not exists(select 1 from mc_campaign_contacts where phone=split_part(j.chat_id,'@',1)and(not consent or opted_out_at is not null));end if;
 end if;
 if not v_ok then update mc_outbound_jobs set status=case when j.kind='CAMPAIGN'and exists(select 1 from mc_campaigns where id=j.campaign_id and status='PAUSED')then 'PENDING'else 'CANCELLED'end,locked_at=null,locked_by=null where id=j.id;end if;
 return jsonb_build_object('allowed',v_ok);
end$function$
;

