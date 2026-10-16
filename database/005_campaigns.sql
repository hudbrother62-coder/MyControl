-- Additive campaign subsystem; no customer/chat/order records are removed.
begin;
create table public.mc_campaign_contacts (
 phone text primary key check(phone ~ '^[1-9][0-9]{7,14}$'),name text not null check(length(name) between 1 and 100),
 tags text not null default '',source text not null default '',consent boolean not null default false,
 consent_at timestamptz,opted_out_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.mc_campaigns (
 id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 120),
 product_id text not null,session_name text not null default 'default',
 status text not null default 'DRAFT' check(status in('DRAFT','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED')),
 steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 2),
 is_test boolean not null default false,test_campaign_id uuid references mc_campaigns(id),bot_enabled boolean not null default true,scheduled_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.mc_campaign_recipients (
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references mc_campaigns(id),
 phone text not null references mc_campaign_contacts(phone),name text not null,replied_at timestamptz,excluded_reason text,unique(campaign_id,phone)
);
create table public.mc_campaign_runtime (
 session_name text primary key,worker_id text not null,video_supported boolean not null default false,last_seen timestamptz not null default now()
);
create table public.mc_opportunities (
 id uuid primary key default gen_random_uuid(),chat_id text not null,product_id text not null,
 stage text not null default 'NEW' check(stage in('NEW','INTERESTED','FOLLOW_UP','AWAITING_PAYMENT','WON','LOST')),
 note text not null default '',next_followup_at timestamptz,campaign_id uuid references mc_campaigns(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(chat_id,product_id)
);
create table public.mc_campaign_audit (
 id uuid primary key default gen_random_uuid(),campaign_id uuid references mc_campaigns(id),action text not null,detail jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table mc_outbound_jobs add column campaign_id uuid references mc_campaigns(id);
alter table mc_outbound_jobs add column recipient_id uuid references mc_campaign_recipients(id);
alter table mc_outbound_jobs add column step_no integer;
alter table mc_outbound_jobs add column media_url text;
alter table mc_outbound_jobs add column delivery_status text;
alter table mc_outbound_jobs add column delivered_at timestamptz;
alter table mc_outbound_jobs add column read_at timestamptz;
create index mc_campaign_jobs_idx on mc_outbound_jobs(campaign_id,recipient_id,step_no);
create index mc_campaign_provider_idx on mc_outbound_jobs(provider_message_id) where provider_message_id is not null;
create index mc_campaign_schedule_idx on mc_campaigns(status,scheduled_at);

create function public.mc_campaign_contact_import(p_contacts jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;n integer:=0;
begin
 if jsonb_typeof(p_contacts)<>'array' or jsonb_array_length(p_contacts)>1000 then raise exception 'Import maksimal 1000 kontak';end if;
 for r in select value from jsonb_array_elements(p_contacts) loop
  if coalesce(r->>'phone','') !~ '^[1-9][0-9]{7,14}$' or length(trim(coalesce(r->>'name',''))) not between 1 and 100 then raise exception 'Kontak tidak valid';end if;
  if coalesce((r->>'consent')::boolean,false) and length(trim(coalesce(r->>'source','')))=0 then raise exception 'Sumber izin promosi wajib diisi';end if;
  insert into mc_campaign_contacts(phone,name,tags,source,consent,consent_at)
  values(r->>'phone',trim(r->>'name'),left(coalesce(r->>'tags',''),500),left(coalesce(r->>'source',''),500),coalesce((r->>'consent')::boolean,false),case when (r->>'consent')::boolean then now() end)
  on conflict(phone) do update set name=excluded.name,tags=excluded.tags,
    source=case when mc_campaign_contacts.opted_out_at is null then excluded.source else mc_campaign_contacts.source end,
    consent=case when mc_campaign_contacts.opted_out_at is not null then false else mc_campaign_contacts.consent or excluded.consent end,
    consent_at=coalesce(mc_campaign_contacts.consent_at,excluded.consent_at),updated_at=now();
  insert into mc_lead_state(chat_id,phone,display_name)values((r->>'phone')||'@c.us',r->>'phone',trim(r->>'name'))on conflict(chat_id)do update set display_name=excluded.display_name;
  n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'processed',n);
end$$;

-- Legacy claim contract remains intact; legacy workers cannot consume media campaigns.
create or replace function public.mc_claim_outbound_job(p_worker text default 'n8n')returns table(job_id uuid,chat_id text,body text,attempt_count integer,idempotency_key text)language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 update mc_outbound_jobs o set status='CANCELLED'from mc_lead_state l where l.chat_id=o.chat_id and o.kind<>'MANUAL'and o.status in('PENDING','RETRY')and(l.human_takeover_until>now()or(l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')and o.kind='FOLLOW_UP'));
 select o.id into v_id from mc_outbound_jobs o where o.kind<>'CAMPAIGN'and o.status in('PENDING','RETRY')and(o.next_retry_at is null or o.next_retry_at<=now())and(o.kind='MANUAL'or mc_bot_enabled())order by o.created_at for update of o skip locked limit 1;
 if v_id is null then return;end if;
 update mc_outbound_jobs o set status='PROCESSING',locked_at=now(),locked_by=p_worker,attempt_count=o.attempt_count+1 where o.id=v_id;
 return query select o.id,o.chat_id,o.body,o.attempt_count,o.idempotency_key from mc_outbound_jobs o where o.id=v_id;
end$$;

create function public.mc_claim_outbound_v2(p_worker text default 'n8n-v2')returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;
begin
 perform mc_recover_expired_jobs();
 update mc_outbound_jobs o set status='CANCELLED'where o.kind='CAMPAIGN'and o.status in('PENDING','RETRY')and exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status in('FAILED','CANCELLED')); 
 update mc_outbound_jobs o set status='CANCELLED'from mc_lead_state l where o.chat_id=l.chat_id and o.kind<>'MANUAL'and o.status in('PENDING','RETRY')and(l.human_takeover_until>now()or(l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')and o.kind in('CAMPAIGN','FOLLOW_UP')));
 update mc_outbound_jobs o set status='CANCELLED'from mc_campaign_contacts cc where o.kind in('CAMPAIGN','FOLLOW_UP')and o.chat_id=cc.phone||'@c.us'and o.status in('PENDING','RETRY')and(not cc.consent or cc.opted_out_at is not null);
 update mc_campaigns c set status='COMPLETED',updated_at=now()where c.status in('RUNNING','PAUSED')and exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id)and not exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id and o.status in('PENDING','RETRY','PROCESSING','UNKNOWN'));
 update mc_campaigns set status='RUNNING'where status='SCHEDULED'and scheduled_at<=now();
 select o.* into j from mc_outbound_jobs o left join mc_campaigns c on c.id=o.campaign_id
 where o.status in('PENDING','RETRY')and(o.next_retry_at is null or o.next_retry_at<=now())
 and (o.kind='MANUAL'or(o.kind<>'CAMPAIGN'and mc_bot_enabled())or(o.kind='CAMPAIGN'and c.status='RUNNING'))
 and not exists(select 1 from mc_outbound_jobs busy where busy.chat_id=o.chat_id and busy.status='PROCESSING')
 and (o.kind<>'CAMPAIGN'or not exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status<>'SENT'))
 order by case when o.kind='MANUAL'then 0 when o.kind='AI_REPLY'then 1 when o.kind='FOLLOW_UP'then 2 else 3 end,o.created_at
 for update of o skip locked limit 1;
 if j.id is null then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(j.chat_id,0))then return null;end if;
 if exists(select 1 from mc_outbound_jobs where chat_id=j.chat_id and status='PROCESSING')then return null;end if;
 update mc_outbound_jobs set status='PROCESSING',locked_at=now(),locked_by=p_worker,attempt_count=attempt_count+1 where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('job_id',j.id,'session_name',coalesce((select session_name from mc_campaigns where id=j.campaign_id),'default'));
end$$;

create function public.mc_campaign_preflight(p_job_id uuid,p_attempt integer)returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;v_ok boolean;
begin
 if not pg_try_advisory_xact_lock(hashtextextended((select chat_id from mc_outbound_jobs where id=p_job_id),0))then update mc_outbound_jobs set status='RETRY',next_retry_at=now()+interval '2 seconds',locked_at=null,locked_by=null where id=p_job_id and status='PROCESSING'and attempt_count=p_attempt;return jsonb_build_object('allowed',false);end if;
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING'or j.attempt_count<>p_attempt then return jsonb_build_object('allowed',false);end if;
 if j.inbound_event_id is not null and j.kind in('AI_REPLY','FOLLOW_UP')and exists(select 1 from mc_inbound_events newer join mc_inbound_events original on original.id=j.inbound_event_id where newer.chat_id=j.chat_id and not newer.from_me and not newer.is_group and newer.received_at>original.received_at)then update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null where id=j.id;return jsonb_build_object('allowed',false);end if;
 v_ok:=j.kind='MANUAL'or not exists(select 1 from mc_lead_state where chat_id=j.chat_id and human_takeover_until>now());
 if j.kind='CAMPAIGN'then
  v_ok:=v_ok and exists(select 1 from mc_campaigns where id=j.campaign_id and status='RUNNING')and exists(select 1 from mc_campaign_contacts where phone=split_part(j.chat_id,'@',1)and consent and opted_out_at is null)and not exists(select 1 from mc_campaign_recipients where id=j.recipient_id and replied_at is not null);
 else v_ok:=v_ok and(j.kind='MANUAL'or mc_bot_enabled());
  if j.kind='FOLLOW_UP' then v_ok:=v_ok and not exists(select 1 from mc_campaign_contacts where phone=split_part(j.chat_id,'@',1)and(not consent or opted_out_at is not null));end if;
 end if;
 if not v_ok then update mc_outbound_jobs set status=case when j.kind='CAMPAIGN'and exists(select 1 from mc_campaigns where id=j.campaign_id and status='PAUSED')then 'PENDING'else 'CANCELLED'end,locked_at=null,locked_by=null where id=j.id;end if;
 return jsonb_build_object('allowed',v_ok);
end$$;

create function public.mc_campaign_inbound()returns trigger language plpgsql security definer set search_path=public as $$
declare is_stop boolean;
begin
 if new.from_me or new.is_group then return new;end if;
 is_stop:=lower(trim(coalesce(new.message_text,'')))in('stop','unsubscribe','berhenti','jangan kirim lagi','stop promo');
 update mc_campaign_recipients cr set replied_at=coalesce(cr.replied_at,now())where cr.phone=split_part(new.chat_id,'@',1)and exists(select 1 from mc_outbound_jobs o where o.recipient_id=cr.id and o.status in('SENT','PROCESSING','UNKNOWN'));
 update mc_outbound_jobs set status='CANCELLED'where chat_id=new.chat_id and kind='CAMPAIGN'and status in('PENDING','RETRY');
 if is_stop then
  update mc_campaign_contacts set consent=false,opted_out_at=now(),updated_at=now()where phone=split_part(new.chat_id,'@',1);
  update mc_followup_jobs set status='CANCELLED',processed_at=now()where chat_id=new.chat_id and status='PENDING';
  update mc_outbound_jobs set status='CANCELLED'where chat_id=new.chat_id and kind='FOLLOW_UP'and status in('PENDING','RETRY');
 end if;
 return new;
end$$;
create trigger mc_campaign_inbound_trigger after insert on mc_inbound_events for each row execute function mc_campaign_inbound();

create table public.mc_contact_memories (
 chat_id text primary key,summary text not null default '',source_event_id uuid references mc_inbound_events(id),updated_at timestamptz not null default now()
);

alter function public.mc_get_ai_context(text,integer)rename to mc_get_ai_context_base;
create function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)returns jsonb language sql stable security definer set search_path=public as $$
 select mc_get_ai_context_base(p_chat_id,p_history_limit)||jsonb_build_object(
 'campaigns',coalesce((select jsonb_agg(x)from(select c.id,c.name,c.product_id,c.steps,c.bot_enabled,cr.replied_at,'inferred' as attribution from mc_campaign_recipients cr join mc_campaigns c on c.id=cr.campaign_id where cr.phone=split_part(p_chat_id,'@',1)and exists(select 1 from mc_outbound_jobs o where o.recipient_id=cr.id and o.status in('SENT','UNKNOWN','PROCESSING'))order by c.created_at desc limit 3)x),'[]'::jsonb),
 'memory',coalesce((select to_jsonb(m)from mc_contact_memories m where m.chat_id=p_chat_id),'{}'::jsonb),
 'opportunities',coalesce((select jsonb_agg(o)from mc_opportunities o where o.chat_id=p_chat_id),'[]'::jsonb),
 'promotional_opt_out',coalesce((select opted_out_at is not null from mc_campaign_contacts where phone=split_part(p_chat_id,'@',1)),false))
