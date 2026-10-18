begin;

-- Resolve only identities proven by a WAHA delivery receipt. Never guess from time alone.
create or replace function public.mc_campaign_phone_for_chat(p_chat_id text)
returns text language sql stable security definer set search_path=public as $$
  select case
    when p_chat_id ~ '^[0-9]{8,15}@(c[.]us|s[.]whatsapp[.]net)$'
      then split_part(p_chat_id,'@',1)
    when p_chat_id ~ '^[0-9]{6,20}@lid$' then (
      select r.phone
      from public.mc_outbound_jobs o
      join public.mc_campaign_recipients r on r.id=o.recipient_id
      where o.kind='CAMPAIGN' and o.status='SENT'
        and o.provider_message_id is not null
        and strpos(o.provider_message_id,'_'||p_chat_id||'_')>0
      order by o.sent_at desc nulls last, o.id desc limit 1
    )
    else null
  end;
$$;
revoke all on function public.mc_campaign_phone_for_chat(text) from public,anon,authenticated;
grant execute on function public.mc_campaign_phone_for_chat(text) to service_role;

-- Keep the existing guidance, memory, permissions and agent JSON contract.
-- Add context ONLY for a LID that matches the actual send receipt.
create or replace function public.mc_get_ai_context(
  p_chat_id text, p_history_limit integer default 30
) returns jsonb
language sql stable security definer set search_path=public as $$
with base0 as (
  select mc_get_ai_context_before_worker_guidance(p_chat_id,p_history_limit) as j
), base as (
  select jsonb_set(j,'{lead_state}',
    coalesce(j->'lead_state','{}'::jsonb) ||
    jsonb_build_object(
      'AUTO_INFERRED_CUSTOMER_INSIGHTS',mc_contact_auto_insights(p_chat_id),
      'ADAPTIVE_AI_STYLE_RULE',
      'Begin polite; infer tone and response detail from conversation; be natural, persuasive where appropriate, no fixed character cap. Avoid needless repetition. Do not invent price, package duration or proof of payment. Subscription/payment is confirmed only by owner-verified data.'
    ), true) as j from base0
), linked as (
  select mc_campaign_phone_for_chat(p_chat_id) as phone
), delivered as (
  select c.id,c.name,c.product_id,c.steps,c.bot_enabled,r.replied_at,
    o.sent_at,o.body,
    row_number() over (partition by c.id order by o.sent_at desc nulls last,o.id desc) as step_rank
  from public.mc_outbound_jobs o
  join public.mc_campaign_recipients r on r.id=o.recipient_id
  join public.mc_campaigns c on c.id=o.campaign_id
  cross join linked l
  where p_chat_id ~ '^[0-9]{6,20}@lid$'
    and l.phone is not null and r.phone=l.phone
    and o.kind='CAMPAIGN' and o.status='SENT'
    and o.sent_at > now()-interval '14 days'
), recent as (
  select id,name,product_id,steps,bot_enabled,replied_at,sent_at,body
  from delivered where step_rank=1 order by sent_at desc limit 3
), focus as (
  select r.*,k.payload->>'product_name' as product_name
  from recent r
  left join public.mc_runtime_knowledge k
    on k.kind='PRODUCT' and k.source_key=r.product_id and k.active=true
  order by r.sent_at desc limit 1
), merged_history as (
  select item,(item->>'ts')::timestamptz as ts
  from base b, lateral jsonb_array_elements(coalesce(b.j->'history','[]'::jsonb)) h(item)
  union all
  select jsonb_build_object('ts',d.sent_at,'role','assistant',
    'content',d.body,'source','verified_delivered_campaign'),d.sent_at
  from delivered d
)
select
  jsonb_set(b.j,'{lead_state}',
    coalesce(b.j->'lead_state','{}'::jsonb) ||
    case when exists(select 1 from focus)
      then jsonb_build_object(
        'LAST_DELIVERED_CAMPAIGN',
          (select jsonb_build_object('product_id',f.product_id,
            'product_name',coalesce(f.product_name,f.name),
            'campaign_name',f.name,'sent_at',f.sent_at) from focus f),
        'CAMPAIGN_REPLY_RULE',
          'Pesan samar seperti halo, jelaskan, atau mau tahu harus merujuk kampanye TERAKHIR yang benar-benar terkirim kepada kontak ini, kecuali pelanggan secara eksplisit mengganti topik. Jangan menawarkan produk lain secara acak. Jawab dari knowledge resmi. Jika tidak ada konteks terpercaya, tanyakan satu klarifikasi singkat.'
      ) else '{}'::jsonb end,true)
  || jsonb_build_object(
    'campaigns',
      case when exists(select 1 from recent)
        then coalesce((select jsonb_agg(jsonb_build_object(
          'id',id,'name',name,'product_id',product_id,'steps',steps,
          'bot_enabled',bot_enabled,'replied_at',replied_at,
          'sent_at',sent_at,'attribution','verified_delivery_receipt'
        ) order by sent_at desc) from recent),'[]'::jsonb)
        else coalesce(b.j->'campaigns','[]'::jsonb) end,
    'history',
      case when exists(select 1 from recent)
        then coalesce((select jsonb_agg(item order by ts) from (
          select item,ts from merged_history order by ts desc
          limit greatest(1,least(coalesce(p_history_limit,30),60))
        ) ordered_history),'[]'::jsonb)
        else coalesce(b.j->'history','[]'::jsonb) end,
    'campaign_focus',
      coalesce((select jsonb_build_object(
        'product_id',product_id,'product_name',coalesce(product_name,name),
        'sent_at',sent_at,'source','verified_delivery_receipt') from focus),'null'::jsonb),
    'opportunities',
      case when exists(select 1 from recent)
        then coalesce((select jsonb_agg(to_jsonb(o) order by o.updated_at desc)
          from public.mc_opportunities o cross join linked l
          where o.chat_id in (p_chat_id,l.phone||'@c.us',l.phone||'@s.whatsapp.net')),'[]'::jsonb)
        else coalesce(b.j->'opportunities','[]'::jsonb) end,
    'promotional_opt_out',
      coalesce((b.j->>'promotional_opt_out')::boolean,false)
      or coalesce((select cc.opted_out_at is not null
         from public.mc_campaign_contacts cc cross join linked l
         where cc.phone=l.phone),false)
  )
