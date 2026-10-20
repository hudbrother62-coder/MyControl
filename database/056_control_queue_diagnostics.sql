-- 056: Owner diagnostic queue view and bounded concurrency setting.
-- No changes to existing delivery, credentials or queued job statuses.
CREATE OR REPLACE FUNCTION public.mc_queue_attention()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
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
 'ai_max_concurrency',coalesce(
   (SELECT (value #>> '{}')::int FROM public.bot_settings WHERE key='ai_max_concurrency'),4)
);
$fn$;
REVOKE ALL ON FUNCTION public.mc_queue_attention() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_queue_attention() TO service_role;

CREATE OR REPLACE FUNCTION public.mc_set_ai_max_concurrency(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'Batas concurrency harus 1 sampai 6';
 END IF;
 INSERT INTO public.bot_settings(key,value,description)
 VALUES('ai_max_concurrency',to_jsonb(p_limit),'Batas AI jobs PROCESSING per akun')
 ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now();
 INSERT INTO public.mc_campaign_audit(action,detail)
 VALUES('OWNER_AI_CONCURRENCY_LIMIT',jsonb_build_object('max_concurrency',p_limit));
 RETURN jsonb_build_object('ok',true,'ai_max_concurrency',p_limit);
END;
$fn$;
REVOKE ALL ON FUNCTION public.mc_set_ai_max_concurrency(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_set_ai_max_concurrency(integer) TO service_role;
