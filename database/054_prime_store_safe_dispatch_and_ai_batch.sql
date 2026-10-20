-- 054: PRIME STORE safe campaign dedupe, AI claim cap, queue diagnostics.
-- Does not dispatch messages, re-claim jobs, or change bot ON/OFF.
INSERT INTO public.bot_settings(key,value,description)
VALUES('ai_max_concurrency','4'::jsonb,'Maksimum AI PROCESSING untuk account aktif')
ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mc_claim_ai_job(p_worker text DEFAULT 'n8n'::text)
 RETURNS TABLE(job_id uuid, inbound_event_id uuid, job_kind text, attempt_count integer, requested_model text, chat_id text, message_text text, external_message_id text, inbound_payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE chosen uuid;v_chat text;ids uuid[];jobs uuid[];
BEGIN
 PERFORM mc_live_test_context();
 IF NOT mc_bot_enabled() OR NOT coalesce(
  (SELECT (value #>> '{}')::boolean FROM public.bot_settings WHERE key='ai_auto_reply'),false
 ) THEN RETURN; END IF;
 -- Serialize claim decisions for this account, not the AI provider calls.
 PERFORM pg_advisory_xact_lock(hashtextextended('AI_CAP:' || mc_active_account(),0));
 IF (SELECT count(*) FROM public.mc_ai_jobs aj
      JOIN public.mc_inbound_events ae ON ae.id=aj.inbound_event_id
      WHERE aj.status='PROCESSING' AND ae.account_id=mc_active_account()) >=
      coalesce((SELECT (value #>> '{}')::int FROM public.bot_settings WHERE key='ai_max_concurrency'),4)
 THEN RETURN; END IF;
 SELECT j.id,e.chat_id INTO chosen,v_chat FROM mc_ai_jobs j
 JOIN mc_inbound_events e ON e.id=j.inbound_event_id JOIN mc_lead_state l ON l.chat_id=e.chat_id
 WHERE j.status IN('PENDING','RETRY') AND (j.next_retry_at IS NULL OR j.next_retry_at<=now())
 AND e.account_id=mc_active_account() AND l.account_id=e.account_id AND mc_reply_allowed(e.chat_id)
 AND (l.human_takeover_until IS NULL OR l.human_takeover_until<=now())
 AND NOT EXISTS(SELECT 1 FROM mc_ai_jobs busy JOIN mc_inbound_events be ON be.id=busy.inbound_event_id
  WHERE be.chat_id=e.chat_id AND busy.status='PROCESSING')
 AND NOT EXISTS(SELECT 1 FROM mc_ai_jobs newer JOIN mc_inbound_events ne ON ne.id=newer.inbound_event_id
  WHERE ne.chat_id=e.chat_id AND ne.account_id=e.account_id AND newer.status IN('PENDING','RETRY')
  AND (ne.received_at,ne.id)>(e.received_at,e.id))
 AND (e.received_at<=clock_timestamp()-interval '1200 milliseconds' OR
  EXISTS(SELECT 1 FROM mc_ai_jobs first_job JOIN mc_inbound_events fe ON fe.id=first_job.inbound_event_id
   WHERE fe.chat_id=e.chat_id AND fe.account_id=e.account_id AND first_job.status='PENDING'
   AND first_job.created_at<=clock_timestamp()-interval '8 seconds'))
 AND pg_try_advisory_xact_lock(hashtextextended(e.chat_id,0))
 ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF chosen IS NULL THEN RETURN; END IF;
 -- Recheck after locking: concurrent pollers cannot both claim the same contact.
 IF EXISTS(SELECT 1 FROM mc_ai_jobs b JOIN mc_inbound_events be ON be.id=b.inbound_event_id
  WHERE be.chat_id=v_chat AND b.status='PROCESSING') THEN RETURN; END IF;
 SELECT array_agg(j.id) INTO jobs FROM mc_ai_jobs j JOIN mc_inbound_events e ON e.id=j.inbound_event_id
 WHERE e.chat_id=v_chat AND e.account_id=mc_active_account() AND j.status IN('PENDING','RETRY')
 AND (j.next_retry_at IS NULL OR j.next_retry_at<=now());
 SELECT array_agg(DISTINCT event_id) INTO ids FROM (
  SELECT j.inbound_event_id event_id FROM mc_ai_jobs j WHERE j.id=ANY(jobs)
  UNION SELECT unnest(j.batch_event_ids) FROM mc_ai_jobs j WHERE j.id=ANY(jobs)
 ) batch;
 UPDATE mc_ai_jobs j SET status='DONE',processed_at=now(),last_error='COALESCED_INTO:'||chosen,
  locked_at=NULL,locked_by=NULL WHERE j.id=ANY(jobs) AND j.id<>chosen;
 UPDATE mc_ai_jobs j SET status='PROCESSING',locked_at=now(),locked_by=p_worker,
  attempt_count=j.attempt_count+1,batch_event_ids=ids WHERE j.id=chosen;
 RETURN QUERY SELECT j.id,j.inbound_event_id,j.job_kind,j.attempt_count,j.requested_model,
  e.chat_id,(SELECT string_agg(b.message_text,E'\n' ORDER BY b.received_at,b.id) FROM mc_inbound_events b WHERE b.id=ANY(ids)),
  e.external_message_id,e.payload||jsonb_build_object('batch_count',cardinality(ids),'account_id',e.account_id)
 FROM mc_ai_jobs j JOIN mc_inbound_events e ON e.id=j.inbound_event_id WHERE j.id=chosen;
END $function$


CREATE OR REPLACE FUNCTION public.mc_claim_ai_jobs_batch(
 p_worker text DEFAULT 'n8n', p_limit integer DEFAULT 4
) RETURNS TABLE(job_id uuid,inbound_event_id uuid,job_kind text,
 attempt_count integer,requested_model text,chat_id text,message_text text,
 external_message_id text,inbound_payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $batch$
DECLARE i integer; n integer; v_cap integer;
BEGIN
 v_cap:=least(10,greatest(1,coalesce((SELECT (value #>> '{}')::int FROM public.bot_settings
              WHERE key='ai_max_concurrency'),4)));
 FOR i IN 1..least(v_cap,greatest(1,coalesce(p_limit,4))) LOOP
  RETURN QUERY SELECT * FROM public.mc_claim_ai_job(p_worker);
  GET DIAGNOSTICS n = ROW_COUNT;
  EXIT WHEN n=0;
 END LOOP;
END;
$batch$;
REVOKE ALL ON FUNCTION public.mc_claim_ai_jobs_batch(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_claim_ai_jobs_batch(text,integer) TO service_role;

-- The original action temporarily used is_test=true to bypass personal preflight,
-- but that also disabled one-time reservations. Reserve numbers first, in one txn.
CREATE OR REPLACE FUNCTION public.mc_campaign_action(
 p_id uuid,p_action text,p_schedule timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $act$
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
$act$;

-- Classification of deterministic WAHA identifier failures: no blind retry.
CREATE OR REPLACE FUNCTION public.mc_unknown_outbound_job(p_job_id uuid,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $unk$
BEGIN
 UPDATE public.mc_outbound_jobs
 SET status=CASE WHEN coalesce(p_error,'') ~* '(no lid for user|recipient not found|not on whatsapp)'
           THEN 'FAILED' ELSE 'UNKNOWN' END,
     last_error=left(CASE WHEN coalesce(p_error,'') ~* '(no lid for user|recipient not found|not on whatsapp)'
        THEN 'RECIPIENT_NOT_FOUND: '||coalesce(p_error,'')
        ELSE coalesce(p_error,'') END,4000),
     locked_at=null,locked_by=null
 WHERE id=p_job_id AND status='PROCESSING';
END;
$unk$;

CREATE OR REPLACE FUNCTION public.mc_retry_outbound_job(
 p_job_id uuid,p_error text,p_delay_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $retry$
BEGIN
 UPDATE public.mc_outbound_jobs SET
  status=CASE WHEN coalesce(p_error,'') ~*
   '(no lid for user|recipient not found|not on whatsapp|invalid.phone|invalid.stage|schema.validation|parser.error)'
    THEN 'FAILED' ELSE 'RETRY' END,
  next_retry_at=CASE WHEN coalesce(p_error,'') ~*
   '(no lid for user|recipient not found|not on whatsapp|invalid.phone|invalid.stage|schema.validation|parser.error)'
    THEN NULL ELSE now()+make_interval(secs=>greatest(1,p_delay_seconds)) END,
  last_error=left(CASE WHEN coalesce(p_error,'') ~*
   '(no lid for user|recipient not found|not on whatsapp)'
    THEN 'RECIPIENT_NOT_FOUND: '||coalesce(p_error,'') ELSE coalesce(p_error,'') END,4000),
  locked_at=null,locked_by=null
 WHERE id=p_job_id AND status='PROCESSING';
END;
$retry$;

-- Structured storage is additive. The worker must supply sanitized fields.
ALTER TABLE public.mc_error_log
 ADD COLUMN IF NOT EXISTS job_id uuid,
 ADD COLUMN IF NOT EXISTS inbound_event_id uuid,
 ADD COLUMN IF NOT EXISTS chat_id text,
 ADD COLUMN IF NOT EXISTS phone text,
 ADD COLUMN IF NOT EXISTS attempt_count integer,
 ADD COLUMN IF NOT EXISTS node text,
 ADD COLUMN IF NOT EXISTS slot_provider text,
 ADD COLUMN IF NOT EXISTS model text,
 ADD COLUMN IF NOT EXISTS error_source text,
 ADD COLUMN IF NOT EXISTS http_status integer,
 ADD COLUMN IF NOT EXISTS retry_allowed boolean;

CREATE OR REPLACE FUNCTION public.mc_queue_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $metrics$
 WITH scoped_ai AS (
  SELECT j.* FROM public.mc_ai_jobs j
  JOIN public.mc_inbound_events e ON e.id=j.inbound_event_id
  WHERE e.account_id=public.mc_active_account()
 ), scoped_outbound AS (
  SELECT * FROM public.mc_outbound_jobs WHERE account_id=public.mc_active_account()
 )
 SELECT jsonb_build_object(
  'ai_pending',(SELECT count(*) FROM scoped_ai WHERE status='PENDING'),
  'ai_processing',(SELECT count(*) FROM scoped_ai WHERE status='PROCESSING'),
  'ai_retry',(SELECT count(*) FROM scoped_ai WHERE status='RETRY'),
  'ai_failed',(SELECT count(*) FROM scoped_ai WHERE status='FAILED'),
  'ai_oldest_wait_seconds',(SELECT coalesce(extract(epoch from now()-min(created_at)),0)::integer
    FROM scoped_ai WHERE status IN('PENDING','RETRY')),
  'ai_avg_seconds',(SELECT round(avg(extract(epoch from processed_at-created_at))::numeric,2)
    FROM scoped_ai WHERE status='DONE' AND processed_at IS NOT NULL),
  'outbound_pending',(SELECT count(*) FROM scoped_outbound WHERE status='PENDING'),
  'outbound_processing',(SELECT count(*) FROM scoped_outbound WHERE status='PROCESSING'),
  'outbound_retry',(SELECT count(*) FROM scoped_outbound WHERE status='RETRY'),
  'outbound_failed',(SELECT count(*) FROM scoped_outbound WHERE status='FAILED'),
  'outbound_unknown',(SELECT count(*) FROM scoped_outbound WHERE status='UNKNOWN'),
  'outbound_avg_seconds',(SELECT round(avg(extract(epoch from sent_at-created_at))::numeric,2)
    FROM scoped_outbound WHERE status='SENT' AND sent_at IS NOT NULL),
  'lid_unmapped',(SELECT count(*) FROM public.mc_lead_state l
    WHERE l.account_id=public.mc_active_account() AND l.chat_id ~ '@lid$'
    AND (l.phone IS NULL OR l.phone !~ '^[1-9][0-9]{7,14}$'))
 );
$metrics$;
REVOKE ALL ON FUNCTION public.mc_queue_metrics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_queue_metrics() TO service_role;
