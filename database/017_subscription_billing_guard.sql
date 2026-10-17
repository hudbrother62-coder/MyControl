begin;
create table public.mc_subscriptions(
 id uuid primary key default gen_random_uuid(),
 chat_id text not null references public.mc_lead_state(chat_id) on delete restrict,
 product_id text not null references public.products(id) on delete restrict,
 plan_name text not null check(length(plan_name) between 1 and 100),
 amount numeric(12,2) not null check(amount>0),
 due_at timestamptz not null,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CANCELLED')),
 reminder_enabled boolean not null default false,
 service_opt_in boolean not null default false,
 consent_evidence text not null default '' check(length(consent_evidence)<=500),
 grace_days integer not null default 3 check(grace_days between 0 and 30),
 last_paid_at timestamptz,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(not reminder_enabled or (service_opt_in and length(trim(consent_evidence))>=8))
);
create index mc_subscriptions_chat on public.mc_subscriptions(chat_id,updated_at desc);
create table public.mc_subscription_payments(
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.mc_subscriptions(id),
 period_due_at timestamptz not null,
 amount numeric(12,2) not null check(amount>0),
 paid_at timestamptz not null,
 reference text not null default '' check(length(reference)<=500),
 verified_by text not null default 'OWNER',
 verified_at timestamptz not null default now(),
 unique(subscription_id,period_due_at)
);
create table public.mc_subscription_reminders(
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.mc_subscriptions(id),
 cycle_due_at timestamptz not null,
 day_offset integer not null check(day_offset in(-7,-3,-1,0,1)),
 revision integer not null,
 outbound_job_id uuid references public.mc_outbound_jobs(id),
 created_at timestamptz not null default now(),
 unique(subscription_id,cycle_due_at,day_offset,revision)
);
alter table public.mc_outbound_jobs
 add column billing_subscription_id uuid references public.mc_subscriptions(id),
 add column billing_cycle_due_at timestamptz;
