BEGIN;
ALTER TABLE public.mc_campaign_runtime ADD COLUMN IF NOT EXISTS settings_revision integer;
ALTER TABLE public.mc_campaign_runtime ADD COLUMN IF NOT EXISTS worker_contract text;
ALTER FUNCTION public.mc_read_web_controls() RENAME TO mc_read_web_controls_before_sessions;
CREATE FUNCTION public.mc_read_web_controls() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_set(mc_read_web_controls_before_sessions(),'{settings}',
 (mc_read_web_controls_before_sessions()->'settings')||jsonb_build_object(
 'waha_session',value->>'target_session','waha_sender_id',value->>'target_me_id',
 'waha_sender_lid',value->>'target_lid','waha_revision',coalesce((value->>'session_revision')::integer,1),
 'waha_webhook_url',value->>'inbound_webhook_url'))
 FROM bot_settings WHERE key='prime_store_waha_cutover'
$$;
CREATE FUNCTION public.mc_select_waha_session(p_expected_revision integer,p_session text,p_sender text,p_lid text,p_webhook text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old jsonb; next_config jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('mc_waha_session_selection',0));
 LOCK TABLE mc_campaigns,mc_outbound_jobs IN SHARE ROW EXCLUSIVE MODE;
 SELECT value INTO old FROM bot_settings WHERE key='prime_store_waha_cutover' FOR UPDATE;
 IF coalesce((old->>'session_revision')::integer,1)<>p_expected_revision THEN RAISE EXCEPTION 'Konfigurasi berubah. Refresh dahulu'; END IF;
 IF p_session !~ '^[A-Za-z0-9_-]{1,100}$' OR p_sender !~ '^[0-9]+@c.us$' OR (p_lid<>'' AND p_lid !~ '^[0-9]+@lid$') THEN RAISE EXCEPTION 'Identitas sesi tidak valid'; END IF;
 IF EXISTS(SELECT 1 FROM mc_campaigns WHERE status IN('RUNNING','SCHEDULED')) OR EXISTS(SELECT 1 FROM mc_outbound_jobs WHERE status IN('PENDING','RETRY','PROCESSING')) THEN RAISE EXCEPTION 'Jeda kampanye dan selesaikan antrean aktif sebelum mengganti sesi'; END IF;
 -- Switching numbers also changes inbox ownership. Archive/clear operations stay in the existing scope trigger.
 next_config:=old||jsonb_build_object('target_session',p_session,'target_me_id',p_sender,'target_lid',nullif(p_lid,''),'session_revision',p_expected_revision+1,'inbound_webhook_url',p_webhook,'session_selected_at',now(),'phase','AWAITING_WORKER','route_active',true);
 UPDATE bot_settings SET value=next_config,updated_at=now() WHERE key='prime_store_waha_cutover';
 UPDATE mc_control_version SET version=version+1,updated_at=now() WHERE id;
 INSERT INTO mc_campaign_audit(action,detail) VALUES('OWNER_WAHA_SESSION_SELECTED',jsonb_build_object('previous_session',old->>'target_session','session',p_session,'sender',p_sender,'revision',p_expected_revision+1));
 RETURN next_config;
END $$;
CREATE FUNCTION public.mc_session_worker_heartbeat(p_worker text,p_session text,p_sender text,p_lid text,p_revision integer,p_image boolean,p_video boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb;
BEGIN
 SELECT value INTO cfg FROM bot_settings WHERE key='prime_store_waha_cutover' FOR SHARE;
 IF p_session IS DISTINCT FROM cfg->>'target_session' OR p_sender IS DISTINCT FROM cfg->>'target_me_id' OR (nullif(p_lid,'') IS NOT NULL AND nullif(cfg->>'target_lid','') IS NOT NULL AND p_lid<>cfg->>'target_lid') OR p_revision<>coalesce((cfg->>'session_revision')::integer,1) THEN RAISE EXCEPTION 'STALE_SESSION_CONFIGURATION'; END IF;
 PERFORM mc_campaign_heartbeat_v2(p_worker,p_session,p_video,p_image);
 UPDATE mc_campaign_runtime SET settings_revision=p_revision,worker_contract='session-manager-v1' WHERE session_name=p_session;
END $$;
ALTER FUNCTION public.mc_save_campaign(jsonb) RENAME TO mc_save_campaign_before_sessions;
CREATE FUNCTION public.mc_save_campaign(p_campaign jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; selected text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('mc_waha_session_selection',0));
 SELECT value->>'target_session' INTO selected FROM bot_settings WHERE key='prime_store_waha_cutover';
 IF p_campaign ? 'session_name' AND p_campaign->>'session_name' IS DISTINCT FROM selected THEN RAISE EXCEPTION 'Sesi pengirim berubah. Refresh sebelum menyimpan'; END IF;
 result:=mc_save_campaign_before_sessions(p_campaign);
 UPDATE mc_campaigns SET session_name=selected WHERE id=(result->>'id')::uuid AND status='DRAFT';
 RETURN result||jsonb_build_object('session_name',selected);
END $$;
ALTER FUNCTION public.mc_campaign_preflight(uuid,integer) RENAME TO mc_campaign_preflight_before_sessions;
CREATE FUNCTION public.mc_campaign_preflight(p_job_id uuid,p_attempt integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE selected jsonb; j mc_outbound_jobs%rowtype;
BEGIN
 SELECT value INTO selected FROM bot_settings WHERE key='prime_store_waha_cutover' FOR SHARE;
 SELECT * INTO j FROM mc_outbound_jobs WHERE id=p_job_id;
 IF NOT EXISTS(SELECT 1 FROM mc_campaign_runtime r WHERE r.session_name=selected->>'target_session' AND r.last_seen BETWEEN now()-interval '90 seconds' AND now() AND r.settings_revision=coalesce((selected->>'session_revision')::integer,1) AND r.worker_contract='session-manager-v1') OR (j.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mc_campaigns c WHERE c.id=j.campaign_id AND c.session_name=selected->>'target_session')) THEN
 RETURN jsonb_build_object('allowed',false,'reason','SESSION_WORKER_NOT_READY'); END IF;
 RETURN mc_campaign_preflight_before_sessions(p_job_id,p_attempt);
END $$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('mc_read_web_controls','mc_read_web_controls_before_sessions','mc_select_waha_session','mc_session_worker_heartbeat','mc_save_campaign','mc_save_campaign_before_sessions','mc_campaign_preflight','mc_campaign_preflight_before_sessions') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig); END LOOP;END $$;
COMMIT;