$$;

create function public.mc_campaign_job_changed()returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.campaign_id is not null and new.status is distinct from old.status then
  update mc_campaigns c set status='COMPLETED',updated_at=now()where c.id=new.campaign_id and c.status='RUNNING'and not exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id and o.status in('PENDING','RETRY','PROCESSING','UNKNOWN'));
 end if;
 return new;
end$$;
create trigger mc_campaign_job_changed_trigger after update of status on mc_outbound_jobs for each row execute function mc_campaign_job_changed();

create function public.mc_campaign_receipt(p_provider_id text,p_ack integer)returns void language sql security definer set search_path=public as $$
 update mc_outbound_jobs set delivery_status=case when p_ack>=3 then 'READ'when p_ack=2 and delivery_status is distinct from 'READ'then 'DELIVERED'else delivery_status end,
 delivered_at=case when p_ack>=2 then coalesce(delivered_at,now())else delivered_at end,
 read_at=case when p_ack>=3 then coalesce(read_at,now())else read_at end where provider_message_id=p_provider_id
$$;

create function public.mc_save_campaign(p_campaign jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;s jsonb;v_count integer;
begin
 if coalesce(p_campaign->>'session_name','default')<>'default'then raise exception 'Rilis ini mendukung satu sesi default';end if;
 if length(trim(coalesce(p_campaign->>'name',''))) not between 1 and 120 then raise exception 'Nama kampanye wajib diisi';end if;
 if not exists(select 1 from mc_runtime_knowledge where kind='PRODUCT' and source_key=p_campaign->>'product_id' and active)then raise exception 'Produk aktif tidak ditemukan';end if;
 if jsonb_typeof(p_campaign->'steps') is distinct from 'array' or jsonb_array_length(p_campaign->'steps') not between 1 and 2 then raise exception 'Isi 1 atau 2 pesan';end if;
 if jsonb_typeof(p_campaign->'phones') is distinct from 'array' or jsonb_array_length(p_campaign->'phones') not between 1 and 1000 then raise exception 'Pilih 1 sampai 1000 penerima';end if;
 for s in select value from jsonb_array_elements(p_campaign->'steps')loop
  if coalesce(s->>'type','')not in('TEXT','VIDEO') or length(trim(coalesce(s->>'body','')))not between 1 and 4000 then raise exception 'Isi pesan tidak valid';end if;
  if regexp_replace(s->>'body','\{\{nama\}\}','','g') ~ '\{\{|\}\}' then raise exception 'Variabel yang tersedia hanya {{nama}}';end if;
  if s->>'type'='VIDEO' and ((coalesce(s->>'media_url','') !~ '^https://[^ /]+/' and coalesce(s->>'media_url','') !~ '^storage://mycontrol-campaigns/[a-f0-9-]{36}\.mp4$') or length(s->>'media_url')>2048)then raise exception 'Video memerlukan URL HTTPS';end if;
 end loop;
 insert into mc_campaigns(name,product_id,steps,session_name,bot_enabled)
 values(trim(p_campaign->>'name'),p_campaign->>'product_id',p_campaign->'steps',coalesce(nullif(p_campaign->>'session_name',''),'default'),coalesce((p_campaign->>'bot_enabled')::boolean,true))returning id into v_id;
 insert into mc_campaign_recipients(campaign_id,phone,name)
 select v_id,c.phone,c.name from mc_campaign_contacts c where c.phone in(select jsonb_array_elements_text(p_campaign->'phones'));
 get diagnostics v_count=row_count;
 if v_count=0 then raise exception 'Penerima tidak ditemukan';end if;
 insert into mc_campaign_audit(campaign_id,action,detail)values(v_id,'CREATED',jsonb_build_object('recipients',v_count));
 return jsonb_build_object('ok',true,'id',v_id);
end$$;

create function public.mc_campaign_heartbeat(p_worker text,p_session text,p_video boolean)returns void language sql security definer set search_path=public as $$
 insert into mc_campaign_runtime(session_name,worker_id,video_supported)values(p_session,p_worker,p_video)
 on conflict(session_name)do update set worker_id=excluded.worker_id,video_supported=excluded.video_supported,last_seen=now()
$$;

create function public.mc_campaign_action(p_id uuid,p_action text,p_schedule timestamptz default null)returns jsonb language plpgsql security definer set search_path=public as $$
declare c mc_campaigns%rowtype;r record;s jsonb;i integer;v_status text;
begin
 select * into c from mc_campaigns where id=p_id for update;
 if c.id is null then raise exception 'Kampanye tidak ditemukan';end if;
 if p_action in('START','SCHEDULE','RESUME')then
  if not exists(select 1 from mc_campaign_runtime where session_name=c.session_name and last_seen>now()-interval '90 seconds')then raise exception 'Worker kampanye v2 belum terhubung; pasang workflow pengirim terbaru';end if;
  if exists(select 1 from jsonb_array_elements(c.steps) vid where vid->>'type'='VIDEO')and not exists(select 1 from mc_campaign_runtime where session_name=c.session_name and video_supported and last_seen>now()-interval '90 seconds')then raise exception 'Dukungan video belum diverifikasi worker';end if;
 end if;
 if p_action in('START','SCHEDULE')then
  if not c.is_test and not (c.test_campaign_id is not null and exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id) and not exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and status<>'SENT'))then raise exception 'Kirim uji dan pastikan seluruh pesan uji diterima gateway terlebih dahulu';end if;
  if c.status not in('DRAFT','SCHEDULED')then return jsonb_build_object('ok',true,'status',c.status);end if;
  if p_action='SCHEDULE' and (p_schedule is null or p_schedule<=now())then raise exception 'Pilih waktu mendatang';end if;
  for r in select cr.*,cc.consent,cc.opted_out_at from mc_campaign_recipients cr join mc_campaign_contacts cc on cc.phone=cr.phone where cr.campaign_id=c.id loop
   if not r.consent or r.opted_out_at is not null then update mc_campaign_recipients set excluded_reason='Tidak memiliki izin promosi'where id=r.id;continue;end if;
   i:=0;
   for s in select value from jsonb_array_elements(c.steps)loop
    i:=i+1;
    insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,campaign_id,recipient_id,step_no,media_url)
    values(r.phone||'@c.us',replace(s->>'body','{{nama}}',r.name),'CAMPAIGN','campaign:'||c.id||':'||r.id||':'||i,c.id,r.id,i,case when s->>'type'='VIDEO'then s->>'media_url'end)on conflict(idempotency_key)do nothing;
   end loop;
   insert into mc_opportunities(chat_id,product_id,campaign_id)values(r.phone||'@c.us',c.product_id,c.id)on conflict(chat_id,product_id)do nothing;
  end loop;
  if not exists(select 1 from mc_outbound_jobs where campaign_id=c.id)then raise exception 'Tidak ada penerima dengan izin promosi';end if;
  v_status:=case when p_action='SCHEDULE'then 'SCHEDULED'else 'RUNNING'end;
  update mc_campaigns set status=v_status,scheduled_at=case when p_action='SCHEDULE'then p_schedule else now()end,updated_at=now()where id=c.id;
 elsif p_action='PAUSE'and c.status in('RUNNING','SCHEDULED')then update mc_campaigns set status='PAUSED',updated_at=now()where id=c.id;
 elsif p_action='RESUME'and c.status='PAUSED'then update mc_campaigns set status='RUNNING',updated_at=now()where id=c.id;
 elsif p_action='CANCEL'and c.status not in('COMPLETED','CANCELLED')then
  update mc_campaigns set status='CANCELLED',updated_at=now()where id=c.id;
  update mc_outbound_jobs set status='CANCELLED'where campaign_id=c.id and status in('PENDING','RETRY');
 else raise exception 'Perubahan status tidak diizinkan';end if;
 insert into mc_campaign_audit(campaign_id,action)values(c.id,p_action);
 return jsonb_build_object('ok',true);
