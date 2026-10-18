begin;
-- Poster support is blocked until the upgraded n8n sender advertises sendImage capability.
alter table public.mc_campaign_runtime add column if not exists image_supported boolean not null default false;
update storage.buckets set allowed_mime_types=array['video/mp4','image/jpeg','image/png','image/webp']::text[]
 where id='mycontrol-campaigns';
create or replace function public.mc_campaign_heartbeat(p_worker text,p_session text,p_video boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if nullif(trim(p_session),'') is null or nullif(trim(p_worker),'') is null then
  raise exception 'Worker identity and session required';end if;
 insert into mc_campaign_runtime(session_name,worker_id,video_supported,image_supported,last_seen)
 values(p_session,p_worker,coalesce(p_video,false),false,now())
 on conflict(session_name)do update set worker_id=excluded.worker_id,video_supported=excluded.video_supported,image_supported=false,last_seen=now();
 insert into mc_campaign_runtime(session_name,worker_id,video_supported,image_supported,last_seen)
 values('default',p_worker,coalesce(p_video,false),false,now())
 on conflict(session_name)do update set worker_id=excluded.worker_id,video_supported=excluded.video_supported,image_supported=false,last_seen=now();
end $$;

create or replace function public.mc_campaign_heartbeat_v2(p_worker text,p_session text,p_video boolean,p_image boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform mc_campaign_heartbeat(p_worker,p_session,p_video);
 update mc_campaign_runtime set image_supported=coalesce(p_image,false),last_seen=now()
 where session_name in(p_session,'default');
end $$;
create or replace function public.mc_save_campaign_before_staged_import(p_campaign jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;s jsonb;v_count integer;
begin
 if coalesce(p_campaign->>'session_name','default')<>'default'then raise exception 'Rilis ini mendukung satu sesi default';end if;
 if length(trim(coalesce(p_campaign->>'name',''))) not between 1 and 120 then raise exception 'Nama kampanye wajib diisi';end if;
 if not exists(select 1 from mc_runtime_knowledge where kind='PRODUCT' and source_key=p_campaign->>'product_id' and active)then raise exception 'Produk aktif tidak ditemukan';end if;
 if jsonb_typeof(p_campaign->'steps') is distinct from 'array' or jsonb_array_length(p_campaign->'steps') not between 1 and 2 then raise exception 'Isi 1 atau 2 pesan';end if;
 if jsonb_typeof(p_campaign->'phones') is distinct from 'array' or jsonb_array_length(p_campaign->'phones') not between 1 and 1000 then raise exception 'Pilih 1 sampai 1000 penerima';end if;
 for s in select value from jsonb_array_elements(p_campaign->'steps')loop
  if coalesce(s->>'type','')not in('TEXT','VIDEO','IMAGE')
     or length(coalesce(s->>'body',''))>4000
     or (s->>'type' in('TEXT','VIDEO') and length(trim(coalesce(s->>'body','')))<1)
   then raise exception 'Isi pesan tidak valid';end if;
  if regexp_replace(s->>'body','\{\{nama\}\}','','g') ~ '\{\{|\}\}' then raise exception 'Variabel yang tersedia hanya {{nama}}';end if;
  if s->>'type'='IMAGE'
    and (
     length(coalesce(s->>'media_url',''))>2048
     or (coalesce(s->>'media_url','') !~* '^storage://mycontrol-campaigns/[a-f0-9-]{36}\.(jpg|jpeg|png|webp) ((coalesce(s->>'media_url','') !~ '^https://[^ /]+/' and coalesce(s->>'media_url','') !~ '^storage://mycontrol-campaigns/[a-f0-9-]{36}\.mp4$') or length(s->>'media_url')>2048)then raise exception 'Video memerlukan URL HTTPS';end if;
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
       and coalesce(s->>'media_url','') !~* '^https://[^ /?#:@]+/[^ ]+\.(jpg|jpeg|png|webp)(\?[^ ]*)? ((coalesce(s->>'media_url','') !~ '^https://[^ /]+/' and coalesce(s->>'media_url','') !~ '^storage://mycontrol-campaigns/[a-f0-9-]{36}\.mp4$') or length(s->>'media_url')>2048)then raise exception 'Video memerlukan URL HTTPS';end if;
 end loop;
 insert into mc_campaigns(name,product_id,steps,session_name,bot_enabled)
 values(trim(p_campaign->>'name'),p_campaign->>'product_id',p_campaign->'steps',coalesce(nullif(p_campaign->>'session_name',''),'default'),coalesce((p_campaign->>'bot_enabled')::boolean,true))returning id into v_id;
 insert into mc_campaign_recipients(campaign_id,phone,name)
 select v_id,c.phone,c.name from mc_campaign_contacts c where c.phone in(select jsonb_array_elements_text(p_campaign->'phones'));
 get diagnostics v_count=row_count;
 if v_count=0 then raise exception 'Penerima tidak ditemukan';end if;
 insert into mc_campaign_audit(campaign_id,action,detail)values(v_id,'CREATED',jsonb_build_object('recipients',v_count));
 return jsonb_build_object('ok',true,'id',v_id);
end$$;)
    )then raise exception 'Poster memerlukan file unggahan atau URL gambar HTTPS langsung';end if;
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
create or replace function public.mc_campaign_action(p_id uuid,p_action text,p_schedule timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c mc_campaigns%rowtype;r record;s jsonb;i integer;v_status text;v_video boolean;v_image boolean;
begin
 select * into c from mc_campaigns where id=p_id for update;
 if c.id is null then raise exception 'Kampanye tidak ditemukan';end if;
 if p_action in('START','SCHEDULE','RESUME')then
  if not exists(select 1 from mc_campaign_runtime where session_name=c.session_name and last_seen>now()-interval '90 seconds')
  then raise exception 'Worker kampanye belum terhubung untuk sesi aktif';end if;
  v_image:=exists(select 1 from jsonb_array_elements(c.steps) img where img->>'type'='IMAGE');
  if v_image and not exists(select 1 from mc_campaign_runtime rt
    where rt.session_name=c.session_name and rt.image_supported and rt.last_seen>now()-interval '90 seconds')
  then raise exception 'Pengirim poster WAHA sendImage belum aktif di n8n. Perbarui workflow outbound sebelum mengirim uji.';end if;
  v_video:=exists(select 1 from jsonb_array_elements(c.steps) vid where vid->>'type'='VIDEO');
  if v_video and not c.is_test
  and not exists(select 1 from mc_campaign_runtime where session_name=c.session_name
    and video_supported and last_seen>now()-interval '90 seconds')
  and not(
    c.test_campaign_id is not null and
    exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and
      media_url is not null and status='SENT' and nullif(provider_message_id,'') is not null)
    and not exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and status<>'SENT')
  )then raise exception 'Uji video ke WhatsApp sendiri hingga diterima gateway sebelum kampanye massal';end if;
 end if;
 if p_action in('START','SCHEDULE')then
  if not c.is_test and not(c.test_campaign_id is not null and exists(
   select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id)
   and not exists(select 1 from mc_outbound_jobs where campaign_id=c.test_campaign_id and status<>'SENT'))
  then raise exception 'Kirim uji dan pastikan pesan uji diterima gateway terlebih dahulu';end if;
  if c.status not in('DRAFT','SCHEDULED')then return jsonb_build_object('ok',true,'status',c.status);end if;
  if p_action='SCHEDULE' and (p_schedule is null or p_schedule<=now())then raise exception 'Pilih waktu mendatang';end if;
  for r in select cr.*,cc.consent,cc.opted_out_at
   from mc_campaign_recipients cr join mc_campaign_contacts cc on cc.phone=cr.phone
   where cr.campaign_id=c.id loop
   if r.excluded_reason is not null then continue;end if;
   if not r.consent or r.opted_out_at is not null then
    update mc_campaign_recipients set excluded_reason='Tidak memiliki izin promosi' where id=r.id;continue;
   end if;
   if exists(select 1 from mc_contact_exclusions ex where ex.phone=r.phone)then
    update mc_campaign_recipients set excluded_reason='Pengecualian owner' where id=r.id;continue;
   end if;
   i:=0;
   for s in select value from jsonb_array_elements(c.steps)loop
    i:=i+1;
    insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key,campaign_id,recipient_id,step_no,media_url)
    values(r.phone||'@c.us',replace(s->>'body','{{nama}}',r.name),
    'CAMPAIGN','campaign:'||c.id||':'||r.id||':'||i,c.id,r.id,i,
    case when s->>'type' in('VIDEO','IMAGE') then s->>'media_url'end) on conflict(idempotency_key)do nothing;
   end loop;
   insert into mc_opportunities(chat_id,product_id,campaign_id)
   values(r.phone||'@c.us',c.product_id,c.id)on conflict(chat_id,product_id)do nothing;
  end loop;
  if not exists(select 1 from mc_outbound_jobs where campaign_id=c.id)
  then raise exception 'Tidak ada penerima dengan izin promosi yang tidak dikecualikan';end if;
  v_status:=case when p_action='SCHEDULE' then 'SCHEDULED' else 'RUNNING' end;
  update mc_campaigns set status=v_status,scheduled_at=case when p_action='SCHEDULE'then p_schedule else now()end,updated_at=now() where id=c.id;
 elsif p_action='PAUSE' and c.status in('RUNNING','SCHEDULED')then update mc_campaigns set status='PAUSED',updated_at=now()where id=c.id;
 elsif p_action='RESUME' and c.status='PAUSED'then update mc_campaigns set status='RUNNING',updated_at=now()where id=c.id;
 elsif p_action='CANCEL' and c.status not in('COMPLETED','CANCELLED')then
  update mc_campaigns set status='CANCELLED',updated_at=now()where id=c.id;
  update mc_outbound_jobs set status='CANCELLED'where campaign_id=c.id and status in('PENDING','RETRY');
 else raise exception 'Perubahan status tidak diizinkan';end if;
 insert into mc_campaign_audit(campaign_id,action)values(c.id,p_action);
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.mc_campaign_readiness(p_id uuid)
returns jsonb
language sql stable security definer set search_path=public
as $$
 select jsonb_build_object(
  'recipient_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id),
  'eligible_total',(select count(*)
   from mc_campaign_recipients r join mc_campaign_contacts cc on cc.phone=r.phone
   where r.campaign_id=c.id and r.excluded_reason is null and cc.consent=true
    and cc.opted_out_at is null
    and not exists(select 1 from mc_contact_exclusions e where e.phone=r.phone)),
  'excluded_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id and r.excluded_reason is not null),
  'test_status',case
   when c.test_campaign_id is null then 'NOT_SENT'
   when not exists(select 1 from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id) then 'NOT_SENT'
   when exists(select 1 from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id and j.status<>'SENT')
    then coalesce((select j.status from mc_outbound_jobs j where j.campaign_id=c.test_campaign_id and j.status<>'SENT' order by j.step_no limit 1),'PENDING')
   else 'SENT' end,
  'has_image',exists(select 1 from jsonb_array_elements(c.steps) step where step->>'type'='IMAGE'),
  'image_supported',exists(select 1 from mc_campaign_runtime rt where rt.session_name=c.session_name and rt.image_supported and rt.last_seen>now()-interval '90 seconds'),
  'has_video',exists(select 1 from jsonb_array_elements(c.steps) step where step->>'type'='VIDEO'),
  'video_supported',exists(select 1 from mc_campaign_runtime runtime
   where runtime.session_name=c.session_name and runtime.video_supported=true
   and runtime.last_seen>now()-interval '90 seconds'),
  'worker_online',exists(select 1 from mc_campaign_runtime runtime
   where runtime.session_name=c.session_name and runtime.last_seen>now()-interval '90 seconds')
 ) from mc_campaigns c where c.id=p_id
$$;
revoke all on function public.mc_campaign_heartbeat_v2(text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.mc_campaign_heartbeat_v2(text,text,boolean,boolean) to service_role;
notify pgrst,'reload schema';
commit;