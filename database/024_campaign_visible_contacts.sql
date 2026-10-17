begin;
alter table public.mc_campaign_contacts
 add column if not exists consent_evidence text not null default '' check(length(consent_evidence)<=500);

-- A stage-only candidate is invisible in the main contact directory until confirmed contact.
create or replace function public.mc_contact_directory_prior_pro(p_search text default '',p_limit integer default 50,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
with base as (
 select l.chat_id,l.phone,coalesce(nullif(c.name,''),nullif(l.display_name,''),l.phone,l.chat_id) name,
 coalesce(c.tags,'') tags,coalesce(c.consent,false) consent,c.opted_out_at,
 (select e.scope from mc_contact_exclusions e where e.phone=l.phone) exclusion,
 l.product_id,'WHATSAPP'::text origin,l.updated_at sort_at,l.human_takeover_until pause_until,
 l.last_customer_message_at,l.last_ai_message_at,coalesce(p.followup_enabled,true) followup_enabled,
 coalesce(p.priority,'NORMAL') priority,coalesce(p.note,'') note
 from mc_lead_state l left join mc_campaign_contacts c on c.phone=l.phone
 left join mc_contact_preferences p on p.chat_id=l.chat_id
 union all
 select c.phone||'@c.us',c.phone,c.name,c.tags,c.consent,c.opted_out_at,
 (select e.scope from mc_contact_exclusions e where e.phone=c.phone),null::text,'IMPORT',c.updated_at,
 null::timestamptz,null::timestamptz,null::timestamptz,true,'NORMAL'::text,''::text
 from mc_campaign_contacts c
 where c.source<>'CAMPAIGN_ONLY_STAGED'
 and not exists(select 1 from mc_lead_state l where l.phone=c.phone)
), ranked as (
 select *,row_number() over(partition by coalesce(phone,chat_id) order by sort_at desc,chat_id) rn from base
), filtered as (
 select chat_id,phone,name,tags,consent,opted_out_at,exclusion,product_id,origin,
 pause_until,last_customer_message_at,last_ai_message_at,followup_enabled,priority,note,sort_at
 from ranked where rn=1 and
 (nullif(trim(left(coalesce(p_search,''),80)),'') is null or
 strpos(lower(concat_ws(' ',name,phone,chat_id,tags,product_id,note)),lower(trim(left(p_search,80))))>0)
), paged as (
 select chat_id,phone,name,tags,consent,opted_out_at,exclusion,product_id,origin,
 pause_until,last_customer_message_at,last_ai_message_at,followup_enabled,priority,note
 from filtered order by (priority='IMPORTANT') desc,sort_at desc,chat_id
 limit least(greatest(coalesce(p_limit,50),1),50)
 offset least(greatest(coalesce(p_offset,0),0),100000)
)
select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
'total',(select count(*) from filtered))
$$;

create function public.mc_campaign_select_all_visible(p_search text default '')
returns jsonb language sql stable security definer set search_path=public as $$
with v as(
 select l.phone,coalesce(nullif(l.display_name,''),l.phone) name from mc_lead_state l
 where l.phone ~ '^[1-9][0-9]{7,14}$'
 union all
 select c.phone,c.name from mc_campaign_contacts c where c.phone~'^[1-9][0-9]{7,14}$'
 and c.source<>'CAMPAIGN_ONLY_STAGED'
), valid as (
 select distinct on(phone) phone from v where
 nullif(trim(left(coalesce(p_search,''),80)),'') is null or
 strpos(lower(concat_ws(' ',phone,name)),lower(trim(left(p_search,80))))>0
 order by phone
)
select jsonb_build_object('phones',coalesce((
 select jsonb_agg(phone) from (select phone from valid order by phone limit 1000)x
),'[]'::jsonb),'available',(select count(*) from valid))
$$;
revoke all on function public.mc_contact_directory_prior_pro(text,integer,integer),
public.mc_campaign_select_all_visible(text) from public,anon,authenticated;
grant execute on function public.mc_contact_directory_prior_pro(text,integer,integer),
public.mc_campaign_select_all_visible(text) to service_role;
notify pgrst,'reload schema';
commit;