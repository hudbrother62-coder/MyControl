-- 057: Validate AI commits, limit retry to transient errors, and keep owner controls.
INSERT INTO public.bot_settings(key,value,description)
VALUES('ai_max_attempts','3'::jsonb,'Maksimum klaim ulang AI setelah error sementara')
ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mc_queue_attention()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT jsonb_build_object(
 'ai_jobs',coalesce((
   SELECT jsonb_agg(to_jsonb(a)) FROM (
      SELECT j.id,j.inbound_event_id,j.status,j.attempt_count,j.created_at,
             e.chat_id,CASE WHEN e.phone ~ '^[1-9][0-9]{7,14}$' THEN e.phone ELSE NULL END AS phone,
             left(coalesce(j.last_error,''),300) AS last_error
      FROM public.mc_ai_jobs j JOIN public.mc_inbound_events e ON e.id=j.inbound_event_id
      WHERE e.account_id=public.mc_active_account() AND j.status IN('FAILED','RETRY','PROCESSING')
      ORDER BY j.created_at DESC LIMIT 30
   ) a
 ),'[]'::jsonb),
 'unmapped_lids',coalesce((
   SELECT jsonb_agg(to_jsonb(lid)) FROM (
      SELECT l.chat_id,l.display_name,l.updated_at
      FROM public.mc_lead_state l
      WHERE l.account_id=public.mc_active_account()
        AND l.chat_id ~ '^[0-9]{6,20}@lid$'
        AND (l.phone IS NULL OR l.phone !~ '^[1-9][0-9]{7,14}$')
      ORDER BY l.updated_at DESC LIMIT 50
   ) lid
 ),'[]'::jsonb),
 'invalid_contacts',coalesce((
    SELECT jsonb_agg(to_jsonb(ic)) FROM (
       SELECT c.name,left(c.phone,40) AS input,c.updated_at
       FROM public.mc_campaign_contacts c
       WHERE c.phone !~ '^[1-9][0-9]{7,14}$'
       ORDER BY c.updated_at DESC LIMIT 30
    ) ic
 ),'[]'::jsonb),
 'ai_max_attempts',coalesce((SELECT (value #>> '{}')::integer FROM public.bot_settings WHERE key='ai_max_attempts'),3),
 'ai_max_concurrency',coalesce(
   (SELECT (value #>> '{}')::int FROM public.bot_settings WHERE key='ai_max_concurrency'),4)
);
$function$
;

CREATE OR REPLACE FUNCTION public.mc_set_ai_max_attempts(p_max integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Maksimal percobaan AI harus 1–5';
 END IF;
 INSERT INTO public.bot_settings(key,value,description)
 VALUES('ai_max_attempts',to_jsonb(p_max),'Maksimum percobaan AI')
 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now();
 INSERT INTO public.mc_campaign_audit(action,detail)
 VALUES('OWNER_AI_MAX_ATTEMPTS',jsonb_build_object('max_attempts',p_max));
 RETURN jsonb_build_object('ok',true,'ai_max_attempts',p_max);
END;
$fn$;
REVOKE ALL ON FUNCTION public.mc_set_ai_max_attempts(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_set_ai_max_attempts(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mc_retry_ai_job(p_job_id uuid,p_error text,p_delay_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $retry$
DECLARE v_limit integer;
BEGIN
 v_limit:=coalesce((SELECT (value #>> '{}')::integer FROM public.bot_settings
                    WHERE key='ai_max_attempts'),3);
 UPDATE public.mc_ai_jobs SET
  status=CASE WHEN attempt_count>=v_limit OR coalesce(p_error,'') !~*
   '(timeout|timed.out|rate.limit|429|50[0-9]|502|503|504|provider.unavailable|connection.reset|network|econnreset|etimedout)'
    THEN 'FAILED' ELSE 'RETRY' END,
  next_retry_at=CASE WHEN attempt_count>=v_limit OR coalesce(p_error,'') !~*
   '(timeout|timed.out|rate.limit|429|50[0-9]|502|503|504|provider.unavailable|connection.reset|network|econnreset|etimedout)'
    THEN NULL ELSE now()+make_interval(secs=>greatest(1,p_delay_seconds)) END,
  last_error=left(coalesce(p_error,'UNKNOWN_PROVIDER_ERROR'),4000),
  locked_at=NULL,locked_by=NULL
 WHERE id=p_job_id AND status='PROCESSING';
END;
$retry$;

CREATE OR REPLACE FUNCTION public.mc_recover_expired_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $recover$
DECLARE ai_count integer; out_count integer; max_attempts integer;
BEGIN
 max_attempts:=coalesce((SELECT (value #>> '{}')::integer FROM public.bot_settings
                          WHERE key='ai_max_attempts'),3);
 UPDATE public.mc_ai_jobs SET
   status=CASE WHEN attempt_count>=max_attempts THEN 'FAILED' ELSE 'RETRY' END,
   next_retry_at=CASE WHEN attempt_count>=max_attempts THEN NULL ELSE now()+interval '30 seconds' END,
   locked_at=NULL,locked_by=NULL,last_error='AI_PROVIDER_TIMEOUT: expired processing lease'
 WHERE status='PROCESSING' AND locked_at<now()-interval '10 minutes';
 GET DIAGNOSTICS ai_count=ROW_COUNT;
 UPDATE public.mc_outbound_jobs SET status='UNKNOWN',locked_at=NULL,locked_by=NULL,
   last_error='Expired send lease; reconcile provider before retry'
 WHERE status='PROCESSING' AND locked_at<now()-interval '2 minutes';
 GET DIAGNOSTICS out_count=ROW_COUNT;
 RETURN jsonb_build_object('ai_recovered',ai_count,'outbound_unknown',out_count);
END;
$recover$;

-- Keep the same current RPC name/signature and existing idempotent commit contract.
CREATE OR REPLACE FUNCTION public.mc_commit_claimed_ai_job(
 p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,
 p_chat_id text,p_reply text,p_claim_attempt integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $commit$
DECLARE
 d jsonb:=p_decision;
 v_stage text;
 v_current text;
 v_allowed text[]:=ARRAY['NEW','CONTACTED','PRODUCT_INTEREST','INTERESTED',
 'FOLLOW_UP','PENDING','CHECKOUT','AWAITING_PAYMENT','PAYMENT_SUBMITTED',
 'WAITING_OWNER_APPROVAL','WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF'];
BEGIN
 PERFORM mc_live_test_context(p_chat_id);
 IF jsonb_typeof(d) IS DISTINCT FROM 'object'
    OR jsonb_typeof(d->'should_reply') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(d->'needs_human') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(d->'reply') IS DISTINCT FROM 'string'
    OR p_reply IS DISTINCT FROM d->>'reply' OR length(p_reply)>4000 THEN
   RAISE EXCEPTION 'VALIDATION: invalid AI decision shape';
 END IF;
 SELECT l.stage INTO v_current FROM public.mc_lead_state l
  WHERE l.chat_id=p_chat_id AND l.account_id=mc_active_account();
 v_stage:=d->>'stage';
 IF v_stage IS NULL OR NOT (v_stage=ANY(v_allowed)) THEN
   d:=jsonb_set(d,'{stage}',to_jsonb(CASE WHEN v_current=ANY(v_allowed)
                                          THEN v_current ELSE 'NEW' END));
 END IF;
 IF jsonb_typeof(d->'should_followup') IS DISTINCT FROM 'boolean' THEN
   d:=jsonb_set(d,'{should_followup}','false'::jsonb);
 END IF;
 IF jsonb_typeof(d->'followup_plan') IS DISTINCT FROM 'array'
    OR jsonb_array_length(coalesce(d->'followup_plan','[]'::jsonb))>3 THEN
   d:=jsonb_set(jsonb_set(d,'{should_followup}','false'::jsonb),
                       '{followup_plan}','[]'::jsonb);
 END IF;
 IF (d->>'needs_human')::boolean THEN
   d:=jsonb_set(jsonb_set(d,'{should_followup}','false'::jsonb),
                       '{followup_plan}','[]'::jsonb);
 END IF;
 IF NOT public.mc_bot_enabled() OR NOT coalesce(
   (SELECT (value #>> '{}')::boolean FROM public.bot_settings
      WHERE key='ai_auto_reply'),false) THEN
   UPDATE public.mc_ai_jobs SET status='HUMAN',locked_at=NULL,locked_by=NULL,
      processed_at=now(),last_error='AI_AUTOREPLY_DISABLED'
   WHERE id=p_job_id AND status='PROCESSING' AND attempt_count=p_claim_attempt;
   RETURN jsonb_build_object('suppressed',true,'reason','AI_AUTOREPLY_DISABLED');
 END IF;
 RETURN public.mc_commit_claimed_ai_job_before_live_test(
   p_job_id,d,p_model_used,p_slot_used,p_chat_id,p_reply,p_claim_attempt);
END;
$commit$;

-- Only transient outbound failures are eligible for explicit owner retries.
CREATE OR REPLACE FUNCTION public.mc_retry_web_failure(p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $owner$
DECLARE j public.mc_outbound_jobs%rowtype;
BEGIN
 SELECT * INTO j FROM public.mc_outbound_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.status<>'FAILED' OR j.kind='CAMPAIGN' THEN
   RAISE EXCEPTION 'Hanya outbound FAILED non-kampanye dapat diperiksa untuk retry';
 END IF;
 IF coalesce(j.last_error,'') !~*
  '(timeout|timed.out|rate.limit|429|50[0-9]|502|503|504|provider.unavailable|connection.reset|network|econnreset|etimedout)' THEN
   RAISE EXCEPTION 'Deterministic or unclassified failure: retry blocked';
 END IF;
 UPDATE public.mc_outbound_jobs SET status='RETRY',next_retry_at=now(),last_error=NULL
  WHERE id=p_job_id;
 INSERT INTO public.mc_campaign_audit(action,detail)
 VALUES('OWNER_RETRY_FAILED',jsonb_build_object('job_id',p_job_id,'actor','OWNER'));
END;
$owner$;
