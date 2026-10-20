-- Production migration: owner_promo_default_on_reversible_switch

-- Owner-managed promotion switch defaults ON for verified contact numbers.
-- Explicit customer opt-out and campaign-only staging are never silently re-enabled.
-- legacy "consent" is also the campaign worker eligibility switch.
BEGIN;
ALTER TABLE public.mc_campaign_contacts
 ADD COLUMN IF NOT EXISTS owner_promo_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.mc_campaign_contacts ALTER COLUMN consent SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.mc_guard_owner_promo_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.source='CAMPAIGN_ONLY_STAGED' THEN
   NEW.consent:=false;
 ELSIF NEW.opted_out_at IS NOT NULL OR NEW.owner_promo_disabled THEN
   NEW.consent:=false;
 ELSIF TG_OP='INSERT' THEN
   -- Owner configuration is not evidence of a customer's opt-in.
   NEW.consent:=true;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mc_guard_owner_promo_status_trigger ON public.mc_campaign_contacts;
CREATE TRIGGER mc_guard_owner_promo_status_trigger
 BEFORE INSERT OR UPDATE OF consent,owner_promo_disabled,opted_out_at,source
 ON public.mc_campaign_contacts FOR EACH ROW
 EXECUTE FUNCTION public.mc_guard_owner_promo_status();

-- Existing imported WhatsApp numbers become enabled without changing
-- historical opt-in timestamps, evidence, or sender block lists.
UPDATE public.mc_campaign_contacts c
SET consent=true,updated_at=now()
WHERE c.source<>'CAMPAIGN_ONLY_STAGED'
 AND c.opted_out_at IS NULL
 AND NOT c.owner_promo_disabled
 AND NOT c.consent
 AND NOT EXISTS(SELECT 1 FROM public.mc_contact_exclusions ex WHERE ex.phone=c.phone);

CREATE OR REPLACE FUNCTION public.mc_campaign_contact_import(p_contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;n integer:=0;
BEGIN
 IF jsonb_typeof(p_contacts)<>'array' OR jsonb_array_length(p_contacts)>1000
 THEN RAISE EXCEPTION 'Import maksimal 1000 kontak';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
  IF coalesce(r->>'phone','') !~ '^[1-9][0-9]{7,14}$' OR length(trim(coalesce(r->>'name',''))) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Kontak tidak valid';END IF;
  IF coalesce((r->>'consent')::boolean,false) AND length(trim(coalesce(r->>'source','')))=0
  THEN RAISE EXCEPTION 'Sumber izin promosi wajib diisi';END IF;
  INSERT INTO public.mc_campaign_contacts(phone,name,tags,source,consent,consent_at)
  VALUES(r->>'phone',trim(r->>'name'),
    left(coalesce(r->>'tags',''),500),
    left(coalesce(r->>'source','Import My Control'),500),
    true,
    CASE WHEN coalesce((r->>'consent')::boolean,false) THEN now() END)
  ON CONFLICT(phone) DO UPDATE SET
    name=excluded.name,tags=excluded.tags,
    source=CASE WHEN mc_campaign_contacts.opted_out_at IS NULL
      THEN excluded.source ELSE mc_campaign_contacts.source END,
    consent=CASE WHEN mc_campaign_contacts.opted_out_at IS NOT NULL OR mc_campaign_contacts.owner_promo_disabled
      THEN false ELSE true END,
    consent_at=coalesce(mc_campaign_contacts.consent_at,excluded.consent_at),
    updated_at=now();
  INSERT INTO public.mc_lead_state(chat_id,phone,display_name)
   VALUES((r->>'phone')||'@c.us',r->>'phone',trim(r->>'name'))
   ON CONFLICT(chat_id) DO UPDATE SET display_name=excluded.display_name;
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'processed',n);
END $$;

