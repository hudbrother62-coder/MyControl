begin;
-- Read-only Blash preflight summary. Never authorizes an outbound send.
create or replace function public.mc_campaign_readiness(p_id uuid)
returns jsonb
language sql stable security definer set search_path=public
as $$
 select jsonb_build_object(
  'recipient_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id),
  'eligible_total',(select count(*)
   from mc_campaign_recipients r join mc_campaign_contacts cc on cc.phone=r.phone
   where r.campaign_id=c.id and r.excluded_reason is null and cc.consent=true
    and cc.opted_out_at is null
    and not exists(select 1 from mc_contact_exclusions e where e.phone=r.phone)),
  'excluded_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id and r.excluded_reason is not null),
  'test_status',case
   when c.test_campaign_id is null then 'NOT_SENT'
   when not exists(select 1 from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id) then 'NOT_SENT'
   when exists(select 1 from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id and j.status<>'SENT')
    then coalesce((select j.status from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id and j.status<>'SENT' order by j.step_no limit 1),'PENDING')
   else 'SENT' end,
  'has_video',exists(select 1 from jsonb_array_elements(c.steps) step where step->>'type'='VIDEO'),
  'video_supported',exists(select 1 from mc_campaign_runtime runtime
   where runtime.session_name=c.session_name and runtime.video_supported=true
   and runtime.last_seen>now()-interval '90 seconds'),
  'worker_online',exists(select 1 from mc_campaign_runtime runtime
   where runtime.session_name=c.session_name and runtime.last_seen>now()-interval '90 seconds')
 ) from mc_campaigns c where c.id=p_id
$$;
revoke all on function public.mc_campaign_readiness(uuid) from public,anon,authenticated;
grant execute on function public.mc_campaign_readiness(uuid) to service_role;
notify pgrst,'reload schema';
commit;
