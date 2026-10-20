-- 059: Blash-only delivery is bound to the selected PRIME STORE WAHA session.
-- AI and follow-up switches are intentionally not enabled by this migration.

UPDATE public.mc_campaigns
SET session_name='CSNEW2', updated_at=now()
WHERE status IN ('DRAFT','PAUSED','SCHEDULED')
  AND session_name IS DISTINCT FROM 'CSNEW2';

UPDATE public.bot_settings
SET value = jsonb_set(
              jsonb_set(
                jsonb_set(value,'{target_session}','"CSNEW2"'::jsonb,true),
                '{phase}','"BLASH_ONLY_CONFIGURED"'::jsonb,true),
              '{route_active}','false'::jsonb,true),
    updated_at=now()
WHERE key='prime_store_waha_cutover';

CREATE OR REPLACE FUNCTION public.mc_save_campaign(p_campaign jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v jsonb;
DECLARE v_id uuid;
BEGIN
  v := public.mc_save_campaign_before_bulk_promo(
    coalesce(p_campaign,'{}'::jsonb)
    || jsonb_build_object(
      'bulk_consent', true,
      'bulk_consent_evidence', 'Owner mengizinkan Blash langsung untuk kontak bernomor WhatsApp'
    )
  );
  v_id := nullif(v->>'id','')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Campaign save did not return an id';
  END IF;
  UPDATE public.mc_campaigns
     SET session_name='CSNEW2', updated_at=now()
   WHERE id=v_id
     AND status='DRAFT';
  RETURN v || jsonb_build_object(
    'direct_contact_send',true,
    'session_name','CSNEW2',
    'ai_auto_reply',false,
    'followup_enabled',false
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.mc_save_campaign(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_save_campaign(jsonb) TO service_role;
