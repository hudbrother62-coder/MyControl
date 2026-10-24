-- Keep the recovered, already published CS2 worker operating until the one-time
-- workflow upgrade is verified. Owner selection itself requires the new contract.
BEGIN;
CREATE OR REPLACE FUNCTION public.mc_campaign_preflight(p_job_id uuid,p_attempt integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE selected jsonb; j mc_outbound_jobs%rowtype;
BEGIN
 SELECT value INTO selected FROM bot_settings WHERE key='prime_store_waha_cutover' FOR SHARE;
 IF coalesce((selected->>'session_manager_enabled')::boolean,false) IS NOT TRUE THEN
  RETURN mc_campaign_preflight_before_sessions(p_job_id,p_attempt);
 END IF;
 SELECT * INTO j FROM mc_outbound_jobs WHERE id=p_job_id;
 IF NOT EXISTS(SELECT 1 FROM mc_campaign_runtime r WHERE r.session_name=selected->>'target_session' AND r.last_seen BETWEEN now()-interval '90 seconds' AND now() AND r.settings_revision=coalesce((selected->>'session_revision')::integer,1) AND r.worker_contract='session-manager-v1') OR (j.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mc_campaigns c WHERE c.id=j.campaign_id AND c.session_name=selected->>'target_session')) THEN
 RETURN jsonb_build_object('allowed',false,'reason','SESSION_WORKER_NOT_READY'); END IF;
 RETURN mc_campaign_preflight_before_sessions(p_job_id,p_attempt);
END $$;
REVOKE ALL ON FUNCTION public.mc_campaign_preflight(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_campaign_preflight(uuid,integer) TO service_role;
COMMIT;
