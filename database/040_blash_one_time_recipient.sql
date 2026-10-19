-- Campaign recipients may only be included once across regular Blash campaigns.
-- Test sends are exempt. Old accepted/uncertain sends are backfilled as protected.
begin;
create table if not exists public.mc_campaign_one_time_phones (
 phone text primary key references public.mc_campaign_contacts(phone),
 campaign_id uuid not null references public.mc_campaigns(id),
 reserved_at timestamptz not null default now()
);
create index if not exists mc_campaign_one_time_campaign_idx on public.mc_campaign_one_time_phones(campaign_id);
alter table public.mc_campaign_one_time_phones enable row level security;
revoke all on table public.mc_campaign_one_time_phones from public,anon,authenticated;
grant select,insert,update,delete on table public.mc_campaign_one_time_phones to service_role;
insert into public.mc_campaign_one_time_phones(phone,campaign_id)
select distinct on (split_part(j.chat_id,'@',1)) split_part(j.chat_id,'@',1),j.campaign_id
from public.mc_outbound_jobs j
join public.mc_campaigns c on c.id=j.campaign_id
join public.mc_campaign_contacts cc on cc.phone=split_part(j.chat_id,'@',1)
where j.kind='CAMPAIGN' and not c.is_test
 and j.status not in ('FAILED','CANCELLED')
order by split_part(j.chat_id,'@',1),j.created_at,j.id
on conflict(phone)do nothing;
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
   -- Serialize one-time Blash ownership by the normalized phone, across all campaigns.
   -- Test campaigns bypass this marketing reservation.
   if not c.is_test then
    insert into mc_campaign_one_time_phones(phone,campaign_id)
    values(r.phone,c.id) on conflict(phone)do nothing;
    if not exists(select 1 from mc_campaign_one_time_phones once
      where once.phone=r.phone and once.campaign_id=c.id)then
     update mc_campaign_recipients set excluded_reason='Sudah pernah masuk Blash lain' where id=r.id;
     continue;
    end if;
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
  -- Release only untouched reservations; ambiguous or previously processed sends stay protected.
  delete from mc_campaign_one_time_phones once where once.campaign_id=c.id
   and not exists(select 1 from mc_outbound_jobs job
     where job.campaign_id=c.id and split_part(job.chat_id,'@',1)=once.phone
       and job.status<>'CANCELLED');
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
    and not exists(select 1 from mc_contact_exclusions e where e.phone=r.phone)
    and not exists(select 1 from mc_campaign_one_time_phones once where once.phone=r.phone and once.campaign_id<>c.id)),
  'excluded_total',(select count(*) from mc_campaign_recipients r where r.campaign_id=c.id and r.excluded_reason is not null),
  'already_blasted_total',(select count(*) from mc_campaign_recipients r
   join mc_campaign_one_time_phones once on once.phone=r.phone
   where r.campaign_id=c.id and once.campaign_id<>c.id),
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
revoke all on function public.mc_campaign_action(uuid,text,timestamptz),public.mc_campaign_readiness(uuid)
 from public,anon,authenticated;
grant execute on function public.mc_campaign_action(uuid,text,timestamptz),public.mc_campaign_readiness(uuid) to service_role;
notify pgrst,'reload schema';
commit;
