begin;
create function public.mc_contact_control_snapshot(p_chat_id text)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'subscriptions',coalesce((
 select jsonb_agg(to_jsonb(s) order by s.updated_at desc) from
  (select id,chat_id,product_id,plan_name,amount,due_at,status,reminder_enabled,
    service_opt_in,consent_evidence,grace_days,last_paid_at,updated_at
  from mc_subscriptions where chat_id=p_chat_id order by updated_at desc limit 20)s
 ),'[]'::jsonb),
 'payments',coalesce((
 select jsonb_agg(to_jsonb(p) order by p.verified_at desc) from
  (select p.id,p.subscription_id,p.period_due_at,p.amount,p.paid_at,p.reference,p.verified_at
   from mc_subscription_payments p join mc_subscriptions s on s.id=p.subscription_id
   where s.chat_id=p_chat_id order by p.verified_at desc limit 30)p
 ),'[]'::jsonb),
 'drafts',coalesce((
 select jsonb_agg(to_jsonb(d) order by d.created_at desc) from
  (select id,chat_id,reply,status,created_at,reviewed_at
  from mc_contact_ai_drafts where chat_id=p_chat_id order by created_at desc limit 30)d
 ),'[]'::jsonb),
 'audit',coalesce((
 select jsonb_agg(to_jsonb(a) order by a.created_at desc) from
  (select id,action,detail,created_at from mc_campaign_audit
   where detail->>'chat_id'=p_chat_id order by created_at desc limit 30)a
 ),'[]'::jsonb),
 'memory',coalesce((select jsonb_build_object('summary',summary,'updated_at',updated_at)
  from mc_contact_memories where chat_id=p_chat_id),'{}'::jsonb),
 'consent',coalesce((
 select jsonb_build_object('consent',consent,'consent_at',consent_at,
  'source',source,'opted_out_at',opted_out_at)
 from mc_campaign_contacts where phone=(select phone from mc_lead_state where chat_id=p_chat_id)
 ),'{}'::jsonb)
)$$;

create function public.mc_record_contact_promo_consent(
 p_chat_id text,p_allowed boolean,p_evidence text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare l mc_lead_state%rowtype;
begin
 select * into l from mc_lead_state where chat_id=p_chat_id;
 if l.chat_id is null or l.chat_id like '%@lid' or
   l.phone !~ '^[1-9][0-9]{7,14}$' then raise exception 'Nomor WhatsApp belum terverifikasi';end if;
 if p_allowed is null then raise exception 'Status izin wajib';end if;
 if p_allowed and (p_evidence is null or length(trim(p_evidence))<12 or length(p_evidence)>500)
 then raise exception 'Catat bukti izin terbaru minimal 12 karakter';end if;
 if p_allowed then
   insert into mc_campaign_contacts(phone,name,source,consent,consent_at,opted_out_at)
   values(l.phone,coalesce(nullif(l.display_name,''),l.phone),trim(p_evidence),true,now(),null)
   on conflict(phone) do update set consent=true,consent_at=now(),
     opted_out_at=null,source=excluded.source,updated_at=now();
 else
   insert into mc_campaign_contacts(phone,name,source,consent,opted_out_at)
   values(l.phone,coalesce(nullif(l.display_name,''),l.phone),'Dihentikan owner',false,now())
   on conflict(phone) do update set consent=false,opted_out_at=now(),updated_at=now();
   update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null
     where chat_id in(l.phone||'@c.us',l.phone||'@s.whatsapp.net',p_chat_id)
     and kind in('CAMPAIGN','FOLLOW_UP') and status in('PENDING','RETRY');
 end if;
 insert into mc_campaign_audit(action,detail)values('OWNER_PROMO_CONSENT',
  jsonb_build_object('chat_id',p_chat_id,'allowed',p_allowed,
   'evidence_recorded',p_allowed,'actor','OWNER'));
 return jsonb_build_object('ok',true,'consent',p_allowed);
end $$;

revoke all on function public.mc_contact_control_snapshot(text),
 public.mc_record_contact_promo_consent(text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.mc_contact_control_snapshot(text),
 public.mc_record_contact_promo_consent(text,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;