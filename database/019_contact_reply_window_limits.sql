begin;
alter table public.mc_contact_preferences
 add column reply_window_enabled boolean not null default false,
 add column reply_window_start time not null default '08:00',
 add column reply_window_end time not null default '22:00',
 add column reply_cooldown_seconds integer not null default 3 check(reply_cooldown_seconds between 0 and 120),
 add column max_reply_chars integer not null default 350 check(max_reply_chars between 80 and 1200);

create function public.mc_contact_next_send_time(p_chat_id text,p_include_delay boolean default true)
returns timestamptz language plpgsql stable security definer set search_path=public as $$
declare p mc_contact_preferences%rowtype;local_ts timestamp;local_date date;local_time time;result_time timestamptz;
begin
 select * into p from mc_contact_preferences where chat_id=p_chat_id;
 if p.chat_id is null then return now();end if;
 result_time:=now()+make_interval(secs=>case when p_include_delay then p.reply_cooldown_seconds else 0 end);
 if not p.reply_window_enabled then return result_time;end if;
 local_ts:=result_time at time zone 'Asia/Jakarta';
 local_date:=local_ts::date;local_time:=local_ts::time;
 if p.reply_window_start=p.reply_window_end then return result_time;end if;
 if p.reply_window_start<p.reply_window_end then
  if local_time>=p.reply_window_start and local_time<p.reply_window_end then return result_time;end if;
  if local_time<p.reply_window_start then
   return (local_date+p.reply_window_start) at time zone 'Asia/Jakarta';
  end if;
  return ((local_date+1)+p.reply_window_start) at time zone 'Asia/Jakarta';
 else
  if local_time>=p.reply_window_start or local_time<p.reply_window_end then return result_time;end if;
  return (local_date+p.reply_window_start) at time zone 'Asia/Jakarta';
 end if;
end $$;

create function public.mc_set_contact_reply_policy(
 p_chat_id text,p_enabled boolean,p_start time,p_end time,p_cooldown integer,p_max_chars integer
)returns jsonb language plpgsql security definer set search_path=public as $$
declare p mc_contact_preferences%rowtype;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or
 not exists(select 1 from mc_lead_state where chat_id=p_chat_id) then raise exception 'Kontak tidak ditemukan';end if;
 if p_enabled is null or p_start is null or p_end is null or p_cooldown not between 0 and 120 or
 p_cooldown is null or p_max_chars not between 80 and 1200 or p_max_chars is null
 then raise exception 'Jadwal/karakter tidak valid';end if;
 insert into mc_contact_preferences(chat_id,reply_window_enabled,reply_window_start,reply_window_end,reply_cooldown_seconds,max_reply_chars)
 values(p_chat_id,p_enabled,p_start,p_end,p_cooldown,p_max_chars)
 on conflict(chat_id) do update set reply_window_enabled=excluded.reply_window_enabled,
 reply_window_start=excluded.reply_window_start,reply_window_end=excluded.reply_window_end,
 reply_cooldown_seconds=excluded.reply_cooldown_seconds,max_reply_chars=excluded.max_reply_chars,updated_at=now()
 returning * into p;
 insert into mc_campaign_audit(action,detail) values('OWNER_CONTACT_REPLY_POLICY',
  jsonb_build_object('chat_id',p_chat_id,'enabled',p_enabled,'cooldown',p_cooldown,'max_chars',p_max_chars,'actor','OWNER'));
 return jsonb_build_object('ok',true,'reply_window_enabled',p.reply_window_enabled,
  'reply_window_start',to_char(p.reply_window_start,'HH24:MI'),'reply_window_end',to_char(p.reply_window_end,'HH24:MI'),
  'reply_cooldown_seconds',p.reply_cooldown_seconds,'max_reply_chars',p.max_reply_chars);
end $$;

-- AI sees the response policy in owner-authorized context, not customer-visible messages.
alter function public.mc_get_ai_context(text,integer)rename to mc_get_ai_context_before_reply_policy;
create function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public as $$
with ctx as(select mc_get_ai_context_before_reply_policy(p_chat_id,p_history_limit) j)
select jsonb_set(j,'{lead_state}',coalesce(j->'lead_state','{}'::jsonb)||
 jsonb_build_object('OWNER_REPLY_POLICY',coalesce((
  select jsonb_build_object('response_max_chars',max_reply_chars,'reply_window_enabled',reply_window_enabled,
   'reply_window_start',to_char(reply_window_start,'HH24:MI'),
   'reply_window_end',to_char(reply_window_end,'HH24:MI'),
   'timezone','Asia/Jakarta','cooldown_seconds',reply_cooldown_seconds)
  from mc_contact_preferences where chat_id=p_chat_id
 ),'{}'::jsonb)),true)from ctx $$;

-- A contact-specific cap cannot be bypassed by a global follow-up setting.
create or replace function public.mc_contact_allowed(p_chat text,p_kind text)
returns boolean language sql stable security definer set search_path=public as $$
select p_kind='MANUAL' or (
 not exists(
  select 1 from mc_contact_exclusions e where e.phone=case
   when p_chat~'^[0-9]+@(c\.us|s\.whatsapp\.net)$'then split_part(p_chat,'@',1)
   when p_chat~'^[1-9][0-9]{7,14}$' then p_chat
   else(select phone from mc_lead_state where chat_id=p_chat and phone~'^[1-9][0-9]{7,14}$')end
  and(e.scope='ALL_AUTOMATION' or p_kind in('CAMPAIGN','FOLLOW_UP'))
 )
 and (p_kind not in('AI_REPLY','FOLLOW_UP') or not exists (
  select 1 from mc_lead_state l where l.chat_id=p_chat and l.human_takeover_until>now()
 ))
 and (p_kind not in('AI_REPLY','FOLLOW_UP') or not exists(
  select 1 from mc_contact_preferences p where p.chat_id=p_chat and p.automation_mode='MANUAL'
 ))
 and (p_kind<>'FOLLOW_UP' or not exists(
  select 1 from mc_contact_preferences p left join mc_lead_state l on l.chat_id=p.chat_id
   where p.chat_id=p_chat and (not p.followup_enabled or p.automation_mode='HYBRID'
    or coalesce(l.followup_count,0)>=p.max_followups)
 ))
)$$;

