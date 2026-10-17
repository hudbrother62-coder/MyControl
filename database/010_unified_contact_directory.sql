begin;
-- Unified owner-only directory: keep WhatsApp LIDs as identities, never invent telephone numbers.
create or replace function public.mc_contact_directory(p_search text default '',p_limit integer default 50,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
with base as (
 select l.chat_id, l.phone, coalesce(nullif(c.name,''),nullif(l.display_name,''),l.phone,l.chat_id) as name,
        coalesce(c.tags,'') as tags,coalesce(c.consent,false) as consent,c.opted_out_at,
        (select e.scope from mc_contact_exclusions e where e.phone=l.phone) as exclusion,
        l.product_id, 'WHATSAPP'::text as origin, l.updated_at as sort_at
 from mc_lead_state l left join mc_campaign_contacts c on c.phone=l.phone
 union all
 select c.phone||'@c.us',c.phone,c.name,c.tags,c.consent,c.opted_out_at,
        (select e.scope from mc_contact_exclusions e where e.phone=c.phone),null::text,'IMPORT',c.updated_at
 from mc_campaign_contacts c
 where not exists(select 1 from mc_lead_state l where l.phone=c.phone)
), ranked as (
 select *,row_number() over(partition by coalesce(phone,chat_id) order by sort_at desc,chat_id) as rn from base
), filtered as (
 select chat_id,phone,name,tags,consent,opted_out_at,exclusion,product_id,origin,sort_at
 from ranked where rn=1 and
 (nullif(trim(left(coalesce(p_search,''),80)),'') is null or
 strpos(lower(concat_ws(' ',name,phone,chat_id,tags,product_id)),lower(trim(left(p_search,80))))>0)
), paged as (
 select chat_id,phone,name,tags,consent,opted_out_at,exclusion,product_id,origin
 from filtered order by sort_at desc,chat_id limit least(greatest(coalesce(p_limit,50),1),50)
 offset least(greatest(coalesce(p_offset,0),0),100000)
)
select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
'total',(select count(*) from filtered))
$$;
revoke all on function public.mc_contact_directory(text,integer,integer) from public,anon,authenticated;
grant execute on function public.mc_contact_directory(text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;