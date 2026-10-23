-- Keep the uploaded Excel name as the recipient snapshot for this one Blash.
-- Do not overwrite CRM contact names or change consent/opt-out policies.
-- Only the direct-send campaign wrapper is replaced; older queue functions remain untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.mc_save_campaign(p_campaign jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v jsonb;
  v_id uuid;
  v_named integer:=0;
BEGIN
  v := public.mc_save_campaign_before_bulk_promo(
    coalesce(p_campaign,'{}'::jsonb) ||
    jsonb_build_object('bot_enabled',false)
  );
  v_id := nullif(v->>'id','')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Campaign save did not return an id';
  END IF;

  -- The existing import routine preserves the CRM name on an existing contact.
  -- Campaign recipients instead use the name from the current uploaded list.
  UPDATE public.mc_campaign_recipients AS r
     SET name = btrim(src.contact_name)
    FROM (
      SELECT item->>'phone' AS phone,
             item->>'name' AS contact_name
        FROM jsonb_array_elements(coalesce(p_campaign->'import_contacts','[]'::jsonb)) AS item
    ) AS src
   WHERE r.campaign_id=v_id
     AND r.phone=src.phone
     AND length(btrim(coalesce(src.contact_name,''))) BETWEEN 1 AND 100
     -- Preserve a real CRM name when uploading a headerless phone-only file.
     AND btrim(src.contact_name) !~* '^Pelanggan [0-9]{4}$';
  GET DIAGNOSTICS v_named=ROW_COUNT;

  UPDATE public.mc_campaigns
     SET session_name='CSNEW2', updated_at=now()
   WHERE id=v_id AND status='DRAFT';

  RETURN v || jsonb_build_object(
    'direct_contact_send',true,
    'session_name','CSNEW2',
    'ai_auto_reply',false,
    'followup_enabled',false,
    'bot_enabled',false,
    'recipient_names_from_excel',v_named
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mc_save_campaign(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_save_campaign(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
