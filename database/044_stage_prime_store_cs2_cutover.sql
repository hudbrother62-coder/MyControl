-- Safe staging only. Do not enable CS2, change the old sender, or reset any chat/CRM history.
begin;
insert into public.bot_settings(key,value,updated_at) values
('prime_store_waha_cutover',jsonb_build_object(
 'brand','PRIME STORE','phase','PREPARED_WAITING_WORKING',
 'target_session','CS2','target_me_id','6283186750567@c.us',
 'target_lid','208770441470075@lid',
 'previous_session','session_01m51sr28e6ytwpjrgyk15aecr',
 'previous_me_id','6285167465305@c.us',
 'route_active',false,'owner_reported_status','STOPPED',
 'prepared_at',now(),
 'validation_required',jsonb_build_array('WAHA WORKING','exact me.id','verified matching LID when present','n8n inbound and outbound together','WAHA webhook for CS2','test inbound+AI+outbound with own number'))
 ,now())
on conflict(key) do update set value=excluded.value,updated_at=now();
commit;
