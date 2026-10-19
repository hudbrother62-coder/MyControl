-- Fail-closed campaign safeguards for products changed after scheduling.
-- No campaign is started and no messages are sent by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.mc_campaign_preflight(p_job_id uuid, p_attempt integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j mc_outbound_jobs%rowtype;v_next timestamptz;
begin
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING' or j.attempt_count<>p_attempt then
  return jsonb_build_object('allowed',false,'reason','STALE_JOB');end if;
 -- Disable pending campaign messages when the referenced web product
 -- becomes INACTIVE or is removed, even after campaign scheduling.
 if j.campaign_id is not null and exists(
   select 1 from public.mc_campaigns c left join public.products p on p.id=c.product_id
   where c.id=j.campaign_id and c.product_id is not null
     and p.status is distinct from 'ACTIVE'
 ) then
   update public.mc_outbound_jobs
   set status='CANCELLED',locked_at=null,locked_by=null
   where id=j.id and status='PROCESSING';
   return jsonb_build_object('allowed',false,'reason','PRODUCT_INACTIVE');
 end if;
 if j.kind='AI_REPLY' then
  v_next:=mc_contact_next_send_time(j.chat_id,false);
  if v_next>now()+interval '1 second' then
   update mc_outbound_jobs set status='PENDING',next_retry_at=v_next,locked_at=null,locked_by=null
    where id=j.id;
   return jsonb_build_object('allowed',false,'reason','OUTSIDE_CONTACT_REPLY_WINDOW','next_allowed_at',v_next);
  end if;
 end if;
 return mc_campaign_preflight_before_contact_schedule(p_job_id,p_attempt);
end $function$
;
CREATE OR REPLACE FUNCTION public.mc_campaign_action(p_id uuid, p_action text, p_schedule timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_enabled boolean;v_is_test boolean;v_auto boolean;
begin
 if p_action in ('START','SCHEDULE','RESUME') then
  if exists(
    select 1 from public.mc_campaigns c left join public.products p on p.id=c.product_id
    where c.id=p_id and c.product_id is not null and p.status is distinct from 'ACTIVE'
  ) then
    raise exception 'Produk kampanye sudah tidak ACTIVE di katalog My Control; pengiriman diblokir';
  end if;
  select bot_enabled,is_test into v_enabled,v_is_test
  from public.mc_campaigns where id=p_id;
  if coalesce(v_enabled,false) and not coalesce(v_is_test,false) then
   select coalesce((value #>> '{}')::boolean,false) into v_auto
   from public.bot_settings where key='ai_auto_reply';
   if not public.mc_bot_enabled() or not coalesce(v_auto,false) then
    raise exception 'AI balasan belum aktif. Aktifkan Bot dan Auto Reply di My Control sebelum Blash dengan AI dimulai';
   end if;
  end if;
 end if;
 return public.mc_campaign_action_before_ai_reply_preflight(p_id,p_action,p_schedule);
end;
$function$
;
NOTIFY pgrst, 'reload schema';
COMMIT;
