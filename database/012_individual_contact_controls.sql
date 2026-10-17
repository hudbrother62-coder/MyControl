begin;
-- Individual-contact automation policy. Never infer marketing consent from a WhatsApp chat.
create table public.mc_contact_preferences (
  chat_id text primary key references public.mc_lead_state(chat_id) on delete cascade,
  followup_enabled boolean not null default true,
  priority text not null default 'NORMAL' check(priority in ('NORMAL','IMPORTANT')),
  note text not null default '' check(length(note)<=2000),
  updated_at timestamptz not null default now()
);
alter table public.mc_contact_preferences enable row level security;
revoke all on table public.mc_contact_preferences from public,anon,authenticated;
grant all on table public.mc_contact_preferences to service_role;

-- Applied by existing AI preflight, AI completion, follow-up dispatch and outbound preflight.
-- A per-chat pause applies even to LIDs, without pretending they are phone numbers.
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
 and (p_kind<>'FOLLOW_UP' or not exists (
   select 1 from mc_contact_preferences p where p.chat_id=p_chat and not p.followup_enabled
 ))
) $$;

-- All pauses cancel queued automatic work; future inbound messages can resume after expiry.
create function public.mc_set_contact_bot_pause(p_chat_id text,p_minutes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_until timestamptz;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or
    not exists(select 1 from mc_lead_state where chat_id=p_chat_id)
    then raise exception 'Kontak WhatsApp tidak ditemukan';end if;
 if p_minutes not in(-1,0,15,60,480,1440,10080) or p_minutes is null
    then raise exception 'Durasi jeda tidak valid';end if;
 perform mc_control_takeover(p_chat_id,p_minutes<>0);
 if p_minutes>0 then
   v_until:=now()+make_interval(mins=>p_minutes);
   update mc_lead_state set human_takeover_until=v_until,updated_at=now()
   where chat_id=p_chat_id;
 elsif p_minutes=-1 then
   v_until:='infinity'::timestamptz;
 end if;
 insert into mc_campaign_audit(action,detail)
 values('OWNER_CONTACT_AI_CONTROL',jsonb_build_object('chat_id',p_chat_id,'minutes',p_minutes,'actor','OWNER'));
 return jsonb_build_object('ok',true,'paused',p_minutes<>0,'pause_until',
   case when p_minutes=-1 then 'infinity' when p_minutes=0 then null else to_char(v_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end);
end $$;

create function public.mc_set_contact_preferences(
 p_chat_id text,p_followup_enabled boolean default null,p_priority text default null,p_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.mc_contact_preferences%rowtype;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or
    not exists(select 1 from mc_lead_state where chat_id=p_chat_id)
    then raise exception 'Kontak WhatsApp tidak ditemukan';end if;
 if p_followup_enabled is null and p_priority is null and p_note is null then
    raise exception 'Tidak ada perubahan';end if;
 if p_priority is not null and p_priority not in('NORMAL','IMPORTANT') then
    raise exception 'Prioritas tidak valid';end if;
 if p_note is not null and length(p_note)>2000 then
    raise exception 'Catatan maksimal 2000 karakter';end if;
 insert into mc_contact_preferences(chat_id,followup_enabled,priority,note)
 values(p_chat_id,coalesce(p_followup_enabled,true),coalesce(p_priority,'NORMAL'),coalesce(p_note,''))
 on conflict(chat_id) do update set
 followup_enabled=coalesce(p_followup_enabled,mc_contact_preferences.followup_enabled),
 priority=coalesce(p_priority,mc_contact_preferences.priority),
 note=coalesce(p_note,mc_contact_preferences.note),updated_at=now()
 returning * into v;
 if not v.followup_enabled then
   update mc_followup_jobs set status='CANCELLED',processed_at=now()
     where chat_id=p_chat_id and status='PENDING';
   update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null,
       last_error='Follow-up kontak dinonaktifkan owner'
     where chat_id=p_chat_id and kind='FOLLOW_UP' and status in('PENDING','RETRY');
 end if;
 insert into mc_campaign_audit(action,detail)values('OWNER_CONTACT_PREFERENCES',
   jsonb_build_object('chat_id',p_chat_id,'followup',v.followup_enabled,
     'priority',v.priority,'note_changed',p_note is not null,'actor','OWNER'));
 return jsonb_build_object('ok',true,'followup_enabled',v.followup_enabled,'priority',v.priority,'note',v.note);
end $$;

-- Paginated owner directory: one chat identity, one set of controls.
create or replace function public.mc_contact_directory(
 p_search text default '',p_limit integer default 50,p_offset integer default 0
) returns jsonb language sql stable security definer set search_path=public as $$
with base as (
 select l.chat_id,l.phone,coalesce(nullif(c.name,''),nullif(l.display_name,''),l.phone,l.chat_id) as name,
        coalesce(c.tags,'') as tags,coalesce(c.consent,false) as consent,c.opted_out_at,
        (select e.scope from mc_contact_exclusions e where e.phone=l.phone) as exclusion,
        l.product_id,'WHATSAPP'::text as origin,l.updated_at as sort_at,
        l.human_takeover_until as pause_until,l.last_customer_message_at,l.last_ai_message_at,
        coalesce(p.followup_enabled,true) as followup_enabled,
        coalesce(p.priority,'NORMAL') as priority,coalesce(p.note,'') as note
 from mc_lead_state l left join mc_campaign_contacts c on c.phone=l.phone
 left join mc_contact_preferences p on p.chat_id=l.chat_id
 union all
 select c.phone||'@c.us',c.phone,c.name,c.tags,c.consent,c.opted_out_at,
        (select e.scope from mc_contact_exclusions e where e.phone=c.phone),
        null::text,'IMPORT',c.updated_at,
        null::timestamptz,null::timestamptz,null::timestamptz,
        true,'NORMAL'::text,''::text
 from mc_campaign_contacts c
 where not exists(select 1 from mc_lead_state l where l.phone=c.phone)
), ranked as (
 select *,row_number() over(partition by coalesce(phone,chat_id) order by sort_at desc,chat_id) as rn from base
), filtered as (
 select chat_id,phone,name,tags,consent,opted_out_at,exclusion,product_id,origin,
        pause_until,last_customer_message_at,last_ai_message_at,followup_enabled,priority,note,sort_at
 from ranked where rn=1 and
 (nullif(trim(left(coalesce(p_search,''),80)),'') is null or
 strpos(lower(concat_ws(' ',name,phone,chat_id,tags,product_id,note)),lower(trim(left(p_search,80))))>0)
), paged as (
 select chat_id,phone,name,tags,consent,opted_out_at,exclusion,product_id,origin,
        pause_until,last_customer_message_at,last_ai_message_at,followup_enabled,priority,note
 from filtered order by (priority='IMPORTANT') desc,sort_at desc,chat_id
 limit least(greatest(coalesce(p_limit,50),1),50)
 offset least(greatest(coalesce(p_offset,0),0),100000)
)
select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
'total',(select count(*) from filtered))
$$;

revoke all on function public.mc_contact_allowed(text,text),
 public.mc_set_contact_bot_pause(text,integer),
 public.mc_set_contact_preferences(text,boolean,text,text),
 public.mc_contact_directory(text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.mc_contact_allowed(text,text),
 public.mc_set_contact_bot_pause(text,integer),
 public.mc_set_contact_preferences(text,boolean,text,text),
 public.mc_contact_directory(text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;