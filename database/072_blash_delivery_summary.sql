-- 072: Per-recipient campaign delivery audit for 500+ recipients.
-- Does not send messages, modify contacts, or retry uncertain deliveries.
BEGIN;
CREATE OR REPLACE FUNCTION public.mc_campaign_delivery_summary(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
WITH per_recipient AS (
 SELECT r.id,r.excluded_reason,
        count(j.id) AS jobs,
        count(j.id) FILTER (WHERE j.status='SENT') AS sent_jobs,
        count(j.id) FILTER (WHERE j.status='FAILED') AS failed_jobs,
        count(j.id) FILTER (WHERE j.status='UNKNOWN') AS unknown_jobs,
        count(j.id) FILTER (WHERE j.status='CANCELLED') AS cancelled_jobs,
        count(j.id) FILTER (WHERE j.status IN ('PENDING','RETRY','PROCESSING')) AS waiting_jobs,
        count(j.id) FILTER (WHERE j.delivery_status IN ('DELIVERED','READ')) AS delivered_jobs,
        count(j.id) FILTER (WHERE j.delivery_status='READ') AS read_jobs
 FROM public.mc_campaign_recipients r
 LEFT JOIN public.mc_outbound_jobs j ON j.recipient_id=r.id AND j.campaign_id=p_id
 WHERE r.campaign_id=p_id
 GROUP BY r.id,r.excluded_reason
)
SELECT jsonb_build_object(
 'recipient_total',count(*),
 'excluded_total',count(*) FILTER (WHERE excluded_reason IS NOT NULL),
 'queued_total',count(*) FILTER (WHERE jobs>0),
 'not_queued_total',count(*) FILTER (WHERE jobs=0 AND excluded_reason IS NULL),
 'gateway_accepted',count(*) FILTER (WHERE sent_jobs>0),
 'delivered',count(*) FILTER (WHERE delivered_jobs>0),
 'read',count(*) FILTER (WHERE read_jobs>0),
 'failed',count(*) FILTER (WHERE failed_jobs>0),
 'unknown',count(*) FILTER (WHERE unknown_jobs>0),
 'pending',count(*) FILTER (WHERE waiting_jobs>0),
 'cancelled',count(*) FILTER (WHERE cancelled_jobs>0),
 'job_total',coalesce(sum(jobs),0),
 'job_accepted',coalesce(sum(sent_jobs),0),
 'job_failed',coalesce(sum(failed_jobs),0),
 'job_unknown',coalesce(sum(unknown_jobs),0),
 'job_pending',coalesce(sum(waiting_jobs),0)
) FROM per_recipient;
$fn$;
REVOKE ALL ON FUNCTION public.mc_campaign_delivery_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc_campaign_delivery_summary(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
