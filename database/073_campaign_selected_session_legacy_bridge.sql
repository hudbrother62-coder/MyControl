-- 073: Bridge the legacy single-default-session campaign writer to the
-- selected WAHA session (CS2 or a subsequently verified session).
-- Never change the active session, consent, recipients, campaign status, or
-- trigger sending as part of this migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.mc_save_campaign(p_campaign jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  selected text;
  legacy_payload jsonb;
  draft_id uuid;
BEGIN
  -- Serialize with session switching, so the selected sender cannot change
  -- between validating the browser's selection and saving the draft.
  PERFORM pg_advisory_xact_lock(hashtextextended('mc_waha_session_selection',0));
  SELECT value->>'target_session' INTO selected
    FROM public.bot_settings WHERE key='prime_store_waha_cutover';

  IF selected IS NULL OR selected !~ '^[A-Za-z0-9_-]{1,100}$' THEN
    RAISE EXCEPTION 'Sesi WhatsApp aktif belum tersedia. Pilih dan verifikasi sesi terlebih dahulu.';
  END IF;
  IF p_campaign ? 'session_name'
     AND p_campaign->>'session_name' IS DISTINCT FROM selected THEN
    RAISE EXCEPTION 'Sesi pengirim berubah. Refresh sebelum menyimpan';
  END IF;

  -- The historic mc_save_campaign_before_staged_import (inside the existing
  -- staging/name-preserving wrappers) validates session_name='default'.
  -- Pass that compatibility token ONLY to the legacy creator. The final draft
  -- is always assigned to the currently selected WAHA session, never default.
  legacy_payload := jsonb_set(
    coalesce(p_campaign,'{}'::jsonb),
    '{session_name}', to_jsonb('default'::text), true
  );
  result := public.mc_save_campaign_before_sessions(legacy_payload);
  draft_id := nullif(result->>'id','')::uuid;
  IF draft_id IS NULL THEN
    RAISE EXCEPTION 'Penyimpanan draft tidak menghasilkan ID kampanye';
  END IF;

  UPDATE public.mc_campaigns
     SET session_name=selected,updated_at=now()
   WHERE id=draft_id AND status='DRAFT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gagal menetapkan sesi pengirim pada draft';
  END IF;
  RETURN result || jsonb_build_object(
    'session_name',selected,'session_bridge','legacy_default_compatible'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mc_save_campaign(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_save_campaign(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