CREATE OR REPLACE FUNCTION public.mc_owner_promo_bulk(
 p_phones text[] DEFAULT NULL,
 p_all boolean DEFAULT false,
 p_search text DEFAULT '',
 p_enabled boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_query text:=lower(trim(left(coalesce(p_search,''),80)));
 v_requested integer:=0;
 v_eligible integer:=0;
 v_changed integer:=0;
 v_changed_phones text[]:=array[]::text[];
BEGIN
 IF p_all IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'Status promosi tidak valid';END IF;
 IF NOT p_all AND (
   p_phones IS NULL OR cardinality(p_phones)=0 OR cardinality(p_phones)>1000
   OR EXISTS(SELECT 1 FROM unnest(p_phones) p WHERE p IS NULL OR p !~ '^[1-9][0-9]{7,14}$')
 ) THEN RAISE EXCEPTION 'Pilih 1 sampai 1000 nomor WhatsApp yang valid';END IF;
 IF p_all AND cardinality(coalesce(p_phones,array[]::text[]))>0
 THEN RAISE EXCEPTION 'Cakupan promosi tidak valid';END IF;

 WITH selected AS(
   SELECT c.phone,c.opted_out_at,
     EXISTS(SELECT 1 FROM public.mc_contact_exclusions e WHERE e.phone=c.phone) excluded
   FROM public.mc_campaign_contacts c
   WHERE c.source<>'CAMPAIGN_ONLY_STAGED' AND c.phone ~ '^[1-9][0-9]{7,14}$'
    AND ((p_all AND (v_query='' OR strpos(lower(concat_ws(' ',c.name,c.phone,c.tags)),v_query)>0))
       OR (NOT p_all AND c.phone=any(p_phones)))
 )
 SELECT count(*),count(*) FILTER (WHERE opted_out_at IS NULL AND (NOT p_enabled OR NOT excluded))
 INTO v_requested,v_eligible FROM selected;

 WITH changes AS (
   UPDATE public.mc_campaign_contacts c
      SET consent=p_enabled,
          owner_promo_disabled=NOT p_enabled,
          updated_at=now()
    WHERE c.source<>'CAMPAIGN_ONLY_STAGED'
      AND c.phone ~ '^[1-9][0-9]{7,14}$'
      AND c.opted_out_at IS NULL
      AND (NOT p_enabled OR NOT EXISTS (SELECT 1 FROM public.mc_contact_exclusions e WHERE e.phone=c.phone))
      AND ((p_all AND (v_query='' OR strpos(lower(concat_ws(' ',c.name,c.phone,c.tags)),v_query)>0))
       OR (NOT p_all AND c.phone=any(p_phones)))
      AND (c.consent IS DISTINCT FROM p_enabled OR c.owner_promo_disabled IS DISTINCT FROM NOT p_enabled)
    RETURNING c.phone
 )
 SELECT count(*),coalesce(array_agg(phone),array[]::text[]) INTO v_changed,v_changed_phones FROM changes;

 IF NOT p_enabled AND v_changed>0 THEN
   UPDATE public.mc_outbound_jobs o SET status='CANCELLED',locked_at=NULL,locked_by=NULL,
     last_error='Promosi dinonaktifkan admin'
   WHERE o.kind IN ('CAMPAIGN','FOLLOW_UP')
     AND o.status IN ('PENDING','RETRY')
     AND (split_part(o.chat_id,'@',1)=any(v_changed_phones)
       OR EXISTS(SELECT 1 FROM public.mc_campaign_recipients r
         WHERE r.id=o.recipient_id AND r.phone=any(v_changed_phones)));
   UPDATE public.mc_followup_jobs f SET status='CANCELLED',processed_at=now()
   WHERE f.status='PENDING' AND split_part(f.chat_id,'@',1)=any(v_changed_phones);
 END IF;
 INSERT INTO public.mc_campaign_audit(action,detail)
 VALUES('OWNER_PROMO_SWITCH',jsonb_build_object(
  'actor','OWNER','enabled',p_enabled,
  'scope',CASE WHEN p_all THEN 'ALL_FILTERED' ELSE 'SELECTED' END,
  'requested',v_requested,'changed',v_changed,
  'skipped',v_requested-v_eligible,
  'already_set',v_eligible-v_changed));
 RETURN jsonb_build_object('ok',true,'requested',v_requested,'changed',v_changed,
   'skipped',v_requested-v_eligible,'already_set',v_eligible-v_changed,
   'enabled',p_enabled);
END $$;

REVOKE ALL ON FUNCTION public.mc_guard_owner_promo_status() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.mc_campaign_contact_import(jsonb) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.mc_owner_promo_bulk(text[],boolean,text,boolean)
 FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_campaign_contact_import(jsonb),
 public.mc_owner_promo_bulk(text[],boolean,text,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

