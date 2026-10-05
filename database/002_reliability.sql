-- Prepared migration; apply after 001_queue.sql. Not applied to production by this change.
begin;
alter table mc_ai_jobs alter column requested_model set default 'configured-primary';
alter table mc_lead_state add column if not exists display_name text;
alter table mc_lead_state add column if not exists notes text not null default '';
alter table mc_lead_state add column if not exists estimated_value numeric not null default 0;
alter table public.mc_outbound_jobs drop constraint if exists mc_outbound_jobs_status_check;
alter table public.mc_outbound_jobs add constraint mc_outbound_jobs_status_check check(status in ('PENDING','PROCESSING','RETRY','SENT','FAILED','CANCELLED','UNKNOWN'));
create table if not exists public.mc_telegram_updates(update_id bigint primary key,status text not null check(status in ('PROCESSING','DONE','UNKNOWN')),error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
insert into mc_runtime_knowledge(kind,source_key,payload)values('BOT_SETTING','bot_enabled','{"value":false}'),('BOT_SETTING','ai_auto_reply','{"value":true}')on conflict(kind,source_key)do nothing;
create or replace function public.mc_bot_enabled() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select (payload->>'value')::boolean from mc_runtime_knowledge where kind='BOT_SETTING' and source_key='bot_enabled' and active),false) and coalesce((select (payload->>'value')::boolean from mc_runtime_knowledge where kind='BOT_SETTING' and source_key='ai_auto_reply' and active),true)$$;
create or replace function public.mc_ingest_whatsapp(p_external_message_id text,p_event_type text,p_chat_id text,p_phone text,p_message_text text,p_from_me boolean,p_is_group boolean,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_job uuid;v_takeover timestamptz;
begin
 if nullif(trim(p_external_message_id),'')is null or p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid|g\.us)$' or p_event_type not in ('message','message.any')then raise exception 'Invalid inbound payload';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_chat_id,0));
 insert into mc_inbound_events(external_message_id,event_type,chat_id,phone,message_text,from_me,is_group,payload)values(p_external_message_id,p_event_type,p_chat_id,p_phone,left(p_message_text,10000),coalesce(p_from_me,false),coalesce(p_is_group,false),coalesce(p_payload,'{}'))on conflict(external_message_id)do nothing returning id into v_id;
 if v_id is null then return jsonb_build_object('duplicate',true);end if;
 if coalesce(p_from_me,false)or coalesce(p_is_group,false)then return jsonb_build_object('ignored',true,'event_id',v_id);end if;
 update mc_followup_jobs set status='CANCELLED',processed_at=now() where chat_id=p_chat_id and status='PENDING';
 update mc_outbound_jobs set status='CANCELLED' where chat_id=p_chat_id and kind in('FOLLOW_UP','AI_REPLY') and status in('PENDING','RETRY');
 insert into mc_lead_state(chat_id,phone,last_customer_message_at)values(p_chat_id,p_phone,now())on conflict(chat_id)do update set phone=excluded.phone,last_customer_message_at=now(),updated_at=now();
 select human_takeover_until into v_takeover from mc_lead_state where chat_id=p_chat_id;
 if not mc_bot_enabled()or v_takeover>now()then return jsonb_build_object('ignored',true,'event_id',v_id);end if;
 if nullif(trim(p_message_text),'')is null then perform mc_set_human_takeover(p_chat_id,60);return jsonb_build_object('needs_human',true,'event_id',v_id);end if;
 insert into mc_ai_jobs(inbound_event_id)values(v_id)returning id into v_job;
 return jsonb_build_object('duplicate',false,'event_id',v_id,'ai_job_id',v_job);
