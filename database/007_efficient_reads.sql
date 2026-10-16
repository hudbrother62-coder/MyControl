begin;
create or replace function public.mc_dashboard_summary()returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'revenue',coalesce((select sum(total)from orders where status in('PAID','FULFILLED')),0),
 'profit',coalesce((select sum(total-coalesce(cost_hpp,0))from orders where status in('PAID','FULFILLED')),0),
 'closing',(select count(*)from orders where status in('PAID','FULFILLED')),
 'pending',(select count(*)from leads where status in('FOLLOW_UP','PENDING'))+(select count(*)from mc_lead_state where lead_status in('FOLLOW_UP','PENDING')),
 'verify',(select count(*)from payment_verifications where status in('WAITING_ANALYSIS','WAITING_OWNER','MANUAL_REVIEW')),
 'lead_total',(select count(*)from leads),'lead_closing',(select count(*)from leads where status='CLOSING'),
 'crm_stages',coalesce((select jsonb_object_agg(stage,n)from(select stage,count(*)n from mc_opportunities group by stage)t),'{}'::jsonb),
 'by_product',coalesce((select jsonb_agg(p)from(select product_name as product,count(*)qty,sum(total)total from orders where status in('PAID','FULFILLED')group by product_name order by sum(total)desc limit 50)p),'[]'::jsonb))
$$;
create or replace function public.mc_chat_page(p_chat text,p_before timestamptz default null,p_before_id uuid default null)returns jsonb language sql stable security definer set search_path=public as $$
 with messages as(
 select e.id,e.received_at ts,e.chat_id,'IN'::text direction,'CUSTOMER'::text sender,e.message_text body,null::text status from mc_inbound_events e where e.chat_id=p_chat and not e.from_me and not e.is_group and(p_before is null or(e.received_at,e.id)<(p_before,p_before_id))
 union all
 select o.id,coalesce(o.sent_at,o.created_at)ts,o.chat_id,'OUT'::text,case when o.kind='MANUAL'then 'OWNER'when o.kind='CAMPAIGN'then 'CAMPAIGN'else 'AI'end,o.body,o.status from mc_outbound_jobs o where o.chat_id=p_chat and(p_before is null or(coalesce(o.sent_at,o.created_at),o.id)<(p_before,p_before_id))
 ),paged as(select * from messages order by ts desc,id desc limit 51),shown as(select * from paged order by ts desc,id desc limit 50)
 select jsonb_build_object('messages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'conversationId',chat_id,'direction',direction,'sender',sender,'text',body,'createdAt',ts,'status',status)order by ts,id)from shown),'[]'::jsonb),'hasMore',(select count(*)>50 from paged))
$$;
create or replace function public.mc_campaign_list(p_offset integer default 0)returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb)from(
 select c.id,c.name,c.product_id,c.status,c.created_at,jsonb_array_length(c.steps)as step_count,
 (select count(*)from mc_campaign_recipients r where r.campaign_id=c.id)recipients,
 (select count(*)from mc_campaign_recipients r where r.campaign_id=c.id and r.replied_at is not null)replies,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id)total,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.status='SENT')accepted,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.status='UNKNOWN')unknown
 from mc_campaigns c order by c.created_at desc,c.id limit 20 offset greatest(0,least(p_offset,100000)))x
$$;
create index if not exists mc_inbound_chat_recent_idx on mc_inbound_events(chat_id,received_at desc,id desc)where not from_me and not is_group;
create index if not exists mc_outbound_chat_recent_idx on mc_outbound_jobs(chat_id,(coalesce(sent_at,created_at))desc,id desc);
create index if not exists mc_contacts_recent_idx on mc_campaign_contacts(created_at desc,phone);
create index if not exists mc_opportunities_recent_idx on mc_opportunities(updated_at desc,id);
create index if not exists mc_recipients_page_idx on mc_campaign_recipients(campaign_id,phone);
create index if not exists mc_campaign_recent_idx on mc_campaigns(created_at desc,id);
create index if not exists mc_receipts_recipient_idx on mc_outbound_jobs(recipient_id,step_no);
create index if not exists mc_lead_recent_idx on mc_lead_state(updated_at desc,chat_id);
create index if not exists mc_messages_conversation_recent_idx on messages(conversation_id,created_at desc,id desc);
create index if not exists mc_orders_recent_idx on orders(created_at desc,id);
create index if not exists mc_payments_recent_idx on payment_verifications(created_at desc,id);
create index if not exists mc_orders_status_idx on orders(status);
revoke all on function mc_dashboard_summary(),mc_chat_page(text,timestamptz,uuid),mc_campaign_list(integer)from public,anon,authenticated;
grant execute on function mc_dashboard_summary(),mc_chat_page(text,timestamptz,uuid),mc_campaign_list(integer)to service_role;
notify pgrst,'reload schema';commit;
