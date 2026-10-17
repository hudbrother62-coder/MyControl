begin;
alter table public.mc_contact_preferences
 add column if not exists automation_mode text not null default 'AI' check(automation_mode in ('AI','HYBRID','MANUAL')),
 add column if not exists response_style text not null default 'CONSULTATIVE' check(response_style in ('CONSULTATIVE','CONCISE','PERSUASIVE')),
 add column if not exists custom_instruction text not null default '' check(length(custom_instruction)<=1500),
 add column if not exists customer_profile text not null default '' check(length(customer_profile)<=2000),
 add column if not exists lifecycle text not null default 'PROSPECT' check(lifecycle in ('PROSPECT','BUYER','ACTIVE','DUE_SOON','OVERDUE','CHURNED')),
 add column if not exists max_followups integer not null default 3 check(max_followups between 0 and 3);

create table public.mc_contact_ai_drafts(
 id uuid primary key default gen_random_uuid(),
 chat_id text not null references public.mc_lead_state(chat_id) on delete cascade,
 ai_job_id uuid not null unique references public.mc_ai_jobs(id),
 reply text not null check(length(reply) between 1 and 4000),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','DISMISSED')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);
create index mc_contact_ai_drafts_chat on public.mc_contact_ai_drafts(chat_id,status,created_at desc);
alter table public.mc_contact_ai_drafts enable row level security;
revoke all on table public.mc_contact_ai_drafts from public,anon,authenticated;
grant all on table public.mc_contact_ai_drafts to service_role;

create or replace function public.mc_contact_allowed(p_chat text,p_kind text)
returns boolean language sql stable security definer set search_path=public as $$
select p_kind='MANUAL' or (
 not exists (
  select 1 from mc_contact_exclusions e where e.phone=case
   when p_chat ~ '^[0-9]+@(c\.us|s\.whatsapp\.net)$' then split_part(p_chat,'@',1)
   when p_chat ~ '^[1-9][0-9]{7,14}$' then p_chat
   else (select phone from mc_lead_state where chat_id=p_chat and phone ~ '^[1-9][0-9]{7,14}$') end
    and(e.scope='ALL_AUTOMATION' or p_kind in('CAMPAIGN','FOLLOW_UP'))
 )
 and (p_kind not in('AI_REPLY','FOLLOW_UP') or not exists (
  select 1 from mc_lead_state l where l.chat_id=p_chat and l.human_takeover_until>now()
 ))
 and (p_kind not in('AI_REPLY','FOLLOW_UP') or not exists(
  select 1 from mc_contact_preferences p where p.chat_id=p_chat and p.automation_mode='MANUAL'
 ))
 and (p_kind<>'FOLLOW_UP' or not exists(
  select 1 from mc_contact_preferences p where p.chat_id=p_chat and
   (not p.followup_enabled or p.automation_mode='HYBRID' or p.max_followups=0)
 ))
) $$;

create or replace function public.mc_set_contact_bot_pause(p_chat_id text,p_minutes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_until timestamptz;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$'
 or not exists(select 1 from mc_lead_state where chat_id=p_chat_id) then raise exception 'Kontak tidak ditemukan';end if;
 if p_minutes is null or (p_minutes not in(-1,0) and p_minutes not between 5 and 10080)
 then raise exception 'Durasi jeda harus 5 menit - 7 hari atau permanen';end if;
 perform mc_control_takeover(p_chat_id,p_minutes<>0);
 if p_minutes>0 then
  v_until:=now()+make_interval(mins=>p_minutes);
  update mc_lead_state set human_takeover_until=v_until,updated_at=now() where chat_id=p_chat_id;
 elsif p_minutes=-1 then v_until:='infinity'::timestamptz;
 end if;
 insert into mc_campaign_audit(action,detail)
 values('OWNER_CONTACT_PAUSE',jsonb_build_object('chat_id',p_chat_id,'minutes',p_minutes,'actor','OWNER'));
 return jsonb_build_object('ok',true,'paused',p_minutes<>0,'pause_until',
  case when p_minutes=-1 then 'infinity' when p_minutes=0 then null else to_char(v_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end);
end $$;

create function public.mc_set_contact_mode(p_chat_id text,p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_mode not in('AI','HYBRID','MANUAL') or p_mode is null then raise exception 'Mode tidak dikenal';end if;
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or
 not exists(select 1 from mc_lead_state where chat_id=p_chat_id) then raise exception 'Kontak tidak dikenal';end if;
 perform mc_control_takeover(p_chat_id,p_mode='MANUAL');
 insert into mc_contact_preferences(chat_id,automation_mode) values(p_chat_id,p_mode)
 on conflict(chat_id) do update set automation_mode=p_mode,updated_at=now();
 if p_mode<>'AI' then
  update mc_followup_jobs set status='CANCELLED',processed_at=now() where chat_id=p_chat_id and status='PENDING';
  update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null
   where chat_id=p_chat_id and kind in('FOLLOW_UP','AI_REPLY') and status in('PENDING','RETRY');
 end if;
 if p_mode<>'HYBRID' then
  update mc_contact_ai_drafts set status='DISMISSED',reviewed_at=now()
   where chat_id=p_chat_id and status='PENDING';
 end if;
 insert into mc_campaign_audit(action,detail) values('OWNER_CONTACT_MODE',
  jsonb_build_object('chat_id',p_chat_id,'mode',p_mode,'actor','OWNER'));
 return jsonb_build_object('ok',true,'automation_mode',p_mode,'pause_until',
 (select case when human_takeover_until='infinity'::timestamptz then 'infinity' else
  to_char(human_takeover_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end
 from mc_lead_state where chat_id=p_chat_id));
end $$;

create function public.mc_set_contact_sales_profile(
 p_chat_id text,p_style text,p_instruction text,p_profile text,p_lifecycle text,p_max_followups integer
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v mc_contact_preferences%rowtype;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$'
 or not exists(select 1 from mc_lead_state where chat_id=p_chat_id) then raise exception 'Kontak tidak ditemukan';end if;
 if p_style not in('CONSULTATIVE','CONCISE','PERSUASIVE') or p_style is null or
 p_lifecycle not in('PROSPECT','BUYER','ACTIVE','DUE_SOON','OVERDUE','CHURNED') or p_lifecycle is null
 or p_max_followups not between 0 and 3 or p_max_followups is null or
 length(p_instruction)>1500 or length(p_profile)>2000 or p_instruction is null or p_profile is null
 then raise exception 'Profil tidak valid';end if;
 insert into mc_contact_preferences(chat_id,response_style,custom_instruction,customer_profile,lifecycle,max_followups)
 values(p_chat_id,p_style,trim(p_instruction),trim(p_profile),p_lifecycle,p_max_followups)
 on conflict(chat_id) do update set response_style=excluded.response_style,
 custom_instruction=excluded.custom_instruction,customer_profile=excluded.customer_profile,
 lifecycle=excluded.lifecycle,max_followups=excluded.max_followups,updated_at=now()
 returning * into v;
 if v.max_followups=0 then
  update mc_followup_jobs set status='CANCELLED',processed_at=now()
   where chat_id=p_chat_id and status='PENDING';
  update mc_outbound_jobs set status='CANCELLED' where chat_id=p_chat_id and kind='FOLLOW_UP' and status in('PENDING','RETRY');
 end if;
 insert into mc_campaign_audit(action,detail)values('OWNER_CONTACT_SALES_PROFILE',
  jsonb_build_object('chat_id',p_chat_id,'style',p_style,'lifecycle',p_lifecycle,'max_followups',p_max_followups,'actor','OWNER'));
 return jsonb_build_object('ok',true,'response_style',v.response_style,'customer_profile',v.customer_profile,
  'custom_instruction',v.custom_instruction,'lifecycle',v.lifecycle,'max_followups',v.max_followups);
end $$;

-- Existing AI worker reads lead_state and memory, so no n8n graph change is needed.
alter function public.mc_get_ai_context(text,integer) rename to mc_get_ai_context_prior_contact_pro;
create function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public as $$
with ctx as (select mc_get_ai_context_prior_contact_pro(p_chat_id,p_history_limit) as data),
policy as (select p.response_style,p.custom_instruction,p.customer_profile,p.lifecycle,p.max_followups,p.automation_mode,p.note
 from mc_contact_preferences p where p.chat_id=p_chat_id)
select jsonb_set(ctx.data,'{lead_state}',
  coalesce(ctx.data->'lead_state','{}'::jsonb) ||
  jsonb_build_object('OWNER_CONTACT_AI_GUIDANCE',coalesce((
   select jsonb_build_object('response_style',response_style,'contact_instructions',custom_instruction,
    'customer_profile_from_owner',customer_profile,'customer_lifecycle',lifecycle,
    'contact_max_followups',max_followups,'mode',automation_mode,'owner_note_internal',note,
    'rule','Owner profile is context, not verified evidence of payment; do not expose internal notes verbatim')
   from policy
  ),'{}'::jsonb)),true)
from ctx $$;

-- Hybrid mode: draft is saved, not sent, and proactive followups are suppressed.
alter function public.mc_complete_ai_job(uuid,jsonb,text,smallint,text,text) rename to mc_complete_ai_job_prior_hybrid;
create function public.mc_complete_ai_job(
 p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_mode text; d jsonb:=p_decision; v jsonb;
begin
 select coalesce(automation_mode,'AI') into v_mode from mc_contact_preferences where chat_id=p_chat_id;
 if v_mode='HYBRID' and coalesce((d->>'should_reply')::boolean,false) and
 coalesce((d->>'needs_human')::boolean,false)=false and nullif(trim(p_reply),'') is not null then
   d:=jsonb_set(jsonb_set(jsonb_set(d,'{should_reply}','false'::jsonb),'{should_followup}','false'::jsonb),'{followup_plan}','[]'::jsonb);
   v:=mc_complete_ai_job_prior_hybrid(p_job_id,d,p_model_used,p_slot_used,p_chat_id,
      d->>'reply');
   if coalesce((v->>'suppressed')::boolean,false)=false and
      coalesce((v->>'blocked')::boolean,false)=false and
      coalesce((v->>'duplicate')::boolean,false)=false then
     insert into mc_contact_ai_drafts(chat_id,ai_job_id,reply)
       values(p_chat_id,p_job_id,p_reply) on conflict(ai_job_id) do nothing;
   end if;
   return v||jsonb_build_object('review_required',true);
 end if;
 return mc_complete_ai_job_prior_hybrid(p_job_id,p_decision,p_model_used,p_slot_used,p_chat_id,p_reply);
end $$;

create function public.mc_review_contact_draft(p_draft_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d mc_contact_ai_drafts%rowtype; v uuid;
begin
 select * into d from mc_contact_ai_drafts where id=p_draft_id for update;
 if d.id is null or d.status<>'PENDING' then raise exception 'Draft sudah diproses atau tidak ditemukan';end if;
 if p_approve is null then raise exception 'Keputusan wajib diberikan';end if;
 if p_approve and not exists(select 1 from mc_contact_preferences
  where chat_id=d.chat_id and automation_mode='HYBRID') then raise exception 'Kontak bukan dalam mode Hybrid';end if;
 update mc_contact_ai_drafts set status=case when p_approve then 'APPROVED' else 'DISMISSED' end, reviewed_at=now() where id=d.id;
 if p_approve then
  insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)
  values(d.chat_id,d.reply,'MANUAL','approved-draft:'||d.id) returning id into v;
 end if;
 insert into mc_campaign_audit(action,detail)values('OWNER_AI_DRAFT_REVIEW',jsonb_build_object('chat_id',d.chat_id,'draft_id',d.id,'approved',p_approve,'actor','OWNER'));
 return jsonb_build_object('ok',true,'status',case when p_approve then 'APPROVED' else 'DISMISSED' end,'outbound_job_id',v);
end $$;

-- Keep existing pagination API contract while enriching each row with owner policy.
alter function public.mc_contact_directory(text,integer,integer) rename to mc_contact_directory_prior_pro;
create function public.mc_contact_directory(p_search text default '',p_limit integer default 50,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
with base as(select mc_contact_directory_prior_pro(p_search,p_limit,p_offset) x)
select jsonb_set(x,'{contacts}',coalesce((
 select jsonb_agg(c ||
  jsonb_build_object('automation_mode',coalesce(p.automation_mode,'AI'),
   'response_style',coalesce(p.response_style,'CONSULTATIVE'),
   'customer_profile',coalesce(p.customer_profile,''),
   'custom_instruction',coalesce(p.custom_instruction,''),
   'lifecycle',coalesce(p.lifecycle,'PROSPECT'),
   'max_followups',coalesce(p.max_followups,3))) from jsonb_array_elements(x->'contacts') c
 left join mc_contact_preferences p on p.chat_id=c->>'chat_id'
),'[]'::jsonb),true) from base $$;

revoke all on table public.mc_contact_ai_drafts from public,anon,authenticated;
revoke all on function public.mc_contact_allowed(text,text),public.mc_set_contact_bot_pause(text,integer),
public.mc_set_contact_mode(text,text), public.mc_set_contact_sales_profile(text,text,text,text,text,integer),
public.mc_review_contact_draft(uuid,boolean), public.mc_get_ai_context_prior_contact_pro(text,integer),
public.mc_get_ai_context(text,integer),public.mc_complete_ai_job_prior_hybrid(uuid,jsonb,text,smallint,text,text),
public.mc_complete_ai_job(uuid,jsonb,text,smallint,text,text),
public.mc_contact_directory_prior_pro(text,integer,integer),public.mc_contact_directory(text,integer,integer)
from public,anon,authenticated;
grant execute on function public.mc_contact_allowed(text,text),public.mc_set_contact_bot_pause(text,integer),
public.mc_set_contact_mode(text,text),public.mc_set_contact_sales_profile(text,text,text,text,text,integer),
public.mc_review_contact_draft(uuid,boolean),public.mc_get_ai_context(text,integer),
public.mc_complete_ai_job(uuid,jsonb,text,smallint,text,text),
public.mc_contact_directory(text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;