begin;
create or replace function public.mc_contact_auto_insights(p_chat_id text)
returns jsonb language sql stable security definer set search_path=public as $$
with lead as (
 select l.* from mc_lead_state l where l.chat_id=p_chat_id
), recent as (
 select e.message_text as msg,e.received_at from mc_inbound_events e
 where e.chat_id=p_chat_id and not e.from_me and not e.is_group
 and coalesce(e.message_text,'')<>'' order by e.received_at desc limit 6
), signal as (
 select coalesce((select string_agg(left(msg,500),E'\n' order by received_at) from recent),'') as excerpts,
 coalesce((select msg from recent order by received_at desc limit 1),'') latest
), matches as (
 select o.product_id,o.stage,o.updated_at
 from mc_opportunities o where o.chat_id=p_chat_id
 order by o.updated_at desc limit 1
), subscription as (
 select s.product_id,s.plan_name,s.amount,s.due_at,s.status,s.last_paid_at
 from mc_subscriptions s where s.chat_id=p_chat_id
 order by (s.status='ACTIVE') desc,s.updated_at desc limit 1
), lead_product as (
 select coalesce((select product_id from subscription where status='ACTIVE'),
 (select product_id from lead where product_id is not null and product_id<>''),
 (select product_id from matches)) id
), inferred as (
 select case
 when exists(select 1 from subscription where status='ACTIVE' and due_at<now()) then 'OVERDUE'
 when exists(select 1 from subscription where status='ACTIVE' and due_at<=now()+interval '7 days') then 'DUE_SOON'
 when exists(select 1 from subscription where status='ACTIVE') then 'ACTIVE'
 when exists(select 1 from subscription where status='CANCELLED') then 'CHURNED'
 when exists(select 1 from orders o join customers c on c.id=o.customer_id
       where c.whatsapp_number=(select phone from lead)
       and o.status in('PAID','FULFILLED')) then 'BUYER'
 when exists(select 1 from matches where stage='WON') then 'INTERESTED'
 else 'PROSPECT' end lifecycle
), tone as (
 select case
 when lower(latest)~'(kecewa|komplain|kesal|lambat|penipuan|tolong segera|rusak)' then 'EMPATIK'
 when lower(latest)~'(jelaskan|detail|rinci|bagaimana cara|manfaat|fitur|mengapa)' then 'JELAS_DAN_INFORMATIF'
 when lower(latest)~'(bro|gan|wkwk|min |hehe|dong|nih)' then 'SANTAI_TETAP_SOPAN'
 else 'SOPAN_NATURAL' end tone from signal
)
select jsonb_build_object(
 'source','SYSTEM_DERIVED_READ_ONLY',
 'latest_customer_message',left((select latest from signal),900),
 'conversation_excerpt',left((select excerpts from signal),2500),
 'contact_product_id',(select id from lead_product),
 'product_name',(select p.name from products p where p.id=(select id from lead_product)),
 'product_confidence',case when exists(select 1 from subscription where status='ACTIVE') then 'VERIFIED_ACTIVE_SUBSCRIPTION'
  when exists(select 1 from lead where product_id is not null)then 'AI_CRM_SIGNAL'
  when exists(select 1 from matches)then 'CRM_SIGNAL' else 'UNKNOWN' end,
 'suggested_response_style',(select tone from tone),
 'inferred_lifecycle',(select lifecycle from inferred),
 'lead_status',(select lead_status from lead),
 'crm_stage',(select stage from matches),
 'subscription',coalesce((select jsonb_build_object('plan_name',plan_name,'amount',amount,
  'due_at',due_at,'status',status,'last_paid_at',last_paid_at) from subscription),'{}'::jsonb),
 'source_rules','Do not treat interest, chat claims, or CRM stage as payment confirmation; adapt style but keep polite and avoid fixed character count.'
)$$;

alter function public.mc_get_ai_context(text,integer) rename to mc_get_ai_context_before_auto_insights;
create function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public as $$
with v as(select mc_get_ai_context_before_auto_insights(p_chat_id,p_history_limit) as ctx)
select (ctx || jsonb_build_object('auto_customer_insights',mc_contact_auto_insights(p_chat_id),
 'adaptive_reply_guidance','Start polite. Adapt formality, empathy, level of detail and sales persuasion to customer message and history. No fixed character target. Reply as long as useful; do not ramble. Product benefits from official catalog. Payment only from owner-verified records.'))
#-'{lead_state,OWNER_REPLY_POLICY,response_max_chars}'
from v $$;

alter function public.mc_contact_control_snapshot(text)rename to mc_contact_control_snapshot_before_insights;
create function public.mc_contact_control_snapshot(p_chat_id text)
returns jsonb language sql stable security definer set search_path=public as $$
select mc_contact_control_snapshot_before_insights(p_chat_id)
 ||jsonb_build_object('auto_insights',mc_contact_auto_insights(p_chat_id),
 'verified_orders',coalesce((
 select jsonb_agg(to_jsonb(o) order by o.paid_at desc) from (
 select o.id,o.product_id,o.product_name,o.total,o.status,o.paid_at
 from orders o join customers c on c.id=o.customer_id
 join mc_lead_state l on l.phone=c.whatsapp_number
 where l.chat_id=p_chat_id and o.status in('PAID','FULFILLED')
 order by o.paid_at desc limit 10
 )o
 ),'[]'::jsonb))
$$;

revoke all on function public.mc_contact_auto_insights(text),
 public.mc_get_ai_context_before_auto_insights(text,integer),public.mc_get_ai_context(text,integer),
 public.mc_contact_control_snapshot_before_insights(text),public.mc_contact_control_snapshot(text)
 from public,anon,authenticated;
grant execute on function public.mc_contact_auto_insights(text),public.mc_get_ai_context(text,integer),
 public.mc_contact_control_snapshot(text) to service_role;
notify pgrst,'reload schema';
commit;