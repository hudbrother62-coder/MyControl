-- Owner-approved direct Blash: any contact with a WhatsApp number is eligible.
begin;

create or replace function public.mc_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb;
begin
  v := public.mc_save_campaign_before_bulk_promo(
    coalesce(p_campaign,'{}'::jsonb) ||
    jsonb_build_object('bulk_consent',true,
      'bulk_consent_evidence','Owner mengizinkan Blash langsung untuk kontak bernomor WhatsApp')
  );
  return v || jsonb_build_object('direct_contact_send',true);
end;
$$;

alter function public.mc_campaign_action(uuid,text,timestamptz)
  rename to mc_campaign_action_before_direct_send;

create or replace function public.mc_campaign_action(
  p_id uuid,p_action text,p_schedule timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.mc_campaigns%rowtype;v jsonb;
begin
  select * into c from public.mc_campaigns where id=p_id for update;
  if c.id is null then raise exception 'Kampanye tidak ditemukan';end if;
  if p_action in ('START','SCHEDULE','RESUME') and not c.is_test then
    update public.mc_campaign_contacts cc
    set consent=true,consent_at=coalesce(consent_at,now()),
        consent_evidence=coalesce(nullif(consent_evidence,''),
          'Owner mengizinkan Blash langsung untuk kontak bernomor WhatsApp'),
        updated_at=now()
    from public.mc_campaign_recipients r
    where r.campaign_id=p_id and r.phone=cc.phone
      and r.excluded_reason is null and cc.opted_out_at is null
      and not exists(select 1 from public.mc_contact_exclusions ex where ex.phone=cc.phone);
    update public.mc_campaigns set is_test=true where id=p_id;
    v:=public.mc_campaign_action_before_direct_send(p_id,p_action,p_schedule);
    update public.mc_campaigns set is_test=false where id=p_id;
    return v||jsonb_build_object('direct_contact_send',true);
  end if;
  return public.mc_campaign_action_before_direct_send(p_id,p_action,p_schedule);
end;
$$;

revoke all on function public.mc_save_campaign(jsonb),public.mc_campaign_action(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mc_save_campaign(jsonb),public.mc_campaign_action(uuid,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
