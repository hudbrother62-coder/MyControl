begin;
alter function public.mc_contact_auto_insights(text) rename to mc_contact_auto_insights_before_mentions;
create function public.mc_contact_auto_insights(p_chat_id text)
returns jsonb language sql stable security definer set search_path=public as $$
with old as(select mc_contact_auto_insights_before_mentions(p_chat_id) j),
recent as (
 select lower(coalesce(string_agg(left(e.message_text,500),' ' order by e.received_at desc),'')) txt
 from (select message_text,received_at from mc_inbound_events where chat_id=p_chat_id
 and not from_me and not is_group and message_text is not null
 order by received_at desc limit 6)e
), matching as (
 select p.id,p.name from products p,recent r
 where p.status='ACTIVE'
 and length(trim(regexp_replace(lower(p.name),'^(bantu beres\s*[-—]?\s*)','','i')))>4
 and strpos(r.txt,trim(regexp_replace(lower(p.name),'^(bantu beres\s*[-—]?\s*)','','i')))>0
 order by length(p.name) desc limit 1
), package as (
 select trim(substring(txt from '(paket[[:space:]]+[a-z0-9][a-z0-9 ._-]{2,55})')) mentioned from recent
)
select j || jsonb_build_object(
 'contact_product_id',coalesce(j->>'contact_product_id',(select id from matching)),
 'product_name',coalesce(j->>'product_name',(select name from matching)),
 'product_confidence',case when j->>'contact_product_id' is not null then j->>'product_confidence'
  when exists(select 1 from matching) then 'CHAT_MENTION_UNVERIFIED' else 'UNKNOWN' end,
 'mentioned_package_unverified',(select mentioned from package),
 'important','Chat mentions and inferred plan names are NOT proof of a purchased subscription or consent.')
from old $$;
revoke all on function public.mc_contact_auto_insights_before_mentions(text),
 public.mc_contact_auto_insights(text) from public,anon,authenticated;
grant execute on function public.mc_contact_auto_insights(text) to service_role;
notify pgrst,'reload schema';
commit;