from base b;
$$;

-- Recognize replies/STOP using the same verified LID-to-phone identity.
create or replace function public.mc_campaign_inbound()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_phone text;v_stop boolean;
begin
  if new.from_me or new.is_group then return new;end if;
  v_phone := public.mc_campaign_phone_for_chat(new.chat_id);
  v_stop := lower(trim(coalesce(new.message_text,''))) in
    ('stop','unsubscribe','berhenti','jangan kirim lagi','stop promo');
  if v_phone is not null then
    update public.mc_campaign_recipients cr
      set replied_at=coalesce(cr.replied_at,now())
      where cr.phone=v_phone and exists(
        select 1 from public.mc_outbound_jobs o
        where o.recipient_id=cr.id and o.status in('SENT','UNKNOWN','PROCESSING'));
    update public.mc_outbound_jobs
      set status='CANCELLED'
      where chat_id in (new.chat_id,v_phone||'@c.us',v_phone||'@s.whatsapp.net')
        and kind='CAMPAIGN' and status in('PENDING','RETRY');
  end if;
  if v_stop then
    if v_phone is not null then
      update public.mc_campaign_contacts
        set consent=false,opted_out_at=now(),updated_at=now()
        where phone=v_phone;
    end if;
    update public.mc_followup_jobs set status='CANCELLED',processed_at=now()
      where chat_id in (new.chat_id,v_phone||'@c.us',v_phone||'@s.whatsapp.net')
        and status='PENDING';
    update public.mc_outbound_jobs set status='CANCELLED'
      where chat_id in (new.chat_id,v_phone||'@c.us',v_phone||'@s.whatsapp.net')
        and kind='FOLLOW_UP' and status in('PENDING','RETRY');
  end if;
  return new;
end;
$$;

-- Restore historical replied marker only where a receipt proves the identity.
update public.mc_campaign_recipients cr set replied_at=t.first_reply
from (
  select o.recipient_id,min(e.received_at) as first_reply
  from public.mc_outbound_jobs o
  join public.mc_inbound_events e
    on e.chat_id ~ '^[0-9]{6,20}@lid$'
   and strpos(o.provider_message_id,'_'||e.chat_id||'_')>0
   and e.received_at>o.sent_at and not e.from_me and not e.is_group
   and nullif(trim(e.message_text),'') is not null
  where o.kind='CAMPAIGN' and o.status='SENT'
  group by o.recipient_id
) t where cr.id=t.recipient_id and cr.replied_at is null;

commit;