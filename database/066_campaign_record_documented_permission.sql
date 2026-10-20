-- 066: Record an owner's declaration of an actual prior customer opt-in
-- for all eligible staged recipients in ONE draft. This does not send WhatsApp,
-- start a campaign, change an opt-out, or re-authorize a disabled contact.
CREATE OR REPLACE FUNCTION public.mc_campaign_record_permission(
 p_id uuid,p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_count int;
BEGIN
 IF length(trim(coalesce(p_source,''))) NOT BETWEEN 12 AND 500
   OR trim(p_source) IN (
     'OWNER_DISPATCH_POLICY_NOT_CUSTOMER_OPT_IN',
     'Owner mengizinkan Blash langsung untuk kontak bernomor WhatsApp'
   )
 THEN RAISE EXCEPTION 'Sumber persetujuan pelanggan perlu dijelaskan'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mc_campaigns c
    WHERE c.id=p_id AND c.status='DRAFT' FOR UPDATE)
 THEN RAISE EXCEPTION 'Hanya draft yang dapat mencatat sumber izin'; END IF;
 UPDATE public.mc_campaign_contacts cc
 SET consent=true,
     consent_evidence=trim(p_source),
     consent_at=coalesce(cc.consent_at,now()),
     updated_at=now()
 FROM public.mc_campaign_recipients r
 WHERE r.campaign_id=p_id AND r.phone=cc.phone
   AND r.excluded_reason IS NULL
   AND r.phone ~ '^[1-9][0-9]{7,14}$'
   AND cc.source='CAMPAIGN_ONLY_STAGED'
   AND cc.opted_out_at IS NULL
   AND NOT cc.owner_promo_disabled
   AND NOT EXISTS(SELECT 1 FROM public.mc_contact_exclusions x WHERE x.phone=r.phone)
   AND NOT EXISTS(SELECT 1 FROM public.mc_campaign_one_time_phones once
     WHERE once.phone=r.phone AND once.campaign_id<>p_id);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 INSERT INTO public.mc_campaign_audit(campaign_id,action,detail)
 VALUES(p_id,'OWNER_RECORDED_CUSTOMER_OPTIN_SOURCE',
   jsonb_build_object('count',v_count,'evidence_source',left(trim(p_source),500)));
 RETURN jsonb_build_object('ok',true,'recorded',v_count);
END;
$fn$;
REVOKE ALL ON FUNCTION public.mc_campaign_record_permission(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_campaign_record_permission(uuid,text) TO service_role;
