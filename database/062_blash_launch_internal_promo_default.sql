-- 062: A new number entered in Blash is allowed by the owner's default
-- promotion switch unless the number opted out or the owner excluded it.
-- Do not invent customer consent evidence or require a self-test.
-- Campaign start remains owner-initiated and performs one-time reservation.
-- No WhatsApp message is sent by this migration.
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
   if r.phone !~ '^[1-9][0-9]{7,14}$' then
    update mc_campaign_recipients set excluded_reason='INVALID_PHONE' where id=r.id;continue;
   end if;
   if r.opted_out_at is not null or r.owner_promo_disabled then
    update mc_campaign_recipients
       set excluded_reason=case when r.opted_out_at is not null then 'OPT_OUT'
                                else 'OWNER_PROMO_DISABLED' end
     where id=r.id;
    continue;
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
  then raise exception 'Tidak ada nomor tujuan yang bisa diproses. Periksa nomor duplikat, opt-out, dan pengecualian.';end if;
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
end $function$;

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
  UPDATE public.mc_campaigns SET is_test=true,steps=v_steps WHERE id=p_id;
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
$function$;