create index mc_outbound_billing on public.mc_outbound_jobs(billing_subscription_id,status) where billing_subscription_id is not null;
do $tables$ declare t text;begin
 foreach t in array array['mc_subscriptions','mc_subscription_payments','mc_subscription_reminders'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $tables$;

create function public.mc_billing_policy_allowed(p_subscription_id uuid,p_due timestamptz,p_chat text)
returns boolean language sql stable security definer set search_path=public as $$
select exists(
 select 1 from mc_subscriptions s
 where s.id=p_subscription_id and s.chat_id=p_chat and s.status='ACTIVE'
 and s.reminder_enabled and s.service_opt_in and length(trim(s.consent_evidence))>=8
 and s.due_at=p_due
 and mc_contact_allowed(s.chat_id,'BILLING')
) $$;

create function public.mc_billing_outbound_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.kind='BILLING' and new.status in('PENDING','RETRY','PROCESSING')
 and not mc_billing_policy_allowed(new.billing_subscription_id,new.billing_cycle_due_at,new.chat_id) then
 new.status:='CANCELLED';new.locked_at:=null;new.locked_by:=null;
 new.last_error:='Pengingat tidak diizinkan atau tagihan sudah berubah';
 end if;
 return new;
end $$;
create trigger mc_billing_outbound_guard_trigger
before insert or update on public.mc_outbound_jobs
for each row execute function mc_billing_outbound_guard();

create function public.mc_schedule_subscription_reminders(p_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare s mc_subscriptions%rowtype; day_offset integer; v_id uuid; send_at timestamptz; n integer:=0;
begin
 select * into s from mc_subscriptions where id=p_id for update;
 if s.id is null then raise exception 'Langganan tidak ditemukan';end if;
 update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null,last_error='Jadwal tagihan berubah'
  where billing_subscription_id=s.id and status in('PENDING','RETRY');
 if s.status<>'ACTIVE' or not s.reminder_enabled or not s.service_opt_in then return 0;end if;
 foreach day_offset in array array[-7,-3,-1,0,1]loop
   send_at:=s.due_at+make_interval(days=>day_offset);
   if send_at<=now()+interval '60 seconds' then continue;end if;
   insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,status,next_retry_at,
    billing_subscription_id,billing_cycle_due_at)
   values(s.chat_id,
    case when day_offset<0 then 'Halo Kak, pengingat perpanjangan '||s.plan_name||'. Tagihan Rp'||
      to_char(s.amount,'FM999,999,999,990')||' jatuh tempo pada '||
      to_char(s.due_at at time zone 'Asia/Jakarta','DD/MM/YYYY HH24:MI')||' WIB. Jika sudah membayar, boleh kabari admin untuk verifikasi.'
    when day_offset=0 then 'Halo Kak, hari ini jadwal perpanjangan '||s.plan_name||' sebesar Rp'||
      to_char(s.amount,'FM999,999,999,990')||'. Mohon konfirmasi ke admin jika pembayaran sudah dilakukan.'
    else 'Halo Kak, kami ingin mengingatkan bahwa jadwal pembayaran '||s.plan_name||
      ' sudah melewati tanggal jatuh tempo. Jika sudah membayar, boleh kirim konfirmasi agar admin memverifikasi.' end,
    'BILLING','billing:'||s.id||':'||extract(epoch from s.due_at)::bigint||':'||day_offset||':'||s.revision,
    'PENDING',send_at,s.id,s.due_at) on conflict(idempotency_key) do nothing returning id into v_id;
   if v_id is not null then
    insert into mc_subscription_reminders(subscription_id,cycle_due_at,day_offset,revision,outbound_job_id)
    values(s.id,s.due_at,day_offset,s.revision,v_id) on conflict do nothing;n:=n+1;
   end if;
   v_id:=null;
 end loop;
 return n;
end $$;

create function public.mc_upsert_subscription(
 p_id uuid,p_chat_id text,p_product_id text,p_plan_name text,p_amount numeric,p_due_at timestamptz,
 p_reminder_enabled boolean,p_service_opt_in boolean,p_evidence text,p_grace_days integer
)returns jsonb language plpgsql security definer set search_path=public as $$
declare s mc_subscriptions%rowtype; n integer;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or
 not exists(select 1 from mc_lead_state where chat_id=p_chat_id) then raise exception 'Kontak tidak ditemukan';end if;
 if not exists(select 1 from products where id=p_product_id and status='ACTIVE') then raise exception 'Produk aktif tidak ditemukan';end if;
 if nullif(trim(p_plan_name),'') is null or length(p_plan_name)>100 or
 p_amount<=0 or p_amount>999999999999 or p_amount is null or p_due_at is null or
 p_grace_days not between 0 and 30 or p_grace_days is null or
 p_service_opt_in is null or p_reminder_enabled is null or p_evidence is null or length(p_evidence)>500 or
 (p_reminder_enabled and (not p_service_opt_in or length(trim(p_evidence))<8))
 then raise exception 'Data langganan atau persetujuan pengingat belum valid';end if;
 if p_id is null then
  insert into mc_subscriptions(chat_id,product_id,plan_name,amount,due_at,reminder_enabled,
   service_opt_in,consent_evidence,grace_days)
  values(p_chat_id,p_product_id,trim(p_plan_name),p_amount,p_due_at,p_reminder_enabled,p_service_opt_in,trim(p_evidence),p_grace_days)
  returning * into s;
 else
  update mc_subscriptions set product_id=p_product_id,plan_name=trim(p_plan_name),amount=p_amount,
   due_at=p_due_at,reminder_enabled=p_reminder_enabled,service_opt_in=p_service_opt_in,
   consent_evidence=trim(p_evidence),grace_days=p_grace_days,revision=revision+1,updated_at=now()
  where id=p_id and chat_id=p_chat_id and status='ACTIVE' returning * into s;
  if s.id is null then raise exception 'Langganan aktif tidak ditemukan';end if;
 end if;
 n:=mc_schedule_subscription_reminders(s.id);
 insert into mc_contact_preferences(chat_id,lifecycle)values(p_chat_id,'ACTIVE')
 on conflict(chat_id) do update set lifecycle='ACTIVE',updated_at=now();
 insert into mc_campaign_audit(action,detail) values('OWNER_SUBSCRIPTION_SAVE',
 jsonb_build_object('chat_id',p_chat_id,'subscription_id',s.id,'reminder_enabled',s.reminder_enabled,
  'service_opt_in',s.service_opt_in,'scheduled',n,'actor','OWNER'));
 return jsonb_build_object('ok',true,'id',s.id,'scheduled',n);
end $$;

create function public.mc_confirm_subscription_payment(
 p_id uuid,p_amount numeric,p_paid_at timestamptz,p_reference text
)returns jsonb language plpgsql security definer set search_path=public as $$
declare s mc_subscriptions%rowtype;v_due timestamptz;n integer;
begin
 select * into s from mc_subscriptions where id=p_id and status='ACTIVE' for update;
 if s.id is null then raise exception 'Langganan aktif tidak ditemukan';end if;
 if p_amount<=0 or p_amount is null or p_paid_at is null or p_paid_at>now()+interval '5 minutes' or
 p_reference is null or length(p_reference)>500 then raise exception 'Verifikasi pembayaran tidak valid';end if;
 insert into mc_subscription_payments(subscription_id,period_due_at,amount,paid_at,reference)
 values(s.id,s.due_at,p_amount,p_paid_at,trim(p_reference));
 v_due:=greatest(s.due_at,now())+interval '1 month';
 update mc_subscriptions set due_at=v_due,revision=revision+1,last_paid_at=p_paid_at,updated_at=now()
 where id=s.id;
 n:=mc_schedule_subscription_reminders(s.id);
 insert into mc_campaign_audit(action,detail)values('OWNER_PAYMENT_VERIFIED',
 jsonb_build_object('chat_id',s.chat_id,'subscription_id',s.id,'period_due_at',s.due_at,
  'amount',p_amount,'next_due_at',v_due,'scheduled',n,'actor','OWNER'));
 return jsonb_build_object('ok',true,'next_due_at',v_due,'scheduled',n);
end $$;

create function public.mc_cancel_subscription(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s mc_subscriptions%rowtype;
begin
 update mc_subscriptions set status='CANCELLED',reminder_enabled=false,revision=revision+1,updated_at=now()
 where id=p_id and status='ACTIVE' returning * into s;
 if s.id is null then raise exception 'Langganan aktif tidak ditemukan';end if;
 update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null
 where billing_subscription_id=s.id and status in('PENDING','RETRY');
 insert into mc_campaign_audit(action,detail)values('OWNER_SUBSCRIPTION_CANCEL',
 jsonb_build_object('chat_id',s.chat_id,'subscription_id',s.id,'actor','OWNER'));
 return jsonb_build_object('ok',true);
end $$;

-- A payment verified in web prevents old reminders even after outbound claims.
alter function public.mc_campaign_preflight(uuid,integer) rename to mc_campaign_preflight_before_billing;
create function public.mc_campaign_preflight(p_job_id uuid,p_attempt integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;
begin
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING' or j.attempt_count<>p_attempt then
  return jsonb_build_object('allowed',false,'reason','STALE_JOB');
 end if;
 if j.kind='BILLING' and not mc_billing_policy_allowed(j.billing_subscription_id,j.billing_cycle_due_at,j.chat_id) then
  update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null,
   last_error='Jadwal tagihan sudah tidak berlaku' where id=j.id;
  return jsonb_build_object('allowed',false,'reason','BILLING_PAID_OR_DISABLED');
 end if;
 return mc_campaign_preflight_before_billing(p_job_id,p_attempt);
end $$;

-- Current subscription is visible to AI as context but never proof of payment.
alter function public.mc_get_ai_context(text,integer) rename to mc_get_ai_context_before_billing;
create function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public as $$
select mc_get_ai_context_before_billing(p_chat_id,p_history_limit)||
 jsonb_build_object('subscriptions',coalesce((
  select jsonb_agg(jsonb_build_object('product_id',product_id,'plan_name',plan_name,
   'amount',amount,'due_at',due_at,'status',status,'last_verified_payment',last_paid_at,
   'reminder_enabled',reminder_enabled))
  from mc_subscriptions where chat_id=p_chat_id and status='ACTIVE'
 ),'[]'::jsonb),'payment_rule','Only owner-verified payments count; never claim a transfer is paid from customer text alone')
$$;

revoke all on function public.mc_billing_policy_allowed(uuid,timestamptz,text),public.mc_billing_outbound_guard(),
 public.mc_schedule_subscription_reminders(uuid),public.mc_upsert_subscription(uuid,text,text,text,numeric,timestamptz,boolean,boolean,text,integer),
 public.mc_confirm_subscription_payment(uuid,numeric,timestamptz,text),public.mc_cancel_subscription(uuid),
 public.mc_campaign_preflight_before_billing(uuid,integer),public.mc_campaign_preflight(uuid,integer),
 public.mc_get_ai_context_before_billing(text,integer),public.mc_get_ai_context(text,integer)
 from public,anon,authenticated;
grant execute on function public.mc_billing_policy_allowed(uuid,timestamptz,text),public.mc_schedule_subscription_reminders(uuid),
 public.mc_upsert_subscription(uuid,text,text,text,numeric,timestamptz,boolean,boolean,text,integer),
 public.mc_confirm_subscription_payment(uuid,numeric,timestamptz,text),public.mc_cancel_subscription(uuid),
 public.mc_campaign_preflight(uuid,integer),public.mc_get_ai_context(text,integer) to service_role;
notify pgrst,'reload schema';
commit;