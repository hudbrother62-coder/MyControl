begin;
-- Owner-controlled policy; workers query one indexed contact, never download the full list.
create table public.mc_contact_exclusions(
 phone text primary key check(phone~'^[1-9][0-9]{7,14}$'),
 scope text not null check(scope in('PROMOTION','ALL_AUTOMATION')),
 reason text not null default '' check(length(reason)<=500),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table mc_contact_exclusions enable row level security;
revoke all on mc_contact_exclusions from public,anon,authenticated;
grant all on mc_contact_exclusions to service_role;
create index if not exists mc_lead_phone_idx on mc_lead_state(phone);
create index mc_exclusions_recent_idx on mc_contact_exclusions(updated_at desc,phone);
create function public.mc_contact_allowed(p_chat text,p_kind text)returns boolean language sql stable security definer set search_path=public as $$
 select p_kind='MANUAL' or not exists(
 select 1 from mc_contact_exclusions e where e.phone=case
 when p_chat~'^[0-9]+@(c\.us|s\.whatsapp\.net)$'then split_part(p_chat,'@',1)
 when p_chat~'^[1-9][0-9]{7,14}$'then p_chat
 else (select phone from mc_lead_state where chat_id=p_chat and phone~'^[1-9][0-9]{7,14}$')end
 and(e.scope='ALL_AUTOMATION'or p_kind in('CAMPAIGN','FOLLOW_UP')))
$$;
create function public.mc_set_contact_exclusion(p_phone text,p_scope text,p_reason text default '')returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_phone!~'^[1-9][0-9]{7,14}$'or p_phone is null then raise exception 'Nomor tidak valid';end if;
 if p_scope is null then
  delete from mc_contact_exclusions where phone=p_phone;
  -- Removing exclusion never restores cancelled work or resets promotional consent.
  return jsonb_build_object('ok',true);
 end if;
 if p_scope not in('PROMOTION','ALL_AUTOMATION')then raise exception 'Jenis pengecualian tidak valid';end if;
 insert into mc_contact_exclusions(phone,scope,reason)values(p_phone,p_scope,left(coalesce(p_reason,''),500))on conflict(phone)do update set scope=excluded.scope,reason=excluded.reason,updated_at=now();
 update mc_outbound_jobs o set status='CANCELLED',locked_at=null,locked_by=null,last_error='Dikecualikan melalui web'
 where o.status in('PENDING','RETRY')and o.chat_id in(select p_phone||'@c.us' union select p_phone||'@s.whatsapp.net' union select chat_id from mc_lead_state where phone=p_phone)and not mc_contact_allowed(o.chat_id,o.kind);
 update mc_followup_jobs f set status='CANCELLED',processed_at=now()where f.status='PENDING'and f.chat_id in(select p_phone||'@c.us' union select p_phone||'@s.whatsapp.net' union select chat_id from mc_lead_state where phone=p_phone)and not mc_contact_allowed(f.chat_id,'FOLLOW_UP');
 if p_scope='ALL_AUTOMATION'then update mc_ai_jobs j set status='HUMAN'where j.status in('PENDING','RETRY')and exists(select 1 from mc_inbound_events e where e.id=j.inbound_event_id and e.chat_id in(select p_phone||'@c.us' union select p_phone||'@s.whatsapp.net' union select chat_id from mc_lead_state where phone=p_phone)and not mc_contact_allowed(e.chat_id,'AI_REPLY'));end if;
 return jsonb_build_object('ok',true);
end$$;
create function public.mc_exclusion_outbound_guard()returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status in('PENDING','RETRY','PROCESSING')and not mc_contact_allowed(new.chat_id,new.kind)then new.status:='CANCELLED';new.locked_at:=null;new.locked_by:=null;new.last_error:='Dikecualikan melalui web';if new.recipient_id is not null then update mc_campaign_recipients set excluded_reason='Dikecualikan melalui web'where id=new.recipient_id;end if;end if;
 return new;
end$$;
create trigger mc_exclusion_outbound_guard_trigger before insert or update on mc_outbound_jobs for each row execute function mc_exclusion_outbound_guard();
create function public.mc_exclusion_ai_guard()returns trigger language plpgsql security definer set search_path=public as $$begin
 if not mc_contact_allowed((select chat_id from mc_inbound_events where id=new.inbound_event_id),'AI_REPLY')then return null;end if;return new;
end$$;
create trigger mc_exclusion_ai_guard_trigger before insert on mc_ai_jobs for each row execute function mc_exclusion_ai_guard();
-- Retain all existing consent, takeover, stale-event, campaign status, bot toggle and attempt checks.
alter function mc_campaign_preflight(uuid,integer)rename to mc_campaign_preflight_exclusion_base;
create function public.mc_campaign_preflight(p_job_id uuid,p_attempt integer)returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;begin
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING'or j.attempt_count<>p_attempt then return jsonb_build_object('allowed',false,'reason','STALE_JOB');end if;
 if not mc_contact_allowed(j.chat_id,j.kind)then
 update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null,last_error='Dikecualikan melalui web'where id=j.id;
 return jsonb_build_object('allowed',false,'reason','WEB_EXCLUSION');end if;
 return mc_campaign_preflight_exclusion_base(p_job_id,p_attempt);
end$$;
create function public.mc_automation_contact_gate(p_chat_id text)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('allowed',mc_contact_allowed(p_chat_id,'AI_REPLY'),'reason',case when mc_contact_allowed(p_chat_id,'AI_REPLY')then 'ALLOWED'else 'WEB_EXCLUSION'end)
$$;
-- Recheck after the model returns: an owner may exclude a contact during inference.
alter function mc_complete_ai_job(uuid,jsonb,text,smallint,text,text)rename to mc_complete_ai_job_exclusion_base;
create function public.mc_complete_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text)returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_ai_jobs%rowtype;v_chat text;d jsonb:=p_decision;begin
 select * into j from mc_ai_jobs where id=p_job_id for update;
 select chat_id into v_chat from mc_inbound_events where id=j.inbound_event_id;
 if v_chat is distinct from p_chat_id then raise exception 'Chat mismatch';end if;
 if j.status='PROCESSING'and not mc_contact_allowed(v_chat,'AI_REPLY')then
  update mc_ai_jobs set status='HUMAN',locked_at=null,locked_by=null where id=j.id;
  return jsonb_build_object('ok',false,'blocked',true,'reason','WEB_EXCLUSION');
 end if;
 if not mc_contact_allowed(v_chat,'FOLLOW_UP')then d:=jsonb_set(jsonb_set(d,'{should_followup}','false'),'{followup_plan}','[]');end if;
 return mc_complete_ai_job_exclusion_base(p_job_id,d,p_model_used,p_slot_used,p_chat_id,p_reply);
