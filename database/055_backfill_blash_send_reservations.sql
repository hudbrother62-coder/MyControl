-- 055: Protect recipients of older Blash attempts before the new one-time reservation guard.
-- UNKNOWN is an ambiguous send, not evidence of failure; reserve it until reconciled.
-- This migration only records reservations. It dispatches no messages.
INSERT INTO public.mc_campaign_one_time_phones(phone,campaign_id)
SELECT DISTINCT ON (r.phone) r.phone,o.campaign_id
FROM public.mc_outbound_jobs o
JOIN public.mc_campaign_recipients r ON r.id=o.recipient_id
WHERE o.kind='CAMPAIGN'
  AND o.status IN('SENT','UNKNOWN','PROCESSING')
  AND o.campaign_id IS NOT NULL
  AND r.phone ~ '^[1-9][0-9]{7,14}$'
ORDER BY r.phone,
         CASE WHEN o.status='SENT' THEN 0 ELSE 1 END,
         o.sent_at NULLS LAST,o.created_at,o.id
ON CONFLICT (phone) DO NOTHING;
