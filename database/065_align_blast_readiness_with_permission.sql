-- 065: Show only recipients with recorded permission as send-ready; avoid
-- misleading counts when the legacy sender gate will reject staged numbers.
CREATE OR REPLACE FUNCTION public.mc_campaign_readiness(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(public.mc_campaign_readiness_before_ai_reply_preflight(p_id), '{}'::jsonb)
  || jsonb_build_object(
   'eligible_total', (
     SELECT count(*)
     FROM public.mc_campaign_recipients r
     JOIN public.mc_campaign_contacts cc ON cc.phone = r.phone
     WHERE r.campaign_id = p_id
       AND r.excluded_reason IS NULL
       AND r.phone ~ '^[1-9][0-9]{7,14}$'
       AND cc.opted_out_at IS NULL
       AND cc.consent = true
       AND NOT cc.owner_promo_disabled
       AND NOT EXISTS (
         SELECT 1 FROM public.mc_contact_exclusions e
         WHERE e.phone = r.phone
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.mc_campaign_one_time_phones used
         WHERE used.phone = r.phone AND used.campaign_id <> p_id
       )
   ),
   'staged_total', (
     SELECT count(*)
     FROM public.mc_campaign_recipients r
     JOIN public.mc_campaign_contacts cc ON cc.phone = r.phone
     WHERE r.campaign_id = p_id AND cc.source = 'CAMPAIGN_ONLY_STAGED'
   ),
   'campaign_ai_enabled', coalesce((
     SELECT bot_enabled FROM public.mc_campaigns WHERE id = p_id
   ), false),
   'ai_auto_reply_ready', public.mc_bot_enabled() AND coalesce((
     SELECT (value #>> '{}')::boolean
     FROM public.bot_settings WHERE key = 'ai_auto_reply'
   ), false)
  );
$function$;