end$$;
create function public.mc_exclusion_followup_guard()returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status='PENDING'and not mc_contact_allowed(new.chat_id,'FOLLOW_UP')then new.status:='CANCELLED';new.processed_at:=now();end if;return new;
end$$;
create trigger mc_exclusion_followup_guard_trigger before insert or update on mc_followup_jobs for each row execute function mc_exclusion_followup_guard();
revoke all on function mc_complete_ai_job(uuid,jsonb,text,smallint,text,text),mc_complete_ai_job_exclusion_base(uuid,jsonb,text,smallint,text,text),mc_exclusion_followup_guard()from public,anon,authenticated;
grant execute on function mc_complete_ai_job(uuid,jsonb,text,smallint,text,text)to service_role;
create function public.mc_ai_exclusion_preflight(p_job_id uuid,p_attempt integer)returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_ai_jobs%rowtype;v_chat text;begin
 select * into j from mc_ai_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING'or j.attempt_count<>p_attempt then return jsonb_build_object('allowed',false,'reason','STALE_JOB');end if;
 select chat_id into v_chat from mc_inbound_events where id=j.inbound_event_id;
 if not mc_contact_allowed(v_chat,'AI_REPLY')then update mc_ai_jobs set status='HUMAN',locked_at=null,locked_by=null where id=j.id;return jsonb_build_object('allowed',false,'reason','WEB_EXCLUSION');end if;
 return jsonb_build_object('allowed',true);
end$$;
revoke all on function mc_ai_exclusion_preflight(uuid,integer)from public,anon,authenticated;
grant execute on function mc_ai_exclusion_preflight(uuid,integer)to service_role;
revoke all on function mc_contact_allowed(text,text),mc_set_contact_exclusion(text,text,text),mc_exclusion_outbound_guard(),mc_exclusion_ai_guard(),mc_campaign_preflight(uuid,integer),mc_campaign_preflight_exclusion_base(uuid,integer),mc_automation_contact_gate(text)from public,anon,authenticated;
grant execute on function mc_contact_allowed(text,text),mc_set_contact_exclusion(text,text,text),mc_campaign_preflight(uuid,integer),mc_automation_contact_gate(text)to service_role;
create function public.mc_campaign_contact_selection(p_search text default '')returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('phones',coalesce(jsonb_agg(phone),'[]'::jsonb))from(
 select c.phone from mc_campaign_contacts c where c.consent and c.opted_out_at is null
 and not exists(select 1 from mc_contact_exclusions e where e.phone=c.phone)
 and(coalesce(p_search,'')=''or c.name ilike '%'||p_search||'%'or c.phone ilike '%'||p_search||'%'or c.tags ilike '%'||p_search||'%')
 order by c.created_at desc,c.phone limit 1000)s
$$;
revoke all on function mc_campaign_contact_selection(text)from public,anon,authenticated;
grant execute on function mc_campaign_contact_selection(text)to service_role;
notify pgrst,'reload schema';commit;
