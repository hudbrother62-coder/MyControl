begin;
-- Registered phones and service contacts share one directory. Consent is never inferred.
create function public.mc_sync_contact_to_inbox()returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into mc_lead_state(chat_id,phone,display_name)values(new.phone||'@c.us',new.phone,new.name)
 on conflict(chat_id)do update set display_name=excluded.display_name,phone=excluded.phone
 where mc_lead_state.display_name is distinct from excluded.display_name or mc_lead_state.phone is distinct from excluded.phone;
 return new;
end$$;
create trigger mc_contact_to_inbox after insert or update of name on mc_campaign_contacts for each row execute function mc_sync_contact_to_inbox();
alter table mc_opportunities drop constraint mc_opportunities_stage_check;
alter table mc_opportunities add constraint mc_opportunities_stage_check check(stage in('NEW','INTERESTED','FOLLOW_UP','PENDING','AWAITING_PAYMENT','WON','LOST'));
create function public.mc_sync_lead_directory_crm()returns trigger language plpgsql security definer set search_path=public as $$declare p text;s text;begin
 -- A LID is an opaque identifier, never a verified telephone number.
 if new.chat_id ~ '^[1-9][0-9]{7,14}@(c\.us|s\.whatsapp\.net)$'then
  p:=split_part(new.chat_id,'@',1);
  insert into mc_campaign_contacts(phone,name,source,consent)values(p,left(coalesce(nullif(new.display_name,''),p),100),'WhatsApp CS',false)on conflict(phone)do nothing;
 end if;
 if nullif(new.product_id,'')is not null then
  s:=case when new.stage in('INTERESTED','PRODUCT_INTEREST','CHECKOUT')then 'INTERESTED' when new.stage in('AWAITING_PAYMENT','PAYMENT_SUBMITTED','WAITING_OWNER_APPROVAL')then 'AWAITING_PAYMENT' when new.stage in('PENDING','HUMAN_HANDOFF')then 'PENDING' when new.stage='FOLLOW_UP'then 'FOLLOW_UP' when new.stage='LOST'then 'LOST'else 'NEW'end;
  insert into mc_opportunities(chat_id,product_id,stage)values(new.chat_id,new.product_id,s)
  on conflict(chat_id,product_id)do update set stage=excluded.stage,updated_at=now()
  where mc_opportunities.stage not in('WON','LOST')and mc_opportunities.stage is distinct from excluded.stage;
 end if;
 return new;
end$$;
create trigger mc_lead_directory_crm after insert or update of product_id,stage,display_name on mc_lead_state for each row execute function mc_sync_lead_directory_crm();
-- Repair existing records without touching takeover, consent, messages, owner notes or terminal CRM decisions.
insert into mc_lead_state(chat_id,phone,display_name)select phone||'@c.us',phone,name from mc_campaign_contacts on conflict(chat_id)do update set display_name=excluded.display_name;
update mc_lead_state set product_id=product_id;
-- Include the actual learning material; exclude internal cost data from AI context.
create or replace function public.mc_sync_business_knowledge()returns trigger language plpgsql security definer set search_path=public as $$declare r jsonb;k text;s text;p jsonb;begin
 r=case when tg_op='DELETE'then to_jsonb(old)else to_jsonb(new)end;
 if tg_table_name='products'then k='PRODUCT';s=r->>'id';p=jsonb_build_object('product_id',s,'product_name',r->>'name','price',nullif(r->>'base_price','0'),'promo_price',nullif(r->>'promo_price','0'),'description',r->>'short_description','full_description',r->>'full_description','benefits',r->>'benefits','demo_url',r->>'demo_url','checkout_url',r->>'checkout_url','keywords',r->'keywords','status',r->>'status');else k='BOT_SETTING';s=r->>'key';p=jsonb_build_object('value',r->'value');end if;
 insert into mc_runtime_knowledge(kind,source_key,payload,active,synced_at)values(k,s,p,tg_op<>'DELETE'and(k<>'PRODUCT'or r->>'status'='ACTIVE'),now())on conflict(kind,source_key)do update set payload=excluded.payload,active=excluded.active,synced_at=now();
 return case when tg_op='DELETE'then old else new end;
end$$;
do $$begin if to_regclass('public.products')is not null then update products set updated_at=updated_at;end if;end$$;
revoke all on function mc_sync_contact_to_inbox(),mc_sync_lead_directory_crm()from public,anon,authenticated;
grant execute on function mc_sync_contact_to_inbox(),mc_sync_lead_directory_crm()to service_role;
create or replace function public.mc_campaign_opportunity_update(p_id uuid,p_stage text,p_note text,p_due timestamptz default null)returns void language plpgsql security definer set search_path=public as $$
declare oldrow mc_opportunities%rowtype;
begin
 if p_stage not in('NEW','INTERESTED','FOLLOW_UP','PENDING','AWAITING_PAYMENT','WON','LOST')then raise exception 'Tahap tidak valid';end if;
 select * into oldrow from mc_opportunities where id=p_id for update;
 if oldrow.id is null then raise exception 'Peluang tidak ditemukan';end if;
 update mc_opportunities set stage=p_stage,note=left(p_note,4000),next_followup_at=p_due,updated_at=now()where id=p_id;
 insert into mc_campaign_audit(campaign_id,action,detail)values(oldrow.campaign_id,'ADMIN_OPPORTUNITY_UPDATE',jsonb_build_object('actor','OWNER','opportunity_id',p_id,'previous_stage',oldrow.stage,'new_stage',p_stage));
end$$;
notify pgrst,'reload schema';
commit;
