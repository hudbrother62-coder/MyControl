begin;
create table public.mc_control_version(id boolean primary key default true check(id),version integer not null default 1,updated_at timestamptz not null default now());
insert into mc_control_version(id)values(true);
create table public.mc_worker_controls(worker_id text not null,component text not null check(component in('AI','OUTBOUND','FOLLOWUP')),applied_version integer not null,last_seen timestamptz not null default now(),primary key(worker_id,component));
insert into bot_settings(key,value)values('ai_model','""'),('bot_instructions','""'),('followup_enabled','false'),('waha_base_url','""'),('n8n_base_url','""')on conflict(key)do nothing;
create function public.mc_web_control_changed()returns trigger language plpgsql security definer set search_path=public as $$begin
 if (case when tg_op='DELETE'then old.kind else new.kind end)='BOT_SETTING'then update mc_control_version set version=version+1,updated_at=now()where id;end if;
 return case when tg_op='DELETE'then old else new end;
end$$;
create trigger mc_web_control_changed_trigger after insert or update or delete on mc_runtime_knowledge for each row execute function mc_web_control_changed();
create function public.mc_read_web_controls()returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('version',(select version from mc_control_version where id),'updated_at',(select updated_at from mc_control_version where id),'settings',
 jsonb_build_object('bot_enabled',false,'ai_auto_reply',true,'ai_model','','bot_instructions','','followup_enabled',false,'max_followups',3,'working_hours_start','08:00','working_hours_end','22:00','reply_delay_min_seconds',3,'reply_delay_max_seconds',8,'waha_base_url','','n8n_base_url','')||coalesce((select jsonb_object_agg(source_key,payload->'value')from mc_runtime_knowledge where kind='BOT_SETTING'and active and source_key in('bot_enabled','ai_auto_reply','ai_model','bot_instructions','followup_enabled','max_followups','working_hours_start','working_hours_end','reply_delay_min_seconds','reply_delay_max_seconds','waha_base_url','n8n_base_url')),'{}'::jsonb))
