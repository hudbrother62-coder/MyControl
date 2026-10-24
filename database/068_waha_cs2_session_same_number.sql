-- 068 | WAHA session rename CSNEW2 -> CS2 on the same verified WhatsApp identity.
-- The n8n LIVE workflow must also be updated; this migration must NOT forge a heartbeat.
-- Historical completed campaigns and any jobs in paused/running campaigns remain untouched.
BEGIN;

UPDATE public.bot_settings
   SET value=jsonb_set(value,'{target_session}','"CS2"'::jsonb,true), updated_at=now()
 WHERE key='prime_store_waha_cutover'
   AND value->>'target_me_id'='6283186750567@c.us'
   AND value->>'target_lid'='208770441470075@lid'
   AND value->>'target_session' IN ('CSNEW2','CS2');

UPDATE public.mc_campaigns AS c
   SET session_name='CS2', updated_at=now()
 WHERE c.status='DRAFT'
   AND c.session_name='CSNEW2'
   AND NOT EXISTS(SELECT 1 FROM public.mc_outbound_jobs j WHERE j.campaign_id=c.id);

-- Preserve the name-from-Excel snapshot, existing AI-off defaults and all original guards.
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
     SET session_name='CS2', updated_at=now()
   WHERE id=v_id AND status='DRAFT';

  RETURN v || jsonb_build_object(
    'direct_contact_send',true,
    'session_name','CS2',
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