-- Apply contact's response window/cooldown after the AI has completed the decision.
alter function public.mc_complete_ai_job(uuid,jsonb,text,smallint,text,text) rename to mc_complete_ai_job_before_reply_policy;
create function public.mc_complete_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; v_id uuid; v_next timestamptz;
begin
 v:=mc_complete_ai_job_before_reply_policy(p_job_id,p_decision,p_model_used,p_slot_used,p_chat_id,p_reply);
 if (v->>'outbound_job_id') is not null then
   v_id:=(v->>'outbound_job_id')::uuid;
   v_next:=mc_contact_next_send_time(p_chat_id,true);
   update mc_outbound_jobs
   set next_retry_at=greatest(coalesce(next_retry_at,now()),v_next)
   where id=v_id and status='PENDING' and kind='AI_REPLY';
 end if;
 return v;
end $$;

-- Recheck timing at send time, without adding cooldown again on every worker attempt.
alter function public.mc_campaign_preflight(uuid,integer)rename to mc_campaign_preflight_before_contact_schedule;
create function public.mc_campaign_preflight(p_job_id uuid,p_attempt integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;v_next timestamptz;
begin
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING' or j.attempt_count<>p_attempt then
  return jsonb_build_object('allowed',false,'reason','STALE_JOB');end if;
 if j.kind='AI_REPLY' then
  v_next:=mc_contact_next_send_time(j.chat_id,false);
  if v_next>now()+interval '1 second' then
   update mc_outbound_jobs set status='PENDING',next_retry_at=v_next,locked_at=null,locked_by=null
    where id=j.id;
   return jsonb_build_object('allowed',false,'reason','OUTSIDE_CONTACT_REPLY_WINDOW','next_allowed_at',v_next);
  end if;
 end if;
 return mc_campaign_preflight_before_contact_schedule(p_job_id,p_attempt);
end $$;

-- Include reply schedule in the paginated directory for panel hydration.
alter function public.mc_contact_directory(text,integer,integer)rename to mc_contact_directory_before_reply_policy;
create function public.mc_contact_directory(p_search text default '',p_limit integer default 50,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
with b as(select mc_contact_directory_before_reply_policy(p_search,p_limit,p_offset) j)
select jsonb_set(j,'{contacts}',coalesce((
 select jsonb_agg(c||jsonb_build_object(
  'reply_window_enabled',coalesce(p.reply_window_enabled,false),
  'reply_window_start',coalesce(to_char(p.reply_window_start,'HH24:MI'),'08:00'),
  'reply_window_end',coalesce(to_char(p.reply_window_end,'HH24:MI'),'22:00'),
  'reply_cooldown_seconds',coalesce(p.reply_cooldown_seconds,3),
  'max_reply_chars',coalesce(p.max_reply_chars,350)
 )) from jsonb_array_elements(j->'contacts') c
 left join mc_contact_preferences p on p.chat_id=c->>'chat_id'
),'[]'::jsonb),true) from b $$;

-- Lifecycle becomes churned if the owner cancels the last active subscription.
create or replace function public.mc_cancel_subscription(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s mc_subscriptions%rowtype;
begin
 update mc_subscriptions set status='CANCELLED',reminder_enabled=false,revision=revision+1,updated_at=now()
 where id=p_id and status='ACTIVE' returning * into s;
 if s.id is null then raise exception 'Langganan aktif tidak ditemukan';end if;
 update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null
 where billing_subscription_id=s.id and status in('PENDING','RETRY');
 if not exists(select 1 from mc_subscriptions where chat_id=s.chat_id and status='ACTIVE')then
  update mc_contact_preferences set lifecycle='CHURNED',updated_at=now() where chat_id=s.chat_id;
 end if;
 insert into mc_campaign_audit(action,detail)values('OWNER_SUBSCRIPTION_CANCEL',
 jsonb_build_object('chat_id',s.chat_id,'subscription_id',s.id,'actor','OWNER'));
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.mc_contact_next_send_time(text,boolean),
 public.mc_set_contact_reply_policy(text,boolean,time,time,integer,integer),
 public.mc_contact_allowed(text,text),
 public.mc_get_ai_context_before_reply_policy(text,integer),public.mc_get_ai_context(text,integer),
 public.mc_complete_ai_job_before_reply_policy(uuid,jsonb,text,smallint,text,text),
 public.mc_complete_ai_job(uuid,jsonb,text,smallint,text,text),
 public.mc_campaign_preflight_before_contact_schedule(uuid,integer),public.mc_campaign_preflight(uuid,integer),
 public.mc_contact_directory_before_reply_policy(text,integer,integer),public.mc_contact_directory(text,integer,integer),
 public.mc_cancel_subscription(uuid)
 from public,anon,authenticated;
grant execute on function public.mc_contact_next_send_time(text,boolean),
 public.mc_set_contact_reply_policy(text,boolean,time,time,integer,integer),
 public.mc_contact_allowed(text,text),public.mc_get_ai_context(text,integer),
 public.mc_complete_ai_job(uuid,jsonb,text,smallint,text,text),public.mc_campaign_preflight(uuid,integer),
 public.mc_contact_directory(text,integer,integer),public.mc_cancel_subscription(uuid) to service_role;
notify pgrst,'reload schema';
commit;