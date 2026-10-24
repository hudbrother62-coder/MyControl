BEGIN;
CREATE OR REPLACE FUNCTION public.mc_select_waha_session(p_expected_revision integer,p_session text,p_sender text,p_lid text,p_webhook text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old jsonb; next_config jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('mc_waha_session_selection',0));
 LOCK TABLE mc_campaigns,mc_outbound_jobs IN SHARE ROW EXCLUSIVE MODE;
 SELECT value INTO old FROM bot_settings WHERE key='prime_store_waha_cutover' FOR UPDATE;
 IF coalesce((old->>'session_revision')::integer,1)<>p_expected_revision THEN RAISE EXCEPTION 'Konfigurasi berubah. Refresh dahulu'; END IF;
 IF p_session !~ '^[A-Za-z0-9_-]{1,100}$' OR p_sender !~ '^[0-9]+@c.us$' OR (p_lid<>'' AND p_lid !~ '^[0-9]+@lid$') THEN RAISE EXCEPTION 'Identitas sesi tidak valid'; END IF;
 IF EXISTS(SELECT 1 FROM mc_campaigns WHERE status IN('RUNNING','SCHEDULED')) OR EXISTS(SELECT 1 FROM mc_outbound_jobs WHERE status IN('PENDING','RETRY','PROCESSING')) THEN RAISE EXCEPTION 'Jeda kampanye dan selesaikan antrean aktif sebelum mengganti sesi'; END IF;
 IF NOT EXISTS(SELECT 1 FROM mc_campaign_runtime r WHERE r.session_name=old->>'target_session' AND r.worker_contract='session-manager-v1' AND r.last_seen BETWEEN now()-interval '90 seconds' AND now()) THEN RAISE EXCEPTION 'WORKFLOW_UPGRADE_REQUIRED'; END IF;
 -- Switching numbers also changes inbox ownership. Archive/clear operations stay in the existing scope trigger.
 next_config:=old||jsonb_build_object('target_session',p_session,'target_me_id',p_sender,'target_lid',nullif(p_lid,''),'session_revision',p_expected_revision+1,'inbound_webhook_url',p_webhook,'session_selected_at',now(),'phase','AWAITING_WORKER','route_active',true,'session_manager_enabled',true);
 UPDATE bot_settings SET value=next_config,updated_at=now() WHERE key='prime_store_waha_cutover';
 UPDATE mc_control_version SET version=version+1,updated_at=now() WHERE id;
 INSERT INTO mc_campaign_audit(action,detail) VALUES('OWNER_WAHA_SESSION_SELECTED',jsonb_build_object('previous_session',old->>'target_session','session',p_session,'sender',p_sender,'revision',p_expected_revision+1));
 RETURN next_config;
END $$;

REVOKE ALL ON FUNCTION public.mc_select_waha_session(integer,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_select_waha_session(integer,text,text,text,text) TO service_role;
COMMIT;