end$$;
create or replace function public.mc_claim_ai_job(p_worker text default 'n8n')returns table(job_id uuid,inbound_event_id uuid,job_kind text,attempt_count integer,requested_model text,chat_id text,message_text text,external_message_id text,inbound_payload jsonb)language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not mc_bot_enabled()then return;end if;
 select j.id into v_id from mc_ai_jobs j join mc_inbound_events e on e.id=j.inbound_event_id join mc_lead_state l on l.chat_id=e.chat_id where j.status in('PENDING','RETRY')and(j.next_retry_at is null or j.next_retry_at<=now())and(l.human_takeover_until is null or l.human_takeover_until<=now())and pg_try_advisory_xact_lock(hashtextextended(e.chat_id,0))and not exists(select 1 from mc_ai_jobs other join mc_inbound_events oe on oe.id=other.inbound_event_id where oe.chat_id=e.chat_id and other.status='PROCESSING') order by j.created_at for update of j skip locked limit 1;
 if v_id is null then return;end if;
 if exists(select 1 from mc_ai_jobs busy join mc_inbound_events be on be.id=busy.inbound_event_id where busy.status='PROCESSING'and be.chat_id=(select e.chat_id from mc_inbound_events e join mc_ai_jobs chosen on chosen.inbound_event_id=e.id where chosen.id=v_id))then return;end if;
 update mc_ai_jobs j set status='PROCESSING',locked_at=now(),locked_by=p_worker,attempt_count=j.attempt_count+1 where j.id=v_id;
 return query select j.id,j.inbound_event_id,j.job_kind,j.attempt_count,j.requested_model,e.chat_id,e.message_text,e.external_message_id,e.payload from mc_ai_jobs j join mc_inbound_events e on e.id=j.inbound_event_id where j.id=v_id;
end$$;
create or replace function public.mc_complete_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text)returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_ai_jobs%rowtype;e mc_inbound_events%rowtype;l mc_lead_state%rowtype;v_out uuid;f jsonb;seq integer;mins integer;needs boolean;follow boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_chat_id,0));
 select * into j from mc_ai_jobs where id=p_job_id for update;
 if j.id is null then raise exception 'AI job not found';end if;
 select * into e from mc_inbound_events where id=j.inbound_event_id;
 if e.chat_id<>p_chat_id then raise exception 'Job/chat mismatch';end if;
 if j.status in('DONE','HUMAN')then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if j.status<>'PROCESSING' or j.locked_at<now()-interval '10 minutes' then raise exception 'Job is not an active claim';end if;
 if jsonb_typeof(p_decision)<>'object' or jsonb_typeof(p_decision->'should_reply')is distinct from 'boolean' or jsonb_typeof(p_decision->'needs_human')is distinct from 'boolean' or jsonb_typeof(p_decision->'should_followup')is distinct from 'boolean' or jsonb_typeof(p_decision->'reply')is distinct from 'string' or p_reply is distinct from p_decision->>'reply' or length(p_reply)>4000 then raise exception 'Invalid decision';end if;
 if coalesce(p_decision->>'stage','')not in('NEW','CONTACTED','PRODUCT_INTEREST','INTERESTED','FOLLOW_UP','PENDING','CHECKOUT','AWAITING_PAYMENT','PAYMENT_SUBMITTED','WAITING_OWNER_APPROVAL','WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')then raise exception 'Invalid stage';end if;
 select * into l from mc_lead_state where chat_id=p_chat_id for update;
 if not mc_bot_enabled()or l.human_takeover_until>now()or exists(select 1 from mc_inbound_events newer where newer.chat_id=p_chat_id and not newer.from_me and not newer.is_group and newer.received_at>e.received_at)then update mc_ai_jobs set status='HUMAN',processed_at=now(),locked_at=null,locked_by=null,last_error='Stale decision or bot paused'where id=p_job_id;return jsonb_build_object('ok',true,'suppressed',true);end if;
 needs=(p_decision->>'needs_human')::boolean;follow=(p_decision->>'should_followup')::boolean;
 insert into mc_ai_decisions(ai_job_id,inbound_event_id,decision,applied_at)values(p_job_id,e.id,p_decision,now())on conflict(ai_job_id)do nothing;
 update mc_lead_state set stage=p_decision->>'stage',lead_status=coalesce(nullif(p_decision->>'lead_status',''),stage),product_id=coalesce(nullif(p_decision->>'product_id',''),product_id),human_takeover_until=case when needs then now()+interval '60 minutes'else human_takeover_until end,updated_at=now() where chat_id=p_chat_id;
 if (p_decision->>'should_reply')::boolean and nullif(trim(p_reply),'')is not null and not needs then insert into mc_outbound_jobs(inbound_event_id,chat_id,body,kind,idempotency_key)values(e.id,p_chat_id,p_reply,'AI_REPLY','reply:'||e.id)on conflict(idempotency_key)do nothing returning id into v_out;end if;
 if follow and not needs and p_decision->>'stage'not in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')then
  if jsonb_typeof(p_decision->'followup_plan')is distinct from 'array' or jsonb_array_length(p_decision->'followup_plan')>3 then raise exception 'Invalid follow-up plan';end if;
  for f in select value from jsonb_array_elements(p_decision->'followup_plan')loop
   seq=(f->>'sequence_no')::integer;mins=(f->>'after_minutes')::integer;
   if seq not between 1 and 3 or mins not between 60 and 10080 or nullif(trim(f->>'message'),'')is null or length(f->>'message')>4000 then raise exception 'Invalid follow-up item';end if;
   insert into mc_followup_jobs(chat_id,inbound_event_id,sequence_no,due_at,message_text,idempotency_key)values(p_chat_id,e.id,seq,now()+make_interval(mins=>mins),f->>'message','followup:'||e.id||':'||seq)on conflict(idempotency_key)do nothing;
  end loop;
 end if;
 if v_out is not null then update mc_outbound_jobs set next_retry_at=now()+make_interval(secs=>least(60,greatest(0,coalesce((select (payload->>'value')::integer from mc_runtime_knowledge where kind='BOT_SETTING'and source_key='reply_delay_min_seconds'),3))))where id=v_out;end if;
 update mc_ai_jobs set status=case when needs then 'HUMAN'else 'DONE'end,processed_at=now(),model_used=p_model_used,ai_slot_used=p_slot_used,locked_at=null,locked_by=null,last_error=null where id=p_job_id;
 return jsonb_build_object('ok',true,'outbound_job_id',v_out,'needs_human',needs);