end$$;

create function public.mc_campaign_overview()returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb)from(
 select c.*,(select count(*)from mc_campaign_recipients r where r.campaign_id=c.id)as recipients,
 (select count(*)from mc_campaign_recipients r where r.campaign_id=c.id and r.replied_at is not null)as replies,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id)as total,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.status='SENT')as accepted,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.status='FAILED')as failed,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.status='UNKNOWN')as unknown,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.delivery_status in('DELIVERED','READ'))as delivered,
 (select count(*)from mc_outbound_jobs o where o.campaign_id=c.id and o.delivery_status='READ')as read
 from mc_campaigns c order by c.created_at desc limit 100)x
$$;
create function public.mc_campaign_optout(p_phone text)returns void language plpgsql security definer set search_path=public as $$begin
 update mc_campaign_contacts set consent=false,opted_out_at=now(),updated_at=now()where phone=p_phone;
 update mc_outbound_jobs set status='CANCELLED'where chat_id=p_phone||'@c.us'and kind in('CAMPAIGN','FOLLOW_UP')and status in('PENDING','RETRY');
 update mc_followup_jobs set status='CANCELLED',processed_at=now()where chat_id=p_phone||'@c.us'and status='PENDING';
end$$;
create function public.mc_campaign_decision_sync()returns trigger language plpgsql security definer set search_path=public as $$
declare v_chat text;v_product text;v_stage text;
begin
 select chat_id into v_chat from mc_inbound_events where id=new.inbound_event_id;
 v_product:=nullif(new.decision->>'product_id','');
 v_stage:=case new.decision->>'stage'when 'INTERESTED'then 'INTERESTED'when 'PRODUCT_INTEREST'then 'INTERESTED'when 'FOLLOW_UP'then 'FOLLOW_UP'when 'AWAITING_PAYMENT'then 'AWAITING_PAYMENT'when 'LOST'then 'LOST'else null end;
 if v_product is not null and v_stage is not null then
  update mc_opportunities set stage=v_stage,updated_at=now()where chat_id=v_chat and product_id=v_product and stage not in('WON','LOST');
 end if;
 return new;
