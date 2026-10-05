-- MY CONTROL / BANTU BERES SALES CONTROL CENTER
-- Additive production support schema for the AI-Agent n8n workflow.
-- Review existing schema/RLS first. Run in Supabase SQL Editor.
-- The workflow uses the service-role key server-side from n8n.

create extension if not exists pgcrypto;

create table if not exists public.mc_inbound_events (
  id uuid primary key default gen_random_uuid(),
  external_message_id text not null unique,
  event_type text,
  chat_id text not null,
  phone text,
  message_text text,
  from_me boolean not null default false,
  is_group boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table if not exists public.mc_lead_state (
  chat_id text primary key,
  phone text,
  stage text not null default 'NEW',
  product_id text,
  lead_status text not null default 'NEW',
  followup_count integer not null default 0,
  human_takeover_until timestamptz,
  last_customer_message_at timestamptz,
  last_ai_message_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.mc_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  inbound_event_id uuid not null unique references public.mc_inbound_events(id) on delete cascade,
  job_kind text not null default 'INBOUND_REPLY',
  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','RETRY','DONE','FAILED','HUMAN')),
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  requested_model text not null default 'configured-primary',
  model_used text,
  ai_slot_used smallint,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists mc_ai_jobs_claim_idx
  on public.mc_ai_jobs(status, next_retry_at, created_at);

create table if not exists public.mc_ai_decisions (
  id uuid primary key default gen_random_uuid(),
  ai_job_id uuid not null unique references public.mc_ai_jobs(id) on delete cascade,
  inbound_event_id uuid not null references public.mc_inbound_events(id) on delete cascade,
  decision jsonb not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create table if not exists public.mc_outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  inbound_event_id uuid references public.mc_inbound_events(id) on delete set null,
  chat_id text not null,
  body text not null,
  kind text not null default 'AI_REPLY',
  idempotency_key text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','RETRY','SENT','FAILED','CANCELLED')),
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists mc_outbound_jobs_claim_idx
  on public.mc_outbound_jobs(status, next_retry_at, created_at);

create table if not exists public.mc_followup_jobs (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  inbound_event_id uuid references public.mc_inbound_events(id) on delete set null,
  sequence_no integer not null check (sequence_no between 1 and 3),
  due_at timestamptz not null,
  message_text text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','DONE','CANCELLED','FAILED')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists mc_followup_due_idx
  on public.mc_followup_jobs(status, due_at);

create table if not exists public.mc_runtime_knowledge (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('PRODUCT','PROMOTION','FAQ','BOT_SETTING')),
  source_key text not null,
  payload jsonb not null,
  active boolean not null default true,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  unique(kind, source_key)
);

create table if not exists public.mc_error_log (
  id bigint generated always as identity primary key,
  correlation_id text,
  component text not null,
  category text,
  error_message text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Seed only facts already known. Empty price/promo fields are intentionally omitted.
insert into public.mc_runtime_knowledge(kind, source_key, payload, active)
values
('PRODUCT','KP001','{"product_id":"KP001","product_name":"Bantu Beres - Asisten AI Kepala Sekolah","status":"ACTIVE"}',true),
('PRODUCT','BK001','{"product_id":"BK001","product_name":"Bantu Beres Buku Kerja Digital","status":"ACTIVE"}',true),
('PRODUCT','GP001','{"product_id":"GP001","product_name":"Bantu Beres Gajian Pro","status":"ACTIVE"}',true),
('BOT_SETTING','max_followups','{"value":3}',true),
('BOT_SETTING','human_takeover_timeout_minutes','{"value":60}',true),
('BOT_SETTING','working_hours','{"start":"08:00","end":"22:00","timezone":"Asia/Jakarta"}',true)
on conflict (kind, source_key) do update
set payload=excluded.payload, active=excluded.active, synced_at=now();

create or replace function public.mc_ingest_whatsapp(
  p_external_message_id text,
  p_event_type text,
  p_chat_id text,
  p_phone text,
  p_message_text text,
  p_from_me boolean,
  p_is_group boolean,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_existing uuid;
  v_job_id uuid;
  v_takeover_until timestamptz;
begin
  select id into v_existing
  from public.mc_inbound_events
  where external_message_id=p_external_message_id;

  if v_existing is not null then
    return jsonb_build_object('duplicate',true,'event_id',v_existing,'ai_job_id',null);
  end if;

  insert into public.mc_inbound_events(
    external_message_id,event_type,chat_id,phone,message_text,from_me,is_group,payload
  ) values (
    p_external_message_id,p_event_type,p_chat_id,p_phone,p_message_text,
    coalesce(p_from_me,false),coalesce(p_is_group,false),coalesce(p_payload,'{}'::jsonb)
  )
  on conflict (external_message_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_existing from public.mc_inbound_events
    where external_message_id=p_external_message_id;
    return jsonb_build_object('duplicate',true,'event_id',v_existing,'ai_job_id',null);
  end if;

  -- Never AI-process our own message or group message.
  if coalesce(p_from_me,false) or coalesce(p_is_group,false) then
    return jsonb_build_object('duplicate',false,'ignored',true,'event_id',v_event_id,'ai_job_id',null);
  end if;

  -- New customer activity cancels old scheduled follow-ups.
  update public.mc_followup_jobs
  set status='CANCELLED', processed_at=now()
  where chat_id=p_chat_id and status='PENDING';

  insert into public.mc_lead_state(chat_id,phone,last_customer_message_at,updated_at)
  values(p_chat_id,p_phone,now(),now())
  on conflict (chat_id) do update
  set phone=coalesce(excluded.phone,mc_lead_state.phone),
      last_customer_message_at=now(),
      updated_at=now();

  select human_takeover_until into v_takeover_until
  from public.mc_lead_state where chat_id=p_chat_id;

  if v_takeover_until is not null and v_takeover_until > now() then
    return jsonb_build_object('duplicate',false,'ignored',true,'human_takeover',true,'event_id',v_event_id,'ai_job_id',null);
  end if;

  insert into public.mc_ai_jobs(inbound_event_id)
  values(v_event_id)
  returning id into v_job_id;

  return jsonb_build_object('duplicate',false,'ignored',false,'event_id',v_event_id,'ai_job_id',v_job_id);
end;
$$;

create or replace function public.mc_claim_ai_job(p_worker text default 'n8n')
returns table(
  job_id uuid,
  inbound_event_id uuid,
  job_kind text,
  attempt_count integer,
  requested_model text,
  chat_id text,
  message_text text,
  external_message_id text,
  inbound_payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select j.id into v_id
  from public.mc_ai_jobs j
  where j.status in ('PENDING','RETRY')
    and (j.next_retry_at is null or j.next_retry_at<=now())
  order by j.created_at
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.mc_ai_jobs
  set status='PROCESSING',
      locked_at=now(),
      locked_by=p_worker,
      attempt_count=attempt_count+1
  where id=v_id;

  return query
  select j.id,j.inbound_event_id,j.job_kind,j.attempt_count,j.requested_model,
         e.chat_id,e.message_text,e.external_message_id,e.payload
  from public.mc_ai_jobs j
  join public.mc_inbound_events e on e.id=j.inbound_event_id
  where j.id=v_id;
end;
$$;

create or replace function public.mc_get_ai_context(
  p_chat_id text,
  p_history_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with hist as (
  select * from (
    select e.received_at as ts,'customer'::text as role,e.message_text as content
    from public.mc_inbound_events e
    where e.chat_id=p_chat_id and not e.from_me and not e.is_group

    union all

    select o.sent_at as ts,'assistant'::text as role,o.body as content
    from public.mc_outbound_jobs o
    where o.chat_id=p_chat_id and o.status='SENT' and o.sent_at is not null
  ) q
  order by ts desc
  limit greatest(1,least(p_history_limit,60))
)
select jsonb_build_object(
  'history',coalesce((select jsonb_agg(jsonb_build_object('ts',ts,'role',role,'content',content) order by ts) from hist),'[]'::jsonb),
  'lead_state',coalesce((select to_jsonb(l) from public.mc_lead_state l where l.chat_id=p_chat_id),'{}'::jsonb),
  'knowledge',coalesce((
    select jsonb_agg(jsonb_build_object('kind',k.kind,'source_key',k.source_key,'payload',k.payload))
    from public.mc_runtime_knowledge k where k.active=true
  ),'[]'::jsonb)
);
$$;

create or replace function public.mc_complete_ai_job(
  p_job_id uuid,
  p_decision jsonb,
  p_model_used text,
  p_slot_used smallint,
  p_chat_id text,
  p_reply text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event_id uuid;
  v_outbound_id uuid;
  v_follow jsonb;
  v_seq int;
  v_after int;
  v_msg text;
  v_should_reply boolean := coalesce((p_decision->>'should_reply')::boolean,false);
  v_should_follow boolean := coalesce((p_decision->>'should_followup')::boolean,false);
  v_needs_human boolean := coalesce((p_decision->>'needs_human')::boolean,false);
  v_stage text := coalesce(nullif(p_decision->>'stage',''),'NEW');
  v_status text := coalesce(nullif(p_decision->>'lead_status',''),'NEW');
  v_product text := nullif(p_decision->>'product_id','');
begin
  select inbound_event_id into v_event_id
  from public.mc_ai_jobs where id=p_job_id for update;

  if v_event_id is null then
    raise exception 'AI job not found';
  end if;

  insert into public.mc_ai_decisions(ai_job_id,inbound_event_id,decision,applied_at)
  values(p_job_id,v_event_id,p_decision,now())
  on conflict(ai_job_id) do update
  set decision=excluded.decision,applied_at=now();

  insert into public.mc_lead_state(
    chat_id,stage,product_id,lead_status,human_takeover_until,last_ai_message_at,updated_at
  )
  values(
    p_chat_id,v_stage,v_product,v_status,
    case when v_needs_human then now()+interval '60 minutes' else null end,
    now(),now()
  )
  on conflict(chat_id) do update
  set stage=excluded.stage,
      product_id=coalesce(excluded.product_id,mc_lead_state.product_id),
      lead_status=excluded.lead_status,
      human_takeover_until=
        case when v_needs_human then now()+interval '60 minutes'
             when mc_lead_state.human_takeover_until<=now() then null
             else mc_lead_state.human_takeover_until end,
      last_ai_message_at=now(),
      updated_at=now();

  if v_should_reply and coalesce(trim(p_reply),'')<>'' then
    insert into public.mc_outbound_jobs(
      inbound_event_id,chat_id,body,kind,idempotency_key
    )
    values(
      v_event_id,p_chat_id,p_reply,'AI_REPLY','reply:'||v_event_id::text
    )
    on conflict(idempotency_key) do nothing
    returning id into v_outbound_id;
  end if;

  -- Only schedule follow-up when agent explicitly requests it and no human takeover.
  if v_should_follow
     and not v_needs_human
     and v_stage not in ('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF') then

    for v_follow in
      select value from jsonb_array_elements(coalesce(p_decision->'followup_plan','[]'::jsonb))
    loop
      v_seq := greatest(1,least(coalesce((v_follow->>'sequence_no')::int,1),3));
      v_after := greatest(60,least(coalesce((v_follow->>'after_minutes')::int,1440),10080));
      v_msg := nullif(trim(v_follow->>'message'),'');
      if v_msg is not null then
        insert into public.mc_followup_jobs(
          chat_id,inbound_event_id,sequence_no,due_at,message_text,idempotency_key
        )
        values(
          p_chat_id,v_event_id,v_seq,now()+make_interval(mins=>v_after),v_msg,
          'followup:'||v_event_id::text||':'||v_seq::text
        )
        on conflict(idempotency_key) do nothing;
      end if;
    end loop;
  end if;

  update public.mc_ai_jobs
  set status=case when v_needs_human then 'HUMAN' else 'DONE' end,
      processed_at=now(),
      model_used=p_model_used,
      ai_slot_used=p_slot_used,
      locked_at=null,
      locked_by=null,
      last_error=null
  where id=p_job_id;

  return jsonb_build_object(
    'ok',true,
    'outbound_job_id',v_outbound_id,
    'needs_human',v_needs_human
  );
end;
$$;

create or replace function public.mc_retry_ai_job(
  p_job_id uuid,p_error text,p_delay_seconds integer
)
returns void
language sql
security definer
set search_path=public
as $$
update public.mc_ai_jobs
set status='RETRY',
    next_retry_at=now()+make_interval(secs=>greatest(1,p_delay_seconds)),
    last_error=left(p_error,4000),
    locked_at=null,
    locked_by=null
where id=p_job_id;
$$;

create or replace function public.mc_fail_ai_job(
  p_job_id uuid,p_error text
)
returns void
language sql
security definer
set search_path=public
as $$
update public.mc_ai_jobs
set status='FAILED',processed_at=now(),last_error=left(p_error,4000),
    locked_at=null,locked_by=null
where id=p_job_id;
$$;

create or replace function public.mc_claim_outbound_job(p_worker text default 'n8n')
returns table(
  job_id uuid,chat_id text,body text,attempt_count integer,idempotency_key text
)
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  select id into v_id
  from public.mc_outbound_jobs
  where status in ('PENDING','RETRY')
    and (next_retry_at is null or next_retry_at<=now())
  order by created_at
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.mc_outbound_jobs
  set status='PROCESSING',locked_at=now(),locked_by=p_worker,
      attempt_count=attempt_count+1
  where id=v_id;

  return query
  select o.id,o.chat_id,o.body,o.attempt_count,o.idempotency_key
  from public.mc_outbound_jobs o where o.id=v_id;
end;
$$;

create or replace function public.mc_mark_outbound_sent(
  p_job_id uuid,p_provider_message_id text
)
returns void
language sql
security definer
set search_path=public
as $$
update public.mc_outbound_jobs
set status='SENT',sent_at=now(),provider_message_id=p_provider_message_id,
    last_error=null,locked_at=null,locked_by=null
where id=p_job_id;
$$;

create or replace function public.mc_retry_outbound_job(
  p_job_id uuid,p_error text,p_delay_seconds integer
)
returns void
language sql
security definer
set search_path=public
as $$
update public.mc_outbound_jobs
set status='RETRY',
    next_retry_at=now()+make_interval(secs=>greatest(1,p_delay_seconds)),
    last_error=left(p_error,4000),
    locked_at=null,locked_by=null
where id=p_job_id;
$$;

create or replace function public.mc_fail_outbound_job(
  p_job_id uuid,p_error text
)
returns void
language sql
security definer
set search_path=public
as $$
update public.mc_outbound_jobs
set status='FAILED',last_error=left(p_error,4000),
    locked_at=null,locked_by=null
where id=p_job_id;
$$;

create or replace function public.mc_dispatch_due_followups(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
  v_count int := 0;
  v_hour int;
  v_lead public.mc_lead_state%rowtype;
begin
  v_hour := extract(hour from (now() at time zone 'Asia/Jakarta'));

  if v_hour < 8 or v_hour >= 22 then
    return jsonb_build_object('ok',true,'dispatched',0,'reason','outside_working_hours');
  end if;

  for r in
    select f.*
    from public.mc_followup_jobs f
    where f.status='PENDING' and f.due_at<=now()
    order by f.due_at
    for update skip locked
    limit greatest(1,least(p_limit,100))
  loop
    select * into v_lead from public.mc_lead_state where chat_id=r.chat_id;

    if v_lead.chat_id is not null and (
      (v_lead.human_takeover_until is not null and v_lead.human_takeover_until>now())
      or v_lead.stage in ('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')
      or v_lead.followup_count>=3
    ) then
      update public.mc_followup_jobs
      set status='CANCELLED',processed_at=now()
      where id=r.id;
      continue;
    end if;

    insert into public.mc_outbound_jobs(
      inbound_event_id,chat_id,body,kind,idempotency_key
    )
    values(
      r.inbound_event_id,r.chat_id,r.message_text,'FOLLOW_UP','dispatch:'||r.id::text
    )
    on conflict(idempotency_key) do nothing;

    update public.mc_followup_jobs
    set status='DONE',processed_at=now()
    where id=r.id;

    update public.mc_lead_state
    set followup_count=followup_count+1,updated_at=now()
    where chat_id=r.chat_id;

    v_count := v_count+1;
  end loop;

  return jsonb_build_object('ok',true,'dispatched',v_count);
end;
$$;

create or replace function public.mc_set_human_takeover(
  p_chat_id text,p_minutes integer default 60
)
returns void
language sql
security definer
set search_path=public
as $$
insert into public.mc_lead_state(chat_id,human_takeover_until,updated_at)
values(p_chat_id,now()+make_interval(mins=>greatest(1,p_minutes)),now())
on conflict(chat_id) do update
set human_takeover_until=excluded.human_takeover_until,updated_at=now();

update public.mc_followup_jobs
set status='CANCELLED',processed_at=now()
where chat_id=p_chat_id and status='PENDING';
$$;

-- PostgREST schema cache reload
notify pgrst, 'reload schema';

-- SECURITY:
-- Use the service-role key only inside n8n/server-side.
-- Do not expose it in browser/frontend code.
-- Review EXECUTE privileges on SECURITY DEFINER functions for your environment.
