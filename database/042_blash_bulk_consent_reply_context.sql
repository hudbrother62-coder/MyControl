-- Bulk promotional consent is recorded only where permission evidence exists.
-- Owner opt-outs, contact exclusions, campaign bot preferences and delivery controls remain binding.
begin;
alter function public.mc_save_campaign(jsonb) rename to mc_save_campaign_before_bulk_promo;
create function public.mc_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb;v_batch boolean;v_evidence text;v_granted integer:=0;v_skipped integer:=0;v_id uuid;
begin
 v_batch:=coalesce((p_campaign->>'bulk_consent')::boolean,false);
 v_evidence:=left(trim(coalesce(p_campaign->>'bulk_consent_evidence','')),500);
 if v_batch and length(v_evidence)<12
 then raise exception 'Izin promosi massal memerlukan bukti persetujuan yang benar (minimal 12 karakter)';end if;
 v:=public.mc_save_campaign_before_bulk_promo(p_campaign);
 v_id:=(v->>'id')::uuid;
 if v_batch then
   update public.mc_campaign_contacts cc
   set consent=true,consent_at=now(),
       consent_evidence=left('Persetujuan bersama untuk Blash '||v_id||': '||v_evidence,500),
       updated_at=now()
   from public.mc_campaign_recipients r
   where r.campaign_id=v_id and r.phone=cc.phone
     and r.excluded_reason is null
     and cc.opted_out_at is null
     and not exists (select 1 from public.mc_contact_exclusions ex where ex.phone=cc.phone);
   get diagnostics v_granted=row_count;
   select count(*) into v_skipped from public.mc_campaign_recipients r
   join public.mc_campaign_contacts cc on cc.phone=r.phone
   where r.campaign_id=v_id and (r.excluded_reason is not null or cc.opted_out_at is not null
     or exists(select 1 from public.mc_contact_exclusions ex where ex.phone=cc.phone));
   insert into public.mc_campaign_audit(campaign_id,action,detail)
   values(v_id,'BULK_CONSENT_RECORDED',jsonb_build_object(
      'applied',v_granted,'blocked_or_excluded',v_skipped,'consent_source',v_evidence));
 end if;
 return v||jsonb_build_object('bulk_consent_applied',v_granted,'bulk_consent_blocked',v_skipped);
end;
$$;
revoke all on function public.mc_save_campaign_before_bulk_promo(jsonb),public.mc_save_campaign(jsonb) from public,anon,authenticated;
grant execute on function public.mc_save_campaign(jsonb) to service_role;

-- Verified WAHA receipts associate both phone-based and LID-based replies to Blash context.
create or replace function public.mc_get_ai_context_before_cs_quality(
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
  where l.phone is not null and r.phone=l.phone
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

-- Respect campaign-specific automatic reply preference for resolved LID and ordinary phone chat IDs.
create or replace function public.mc_campaign_ai_gate()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_chat text;v_phone text;v_bot boolean;
begin
 select chat_id into v_chat from public.mc_inbound_events where id=new.inbound_event_id;
 v_phone:=public.mc_campaign_phone_for_chat(v_chat);
 if v_phone is null then return new;end if;
 select c.bot_enabled into v_bot
 from public.mc_campaigns c
 join public.mc_campaign_recipients r on r.campaign_id=c.id
 join public.mc_outbound_jobs o on o.recipient_id=r.id
 where r.phone=v_phone and o.kind='CAMPAIGN' and o.status='SENT'
 order by o.sent_at desc nulls last,o.id desc limit 1;
 if v_bot=false then return null;end if;
 return new;
end;
$$;
revoke all on function public.mc_campaign_ai_gate() from public,anon,authenticated;
grant execute on function public.mc_campaign_ai_gate() to service_role;
notify pgrst,'reload schema';
commit;