end$$;
create trigger mc_campaign_decision_sync_trigger after insert on mc_ai_decisions for each row execute function mc_campaign_decision_sync();


create function public.mc_campaign_test(p_id uuid,p_phone text)returns jsonb language plpgsql security definer set search_path=public as $$
declare c mc_campaigns%rowtype;v_id uuid;
begin
 select * into c from mc_campaigns where id=p_id for update;
 if c.id is null or c.status<>'DRAFT' then raise exception 'Uji hanya tersedia untuk draft';end if;
 if p_phone !~ '^[1-9][0-9]{7,14}$'then raise exception 'Nomor uji tidak valid';end if;
 if not exists(select 1 from mc_campaign_contacts where phone=p_phone)then perform mc_campaign_contact_import(jsonb_build_array(jsonb_build_object('phone',p_phone,'name','Uji Owner','source','Nomor uji milik owner','consent',true)));end if;
 select (mc_save_campaign(jsonb_build_object('name',left('Uji: '||c.name,120),'product_id',c.product_id,'steps',c.steps,'session_name',c.session_name,'bot_enabled',false,'phones',jsonb_build_array(p_phone)))->>'id')::uuid into v_id;
 update mc_campaigns set is_test=true where id=v_id;
 perform mc_campaign_action(v_id,'START');
 update mc_campaigns set test_campaign_id=v_id where id=c.id;
 return jsonb_build_object('ok',true,'id',v_id);
