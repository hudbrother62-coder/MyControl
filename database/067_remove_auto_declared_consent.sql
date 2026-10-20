-- 067: Remove hard-coded consent declarations from campaign creation.
-- Use only actual permission evidence explicitly provided by the owner.
-- Maintain CSNEW2 and AI-off behavior; no WhatsApp send is performed.
-- 060: Blash-only saves must never opt a campaign into AI replies.
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
      'bot_enabled', false
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
    'followup_enabled',false,
    'bot_enabled',false
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.mc_save_campaign(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_save_campaign(jsonb) TO service_role;
