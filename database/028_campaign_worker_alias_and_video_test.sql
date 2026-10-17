begin;
-- Runtime session advertised by WAHA can be dynamic, while My Control supports one logical "default" campaign channel.
create or replace function public.mc_campaign_heartbeat(p_worker text,p_session text,p_video boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if nullif(trim(p_session),'') is null or nullif(trim(p_worker),'') is null then
 raise exception 'Worker identity and session required';end if;
 insert into mc_campaign_runtime(session_name,worker_id,video_supported,last_seen)
 values(p_session,p_worker,coalesce(p_video,false),now())
 on conflict(session_name)do update set worker_id=excluded.worker_id,
 video_supported=excluded.video_supported,last_seen=now();
 insert into mc_campaign_runtime(session_name,worker_id,video_supported,last_seen)
 values('default',p_worker,coalesce(p_video,false),now())
 on conflict(session_name)do update set worker_id=excluded.worker_id,
 video_supported=excluded.video_supported,last_seen=now();
end $$;

-- Test campaigns can verify MP4 before enabling any bulk video; owner-confirmed successful video
-- test is sufficient for this one campaign even if N8N's optional env flag remains false.
create or replace function public.mc_campaign_action(p_id uuid,p_action text,p_schedule timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c mc_campaigns%rowtype;r record;s jsonb;i integer;v_status text;v_video boolean;
begin
 select * into c from mc_campaigns where id=p_id for update;
 if c.id is null then raise exception 'Kampanye tidak ditemukan';end if;
 if p_action in('START','SCHEDULE','RESUME')then
  if not exists(select 1 from mc_campaign_runtime where session_name=c.session_name and last_seen>now()-interval '90 seconds')
  then raise exception 'Worker kampanye belum terhubung untuk sesi aktif';end if;
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
    case when s->>'type'='VIDEO' then s->>'media_url'end) on conflict(idempotency_key)do nothing;
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
revoke all on function public.mc_campaign_heartbeat(text,text,boolean),
public.mc_campaign_action(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mc_campaign_heartbeat(text,text,boolean),
public.mc_campaign_action(uuid,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;