end$$;
create or replace function public.mc_claim_outbound_job(p_worker text default 'n8n')returns table(job_id uuid,chat_id text,body text,attempt_count integer,idempotency_key text)language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 update mc_outbound_jobs o set status='CANCELLED'from mc_lead_state l where l.chat_id=o.chat_id and o.kind<>'MANUAL' and o.status in('PENDING','RETRY')and(l.human_takeover_until>now()or(l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')and o.kind='FOLLOW_UP'));
 select o.id into v_id from mc_outbound_jobs o where o.status in('PENDING','RETRY')and(o.next_retry_at is null or o.next_retry_at<=now())and(o.kind='MANUAL'or mc_bot_enabled())order by o.created_at for update of o skip locked limit 1;
 if v_id is null then return;end if;
 update mc_outbound_jobs o set status='PROCESSING',locked_at=now(),locked_by=p_worker,attempt_count=o.attempt_count+1 where o.id=v_id;
 return query select o.id,o.chat_id,o.body,o.attempt_count,o.idempotency_key from mc_outbound_jobs o where o.id=v_id;
end$$;
create or replace function public.mc_unknown_outbound_job(p_job_id uuid,p_error text)returns void language sql security definer set search_path=public as $$update mc_outbound_jobs set status='UNKNOWN',last_error=left(p_error,4000),locked_at=null,locked_by=null where id=p_job_id and status='PROCESSING'$$;
create or replace function public.mc_mark_outbound_sent(p_job_id uuid,p_provider_message_id text)returns void language plpgsql security definer set search_path=public as $$begin
 if nullif(trim(p_provider_message_id),'')is null then raise exception 'Provider receipt missing';end if;
 update mc_outbound_jobs set status='SENT',sent_at=now(),provider_message_id=p_provider_message_id,last_error=null,locked_at=null,locked_by=null where id=p_job_id and status in('PROCESSING','UNKNOWN');
 update mc_lead_state l set last_ai_message_at=now()from mc_outbound_jobs o where o.id=p_job_id and o.chat_id=l.chat_id and o.status='SENT'and o.kind<>'MANUAL';
end$$;
create or replace function public.mc_recover_expired_jobs()returns jsonb language plpgsql security definer set search_path=public as $$declare a integer;o integer;begin
 update mc_ai_jobs set status=case when attempt_count>=5 then 'FAILED'else 'RETRY'end,next_retry_at=now()+interval '30 seconds',locked_at=null,locked_by=null,last_error='Expired AI lease'where status='PROCESSING'and locked_at<now()-interval '10 minutes';get diagnostics a=row_count;
 update mc_outbound_jobs set status='UNKNOWN',locked_at=null,locked_by=null,last_error='Expired send lease; reconcile provider before retry'where status='PROCESSING'and locked_at<now()-interval '2 minutes';get diagnostics o=row_count;
 return jsonb_build_object('ai_recovered',a,'outbound_unknown',o);end$$;
create or replace function public.mc_control_takeover(p_chat_id text,p_enabled boolean)returns jsonb language plpgsql security definer set search_path=public as $$begin
 perform pg_advisory_xact_lock(hashtextextended(p_chat_id,0));
 insert into mc_lead_state(chat_id,human_takeover_until)values(p_chat_id,case when p_enabled then 'infinity'::timestamptz else null end)on conflict(chat_id)do update set human_takeover_until=excluded.human_takeover_until,updated_at=now();
 if p_enabled then
 update mc_followup_jobs set status='CANCELLED',processed_at=now()where chat_id=p_chat_id and status='PENDING';
 update mc_outbound_jobs set status='CANCELLED'where chat_id=p_chat_id and kind<>'MANUAL'and status in('PENDING','RETRY');
 update mc_ai_jobs j set status='HUMAN',locked_at=null,locked_by=null from mc_inbound_events e where e.id=j.inbound_event_id and e.chat_id=p_chat_id and j.status in('PENDING','RETRY','PROCESSING');
 end if;return jsonb_build_object('ok',true);end$$;
create or replace function public.mc_manual_send(p_chat_id text,p_body text,p_request_id text)returns jsonb language plpgsql security definer set search_path=public as $$declare v_id uuid;begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or length(trim(p_body))not between 1 and 4000 or length(p_request_id)not between 16 and 80 then raise exception 'Invalid manual message';end if;
 perform mc_control_takeover(p_chat_id,true);
 insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)values(p_chat_id,p_body,'MANUAL','manual:'||p_request_id)on conflict(idempotency_key)do nothing returning id into v_id;
 if v_id is null then select id into v_id from mc_outbound_jobs where idempotency_key='manual:'||p_request_id and chat_id=p_chat_id and body=p_body;if v_id is null then raise exception 'Idempotency key conflict';end if;end if;
 return jsonb_build_object('ok',true,'outbound_job_id',v_id,'status','QUEUED');end$$;
create or replace function public.mc_claim_telegram_update(p_update_id bigint)returns jsonb language plpgsql security definer set search_path=public as $$declare n integer;begin insert into mc_telegram_updates(update_id,status)values(p_update_id,'PROCESSING')on conflict(update_id)do nothing;get diagnostics n=row_count;return jsonb_build_object('claimed',n=1);end$$;
create or replace function public.mc_finish_telegram_update(p_update_id bigint,p_status text,p_error text)returns void language sql security definer set search_path=public as $$update mc_telegram_updates set status=p_status,error=left(p_error,2000),updated_at=now()where update_id=p_update_id and status='PROCESSING'$$;
-- In production these roles already exist. Never expose queue mutations to browser roles.
do $$declare t record;f record;begin
 for t in select tablename from pg_tables where schemaname='public'and tablename like 'mc\_%'escape '\' loop execute format('alter table public.%I enable row level security',t.tablename);execute format('revoke all on table public.%I from public, anon, authenticated',t.tablename);execute format('grant all on table public.%I to service_role',t.tablename);end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'mc\_%'escape '\'loop execute format('revoke all on function %s from public, anon, authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end$$;

-- Lease fencing: workers cannot finish a later attempt using a stale earlier claim.
create or replace function public.mc_commit_claimed_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text,p_claim_attempt integer)returns jsonb language plpgsql security definer set search_path=public as $$declare j mc_ai_jobs%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended(p_chat_id,0));select * into j from mc_ai_jobs where id=p_job_id for update;if j.attempt_count is distinct from p_claim_attempt then raise exception 'Stale claim';end if;return mc_complete_ai_job(p_job_id,p_decision,p_model_used,p_slot_used,p_chat_id,p_reply);end$$;
create or replace function public.mc_end_ai_claim(p_job_id uuid,p_claim_attempt integer,p_error text,p_status text,p_delay_seconds integer default 30)returns void language plpgsql security definer set search_path=public as $$begin
 if p_status not in('RETRY','FAILED')then raise exception 'Invalid job result';end if;
 update mc_ai_jobs set status=p_status,next_retry_at=case when p_status='RETRY'then now()+make_interval(secs=>greatest(1,p_delay_seconds))else null end,last_error=left(p_error,4000),locked_at=null,locked_by=null where id=p_job_id and attempt_count=p_claim_attempt and status='PROCESSING';
 if found then insert into mc_error_log(correlation_id,component,category,error_message)values(p_job_id::text,'AI_WORKER',p_status,left(p_error,4000));end if;end$$;