end$$;


do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('mycontrol-campaigns','mycontrol-campaigns',false,26214400,array['video/mp4'])on conflict(id)do nothing;
 end if;
end$$;

create function public.mc_campaign_ai_gate()returns trigger language plpgsql security definer set search_path=public as $$
declare v_chat text;v_bot boolean;
begin
 select chat_id into v_chat from mc_inbound_events where id=new.inbound_event_id;
 select c.bot_enabled into v_bot from mc_campaigns c join mc_campaign_recipients r on r.campaign_id=c.id
 where r.phone=split_part(v_chat,'@',1)and exists(select 1 from mc_outbound_jobs o where o.recipient_id=r.id and o.status='SENT')order by c.created_at desc limit 1;
 if v_bot=false then return null;end if;
 return new;
end$$;
create trigger mc_campaign_ai_gate_trigger before insert on mc_ai_jobs for each row execute function mc_campaign_ai_gate();

alter function mc_complete_ai_job(uuid,jsonb,text,smallint,text,text)rename to mc_complete_ai_job_base;
create function mc_complete_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text)returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb:=p_decision;v_result jsonb;v_event uuid;
begin
 -- Model-generated financial success never marks the contact WON.
 if d->>'stage'='WON'then d:=jsonb_set(d,'{stage}','"AWAITING_PAYMENT"');end if;
 if d->>'lead_status'in('CLOSING','FULFILLED','VERIFIED')then d:=jsonb_set(d,'{lead_status}','"AWAITING_PAYMENT"');end if;
 if exists(select 1 from mc_campaign_contacts where phone=split_part(p_chat_id,'@',1)and opted_out_at is not null)or exists(select 1 from mc_campaign_recipients where phone=split_part(p_chat_id,'@',1)and replied_at is not null)then d:=jsonb_set(d,'{should_followup}','false');end if;
 v_result:=mc_complete_ai_job_base(p_job_id,d,p_model_used,p_slot_used,p_chat_id,p_reply);
 if coalesce((v_result->>'suppressed')::boolean,false)=false and coalesce((v_result->>'duplicate')::boolean,false)=false then
  select inbound_event_id into v_event from mc_ai_jobs where id=p_job_id;
  -- A sourced transcript digest is durable memory; it is not an AI-verified fact store.
  insert into mc_contact_memories(chat_id,summary,source_event_id)
  select p_chat_id,left(coalesce(message_text,''),1500),id from mc_inbound_events where id=v_event
  on conflict(chat_id)do update set summary=right(mc_contact_memories.summary||E'\n'||excluded.summary,8000),source_event_id=excluded.source_event_id,updated_at=now();
 end if;
 return v_result;
