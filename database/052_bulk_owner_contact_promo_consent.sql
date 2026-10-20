-- Record bulk owner-provided promotional consent while respecting opt-outs.
-- Only phone identities already in the visible contact directory are eligible.
begin;
create or replace function public.mc_bulk_contact_promo_consent(
  p_phones text[] default null,
  p_all boolean default false,
  p_search text default '',
  p_evidence text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_evidence text := trim(coalesce(p_evidence,''));
  v_search text := lower(trim(left(coalesce(p_search,''),80)));
  v_requested integer := 0;
  v_already integer := 0;
  v_updated integer := 0;
begin
  if length(v_evidence)<12 or length(v_evidence)>500 then
    raise exception 'Sumber persetujuan promosi wajib 12 sampai 500 karakter';
  end if;
  if p_all is null then raise exception 'Cakupan kontak tidak valid';end if;
  if not p_all and (
    p_phones is null or cardinality(p_phones)=0 or cardinality(p_phones)>1000
    or exists(select 1 from unnest(p_phones) p where p is null or p !~ '^[1-9][0-9]{7,14}$')
  ) then raise exception 'Pilih 1 sampai 1000 kontak dengan nomor WhatsApp valid';end if;
  if p_all and cardinality(coalesce(p_phones,array[]::text[]))>0 then
    raise exception 'Pilih kontak manual atau semua kontak, bukan keduanya';
  end if;

  with candidates as (
    select c.phone,c.consent,c.opted_out_at,
      exists(select 1 from public.mc_contact_exclusions e where e.phone=c.phone) as excluded
    from public.mc_campaign_contacts c
    where c.source<>'CAMPAIGN_ONLY_STAGED'
      and c.phone ~ '^[1-9][0-9]{7,14}$'
      and (
        (p_all and (v_search='' or strpos(lower(concat_ws(' ',c.name,c.phone,c.tags)),v_search)>0))
        or (not p_all and c.phone=any(p_phones))
      )
  )
  select count(*),count(*) filter(where consent and opted_out_at is null and not excluded)
  into v_requested,v_already from candidates;

  update public.mc_campaign_contacts c set
    consent=true,consent_at=now(),consent_evidence=v_evidence,updated_at=now()
  where c.source<>'CAMPAIGN_ONLY_STAGED'
    and c.phone ~ '^[1-9][0-9]{7,14}$'
    and c.consent is distinct from true
    and c.opted_out_at is null
    and not exists(select 1 from public.mc_contact_exclusions e where e.phone=c.phone)
    and (
      (p_all and (v_search='' or strpos(lower(concat_ws(' ',c.name,c.phone,c.tags)),v_search)>0))
      or (not p_all and c.phone=any(p_phones))
    );
  get diagnostics v_updated=row_count;

  insert into public.mc_campaign_audit(action,detail)
  values('OWNER_BULK_PROMO_CONSENT',jsonb_build_object(
    'actor','OWNER','scope',case when p_all then 'ALL_FILTERED' else 'SELECTED' end,
    'search',case when p_all then left(coalesce(p_search,''),80) else '' end,
    'requested',v_requested,'updated',v_updated,'already_allowed',v_already,
    'skipped',greatest(v_requested-v_updated-v_already,0),'evidence',v_evidence
  ));
  return jsonb_build_object('ok',true,'requested',v_requested,'updated',v_updated,
    'already_allowed',v_already,'skipped',greatest(v_requested-v_updated-v_already,0));
end;
$$;
revoke all on function public.mc_bulk_contact_promo_consent(text[],boolean,text,text)
  from public,anon,authenticated;
grant execute on function public.mc_bulk_contact_promo_consent(text[],boolean,text,text)
  to service_role;
notify pgrst,'reload schema';
commit;
