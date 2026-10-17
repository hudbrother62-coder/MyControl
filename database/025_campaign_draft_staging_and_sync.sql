begin;
alter function public.mc_save_campaign(jsonb) rename to mc_save_campaign_before_staged_import;
create function public.mc_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb;r jsonb;v_phone text;v_evidence text;v_consent boolean;
begin
 if jsonb_typeof(p_campaign->'phones')<>'array' or
 jsonb_array_length(p_campaign->'phones') not between 1 and 1000 then raise exception 'Pilih 1-1000 penerima';end if;
 if exists(select 1 from jsonb_array_elements_text(p_campaign->'phones') x
 where x !~ '^[1-9][0-9]{7,14}$') then raise exception 'Ada nomor tidak valid';end if;
 if jsonb_typeof(coalesce(p_campaign->'import_contacts','[]'::jsonb))<>'array' or
 jsonb_array_length(coalesce(p_campaign->'import_contacts','[]'::jsonb))>1000 then raise exception 'Impor maksimal 1000 kontak';end if;
 for r in select value from jsonb_array_elements(coalesce(p_campaign->'import_contacts','[]'::jsonb)) loop
  v_phone:=r->>'phone';
  if v_phone !~ '^[1-9][0-9]{7,14}$' or length(trim(coalesce(r->>'name',''))) not between 1 and 100
  then raise exception 'Baris impor tidak valid';end if;
  if not exists(select 1 from jsonb_array_elements_text(p_campaign->'phones') as a(phone) where a.phone=v_phone)
  then continue;end if;
  v_consent:=coalesce((r->>'consent')::boolean,false);
  v_evidence:=left(trim(coalesce(r->>'consent_evidence','')),500);
  if v_consent and length(v_evidence)<12 then raise exception 'Nomor %: catat bukti izin minimal 12 karakter',v_phone;end if;
  insert into mc_campaign_contacts(phone,name,tags,source,consent,consent_at,consent_evidence)
  values(v_phone,trim(r->>'name'),left(coalesce(r->>'tags',''),500),
  'CAMPAIGN_ONLY_STAGED',v_consent,case when v_consent then now() end,v_evidence)
  on conflict(phone) do update set
   name=case when mc_campaign_contacts.source='CAMPAIGN_ONLY_STAGED' then excluded.name
    else mc_campaign_contacts.name end,
   tags=case when mc_campaign_contacts.source='CAMPAIGN_ONLY_STAGED' then excluded.tags
    else mc_campaign_contacts.tags end,
   consent=case when mc_campaign_contacts.opted_out_at is not null then false
    else mc_campaign_contacts.consent or excluded.consent end,
   consent_at=case when mc_campaign_contacts.opted_out_at is not null then mc_campaign_contacts.consent_at
    when excluded.consent and not mc_campaign_contacts.consent then now()
    else mc_campaign_contacts.consent_at end,
   consent_evidence=case when mc_campaign_contacts.opted_out_at is null and excluded.consent
    then excluded.consent_evidence else mc_campaign_contacts.consent_evidence end,
   updated_at=now();
 end loop;
 insert into mc_campaign_contacts(phone,name,source,consent)
 select distinct x.phone,coalesce(
 (select nullif(l.display_name,'') from mc_lead_state l where l.phone=x.phone order by l.updated_at desc limit 1),
 x.phone),'CAMPAIGN_ONLY_STAGED',false
 from jsonb_array_elements_text(p_campaign->'phones')x(phone)
 where not exists(select 1 from mc_campaign_contacts c where c.phone=x.phone)
 on conflict(phone) do nothing;
 v:=mc_save_campaign_before_staged_import(p_campaign);
 if jsonb_typeof(p_campaign->'excluded_phones')='array' then
  update mc_campaign_recipients r set excluded_reason='Dikecualikan dari kampanye ini'
  where r.campaign_id=(v->>'id')::uuid and r.phone in (
   select value from jsonb_array_elements_text(p_campaign->'excluded_phones')
   where value~'^[1-9][0-9]{7,14}$'
  );
 end if;
 return v||jsonb_build_object('excluded',(
   select count(*) from mc_campaign_recipients r where r.campaign_id=(v->>'id')::uuid
   and r.excluded_reason is not null));
end $$;

-- Automatic addition to the main WhatsApp directory ONLY once gateway reports SENT.
create function public.mc_campaign_accepted_contact_sync()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_name text;v_source text;v_phone text;
begin
 if new.kind='CAMPAIGN' and new.status='SENT' and old.status is distinct from new.status then
  v_phone:=split_part(new.chat_id,'@',1);
  if v_phone~'^[1-9][0-9]{7,14}$' then
   select source,name into v_source,v_name from mc_campaign_contacts where phone=v_phone;
   if v_source='CAMPAIGN_ONLY_STAGED' then
    insert into mc_lead_state(chat_id,phone,display_name)
    values(v_phone||'@c.us',v_phone,coalesce(nullif(v_name,''),v_phone))
    on conflict(chat_id)do update set display_name=coalesce(nullif(mc_lead_state.display_name,''),excluded.display_name);
    update mc_campaign_contacts set source='CAMPAIGN_CONTACTED',updated_at=now()
    where phone=v_phone and source='CAMPAIGN_ONLY_STAGED';
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger mc_campaign_accepted_contact_sync_trigger
 after update of status on public.mc_outbound_jobs
 for each row execute function mc_campaign_accepted_contact_sync();
revoke all on function public.mc_save_campaign_before_staged_import(jsonb),
public.mc_save_campaign(jsonb),public.mc_campaign_accepted_contact_sync()
from public,anon,authenticated;
grant execute on function public.mc_save_campaign(jsonb),
public.mc_campaign_accepted_contact_sync() to service_role;
notify pgrst,'reload schema';
commit;