end$$;

create function public.mc_campaign_guard_followup()returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.kind='FOLLOW_UP'and(exists(select 1 from mc_campaign_contacts where phone=split_part(new.chat_id,'@',1)and(not consent or opted_out_at is not null))or exists(select 1 from mc_campaign_recipients where phone=split_part(new.chat_id,'@',1)and replied_at is not null))then new.status:='CANCELLED';end if;
 return new;
end$$;
create trigger mc_campaign_guard_followup_trigger before insert on mc_outbound_jobs for each row execute function mc_campaign_guard_followup();

create function public.mc_campaign_pause_all()returns void language plpgsql security definer set search_path=public as $$begin
 insert into mc_campaign_audit(campaign_id,action)select id,'PAUSE_ALL'from mc_campaigns where status in('RUNNING','SCHEDULED');
 update mc_campaigns set status='PAUSED',updated_at=now()where status in('RUNNING','SCHEDULED');
end$$;

create function public.mc_campaign_opportunity_update(p_id uuid,p_stage text,p_note text,p_due timestamptz default null)returns void language plpgsql security definer set search_path=public as $$
declare oldrow mc_opportunities%rowtype;
begin
 if p_stage not in('NEW','INTERESTED','FOLLOW_UP','AWAITING_PAYMENT','WON','LOST')then raise exception 'Tahap tidak valid';end if;
 select * into oldrow from mc_opportunities where id=p_id for update;
 if oldrow.id is null then raise exception 'Peluang tidak ditemukan';end if;
 update mc_opportunities set stage=p_stage,note=left(p_note,4000),next_followup_at=p_due,updated_at=now()where id=p_id;
 insert into mc_campaign_audit(campaign_id,action,detail)values(oldrow.campaign_id,'ADMIN_OPPORTUNITY_UPDATE',jsonb_build_object('actor','OWNER','opportunity_id',p_id,'previous_stage',oldrow.stage,'new_stage',p_stage));
