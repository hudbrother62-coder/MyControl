-- Customer-initiated explicit WhatsApp opt-in can be recorded without any owner checkbox.
-- Never infer consent from greetings, contacts imports without evidence, past Blash,
-- or @lid identifiers without a verified delivery-receipt phone mapping.
begin;
create or replace function public.mc_capture_explicit_prime_store_promo_optin()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_msg text;v_phone text;v_proof text;
begin
 if new.from_me or new.is_group or nullif(trim(coalesce(new.message_text,'')),'') is null then return new;end if;
 v_msg:=lower(regexp_replace(trim(new.message_text),'[[:space:]]+',' ','g'));
 if v_msg not in(
   'saya setuju menerima promosi dari prime store',
   'saya setuju menerima promo dari prime store',
   'saya bersedia menerima promosi dari prime store',
   'saya ingin menerima promosi dari prime store',
   'saya setuju menerima penawaran dari prime store'
 ) then return new;end if;
 v_phone:=public.mc_campaign_phone_for_chat(new.chat_id);
 if v_phone is null or v_phone !~ '^[1-9][0-9]{7,14}$' then return new;end if;
 v_proof:=left('Customer opt-in via WhatsApp message '||new.external_message_id||': '||trim(new.message_text),500);
 insert into public.mc_campaign_contacts
   (phone,name,tags,source,consent,consent_at,consent_evidence,opted_out_at)
 values (v_phone,
   coalesce((select nullif(display_name,'') from public.mc_lead_state
    where phone=v_phone order by updated_at desc limit 1),v_phone),
   '','CUSTOMER_WHATSAPP_EXPLICIT_OPTIN',true,now(),v_proof,null)
 on conflict(phone) do update set
   consent=true,consent_at=now(),consent_evidence=excluded.consent_evidence,
   source=excluded.source,opted_out_at=null,updated_at=now();
 return new;
end;
$$;
drop trigger if exists mc_capture_explicit_prime_store_promo_optin_trigger on public.mc_inbound_events;
create trigger mc_capture_explicit_prime_store_promo_optin_trigger
after insert on public.mc_inbound_events
for each row execute function public.mc_capture_explicit_prime_store_promo_optin();
revoke all on function public.mc_capture_explicit_prime_store_promo_optin() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