$$;
create function public.mc_save_web_controls(p_version integer,p_settings jsonb)returns jsonb language plpgsql security definer set search_path=public as $$
declare v integer;r record;merged jsonb;
begin
 select version into v from mc_control_version where id for update;
 if p_version is distinct from v then raise exception 'Pengaturan telah berubah. Muat ulang sebelum menyimpan';end if;
 if jsonb_typeof(p_settings) is distinct from 'object'then raise exception 'Pengaturan tidak valid';end if;
 for r in select * from jsonb_each(p_settings)loop
  if r.key not in('bot_enabled','ai_auto_reply','ai_model','bot_instructions','followup_enabled','max_followups','working_hours_start','working_hours_end','reply_delay_min_seconds','reply_delay_max_seconds','waha_base_url','n8n_base_url')then raise exception 'Pengaturan tidak diizinkan: %',r.key;end if;
  if r.key in('bot_enabled','ai_auto_reply','followup_enabled')and jsonb_typeof(r.value)<>'boolean'then raise exception 'Nilai toggle tidak valid';end if;
  if r.key in('max_followups','reply_delay_min_seconds','reply_delay_max_seconds')and(jsonb_typeof(r.value)<>'number'or r.value::text !~ '^[0-9]+$')then raise exception 'Nilai angka tidak valid';end if;
  if r.key='max_followups'and(r.value::text)::int not between 0 and 3 then raise exception 'Follow-up maksimal 3';end if;
  if r.key in('reply_delay_min_seconds','reply_delay_max_seconds')and(r.value::text)::int not between 0 and 60 then raise exception 'Delay 0 sampai 60 detik';end if;
  if r.key in('ai_model','bot_instructions','working_hours_start','working_hours_end','waha_base_url','n8n_base_url')and jsonb_typeof(r.value)<>'string'then raise exception 'Nilai teks tidak valid';end if;
  if r.key in('working_hours_start','working_hours_end')and (r.value#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'then raise exception 'Jam tidak valid';end if;
  if r.key='ai_model'and length(r.value#>>'{}')>120 then raise exception 'Nama model terlalu panjang';end if;
  if r.key='bot_instructions'and length(r.value#>>'{}')>6000 then raise exception 'Instruksi maksimal 6000 karakter';end if;
  if r.key in('waha_base_url','n8n_base_url')and (r.value#>>'{}')<>''and((r.value#>>'{}') !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(:[0-9]+)?/?$'or length(r.value#>>'{}')>250)then raise exception 'Gunakan alamat dasar HTTPS tanpa path, password, atau query';end if;
 end loop;
 merged:=(mc_read_web_controls()->'settings')||p_settings;
 if (merged->>'reply_delay_min_seconds')::int>(merged->>'reply_delay_max_seconds')::int then raise exception 'Delay maksimum harus lebih besar atau sama dengan minimum';end if;
 for r in select * from jsonb_each(p_settings)loop
  insert into bot_settings(key,value)values(r.key,r.value)on conflict(key)do update set value=excluded.value;
 end loop;
 insert into mc_campaign_audit(action,detail)values('OWNER_WEB_CONTROLS_SAVED',jsonb_build_object('actor','OWNER','keys',(select jsonb_agg(key)from jsonb_each(p_settings))));
 return mc_read_web_controls();
end$$;
create function public.mc_ack_web_controls(p_worker text,p_component text,p_version integer)returns void language plpgsql security definer set search_path=public as $$begin
 if p_version<1 or p_version>(select version from mc_control_version where id)or length(p_worker)not between 1 and 100 then raise exception 'Versi worker tidak valid';end if;
 insert into mc_worker_controls(worker_id,component,applied_version)values(p_worker,p_component,p_version)on conflict(worker_id,component)do update set applied_version=excluded.applied_version,last_seen=now();
end$$;
-- The legacy executor reads the same canonical settings; an OFF switch is enforced in SQL.
alter function mc_dispatch_due_followups(integer)rename to mc_dispatch_due_followups_base;
create function mc_dispatch_due_followups(p_limit integer default 25)returns jsonb language plpgsql security definer set search_path=public as $$begin
 if not coalesce((mc_read_web_controls()->'settings'->>'followup_enabled')::boolean,false)then return jsonb_build_object('dispatched',0,'reason','followup_disabled');end if;
 return mc_dispatch_due_followups_base(p_limit);
end$$;
alter function mc_complete_ai_job(uuid,jsonb,text,smallint,text,text)rename to mc_complete_ai_job_controls_base;
create function mc_complete_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text)returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb:=p_decision;v_result jsonb;cfg jsonb;min_delay int;max_delay int;
begin
 if not coalesce((mc_read_web_controls()->'settings'->>'followup_enabled')::boolean,false)then d:=jsonb_set(d,'{should_followup}','false');end if;
 v_result:=mc_complete_ai_job_controls_base(p_job_id,d,p_model_used,p_slot_used,p_chat_id,p_reply);
 cfg:=mc_read_web_controls()->'settings';min_delay:=(cfg->>'reply_delay_min_seconds')::int;max_delay:=greatest(min_delay,(cfg->>'reply_delay_max_seconds')::int);
 if v_result->>'outbound_job_id' is not null then update mc_outbound_jobs set next_retry_at=now()+make_interval(secs=>min_delay+floor(random()*(max_delay-min_delay+1))::int)where id=(v_result->>'outbound_job_id')::uuid and status='PENDING';end if;
 return v_result;
end$$;
create function public.mc_retry_web_failure(p_job_id uuid)returns void language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;
begin
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'FAILED'or j.kind='CAMPAIGN'then raise exception 'Hanya FAILED non-kampanye yang dapat dicoba ulang di sini; UNKNOWN harus direkonsiliasi';end if;
 update mc_outbound_jobs set status='RETRY',next_retry_at=now(),last_error=null where id=j.id;
 insert into mc_campaign_audit(action,detail)values('OWNER_RETRY_FAILED',jsonb_build_object('job_id',j.id,'actor','OWNER'));
end$$;

-- Browser database traffic is owner-session proxied; do not allow anonymous settings writes.
revoke all on public.bot_settings from anon,authenticated;
grant select,insert,update,delete on public.bot_settings to service_role;
do $$declare t text;f record;begin
 foreach t in array array['mc_control_version','mc_worker_controls']loop execute format('alter table %I enable row level security',t);execute format('revoke all on %I from anon,authenticated',t);execute format('grant all on %I to service_role',t);end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('mc_web_control_changed','mc_read_web_controls','mc_save_web_controls','mc_ack_web_controls','mc_dispatch_due_followups','mc_dispatch_due_followups_base','mc_complete_ai_job','mc_complete_ai_job_controls_base','mc_retry_web_failure')loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;
end$$;
notify pgrst,'reload schema';commit;