end$$;


create function public.mc_campaign_presend_fail(p_job_id uuid,p_error text)returns void language sql security definer set search_path=public as $$
 update mc_outbound_jobs set status=case when attempt_count<3 then 'RETRY'else 'FAILED'end,next_retry_at=now()+interval '1 minute',last_error=left(p_error,1000),locked_at=null,locked_by=null where id=p_job_id and status='PROCESSING'
$$;

-- Import existing business identities without manufacturing promotional consent.
do $$begin
 if to_regclass('public.customers')is not null then
  insert into mc_campaign_contacts(phone,name,source,consent)
  select phone,left(coalesce(nullif(trim(name),''),phone),100),'Migrasi kontak lama',false from(
   select case when digits like '0%'then '62'||substring(digits from 2)else digits end as phone,name from(
    select regexp_replace(coalesce(whatsapp_number,''),'[^0-9]','','g')digits,name from customers)x)y
  where phone ~ '^[1-9][0-9]{7,14}$'on conflict(phone)do nothing;
 end if;
 if to_regclass('public.leads')is not null and to_regclass('public.customers')is not null then
  insert into mc_opportunities(chat_id,product_id,stage,note,next_followup_at)
  select phone||'@c.us',product_id,case status when 'FOLLOW_UP'then 'FOLLOW_UP'when 'LOST'then 'LOST'when 'CLOSING'then 'AWAITING_PAYMENT'else 'NEW'end,
  left('Migrasi status lama: '||status||E'\n'||coalesce(notes,''),4000),next_followup_at from(
   select case when digits like '0%'then '62'||substring(digits from 2)else digits end phone,product_id,status,notes,next_followup_at from(
    select regexp_replace(coalesce(c.whatsapp_number,''),'[^0-9]','','g')digits,l.product_id::text,l.status::text,l.notes,l.next_followup_at from leads l join customers c on c.id=l.customer_id)x)y
  where phone ~ '^[1-9][0-9]{7,14}$'and product_id is not null on conflict(chat_id,product_id)do nothing;
 end if;
end$$;

-- Only the authenticated owner API and trusted workers use these objects.
do $$declare t text;f record;begin
 foreach t in array array['mc_campaign_contacts','mc_campaigns','mc_campaign_recipients','mc_campaign_runtime','mc_opportunities','mc_campaign_audit','mc_contact_memories']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like 'mc_campaign_%'or p.proname in('mc_save_campaign','mc_claim_outbound_v2','mc_get_ai_context','mc_get_ai_context_base','mc_complete_ai_job','mc_complete_ai_job_base'))loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end$$;
notify pgrst,'reload schema';
commit;
