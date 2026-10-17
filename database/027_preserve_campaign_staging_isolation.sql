begin;
create or replace function public.mc_sync_contact_to_inbox()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Excel recipient staging must never pre-create a WhatsApp conversation/contact.
 if new.source='CAMPAIGN_ONLY_STAGED' then return new;end if;
 insert into mc_lead_state(chat_id,phone,display_name)
 values(new.phone||'@c.us',new.phone,new.name)
 on conflict(chat_id)do update set display_name=excluded.display_name,phone=excluded.phone
 where mc_lead_state.display_name is distinct from excluded.display_name
    or mc_lead_state.phone is distinct from excluded.phone;
 return new;
end $$;
revoke all on function public.mc_sync_contact_to_inbox() from public,anon,authenticated;
grant execute on function public.mc_sync_contact_to_inbox() to service_role;
commit;