revoke all on function public.mc_commit_claimed_ai_job(uuid,jsonb,text,smallint,text,text,integer),public.mc_end_ai_claim(uuid,integer,text,text,integer)from public,anon,authenticated;
grant execute on function public.mc_commit_claimed_ai_job(uuid,jsonb,text,smallint,text,text,integer),public.mc_end_ai_claim(uuid,integer,text,text,integer)to service_role;
create or replace function public.mc_dispatch_due_followups(p_limit integer default 25)returns jsonb language plpgsql security definer set search_path=public as $$declare r record;l mc_lead_state%rowtype;n integer:=0;local_time text;start_time text;end_time text;max_count integer;begin
 if not mc_bot_enabled()then return jsonb_build_object('dispatched',0,'reason','bot_paused');end if;
 local_time=to_char(now()at time zone'Asia/Jakarta','HH24:MI');
 select coalesce(payload->>'value','08:00')into start_time from mc_runtime_knowledge where kind='BOT_SETTING'and source_key='working_hours_start';start_time=coalesce(start_time,'08:00');
 select coalesce(payload->>'value','22:00')into end_time from mc_runtime_knowledge where kind='BOT_SETTING'and source_key='working_hours_end';end_time=coalesce(end_time,'22:00');
 if(start_time<end_time and(local_time<start_time or local_time>=end_time))or(start_time>end_time and local_time<start_time and local_time>=end_time)then return jsonb_build_object('dispatched',0,'reason','outside_working_hours');end if;
 select least(3,greatest(0,(payload->>'value')::integer))into max_count from mc_runtime_knowledge where kind='BOT_SETTING'and source_key='max_followups';max_count=coalesce(max_count,3);
 for r in select * from mc_followup_jobs where status='PENDING'and due_at<=now()order by due_at for update skip locked limit greatest(1,least(p_limit,100))loop
  select * into l from mc_lead_state where chat_id=r.chat_id for update;
  if l.human_takeover_until>now()or l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')or l.followup_count>=max_count or exists(select 1 from mc_inbound_events where id=r.inbound_event_id and received_at<l.last_customer_message_at)then update mc_followup_jobs set status='CANCELLED',processed_at=now()where id=r.id;continue;end if;
  insert into mc_outbound_jobs(inbound_event_id,chat_id,body,kind,idempotency_key)values(r.inbound_event_id,r.chat_id,r.message_text,'FOLLOW_UP','dispatch:'||r.id)on conflict(idempotency_key)do nothing;
  update mc_followup_jobs set status='DONE',processed_at=now()where id=r.id;update mc_lead_state set followup_count=followup_count+1 where chat_id=r.chat_id;n=n+1;
 end loop;return jsonb_build_object('dispatched',n);end$$;
revoke all on function public.mc_dispatch_due_followups(integer)from public,anon,authenticated;grant execute on function public.mc_dispatch_due_followups(integer)to service_role;

notify pgrst,'reload schema';
commit;
