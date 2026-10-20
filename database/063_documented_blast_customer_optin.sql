-- Require recorded opt-in evidence before campaign-only staging can be
-- considered customer consent. Owner dispatch policy is tracked separately.
CREATE OR REPLACE FUNCTION public.mc_guard_owner_promo_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $guard$
BEGIN
 IF NEW.opted_out_at IS NOT NULL OR NEW.owner_promo_disabled THEN
   NEW.consent := false;
 ELSIF NEW.source = 'CAMPAIGN_ONLY_STAGED' THEN
   NEW.consent := coalesce(NEW.consent,false)
     AND length(trim(coalesce(NEW.consent_evidence,''))) BETWEEN 12 AND 500
     AND coalesce(NEW.consent_evidence,'') <> 'OWNER_DISPATCH_POLICY_NOT_CUSTOMER_OPT_IN'
     AND coalesce(NEW.consent_evidence,'') <> 'Owner mengizinkan Blash langsung untuk kontak bernomor WhatsApp';
 ELSIF TG_OP = 'INSERT' THEN
   NEW.consent := true;
 END IF;
 RETURN NEW;
END;
$guard$;
