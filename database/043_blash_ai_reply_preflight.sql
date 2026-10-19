-- Prevent starting an AI-assisted Blash if automatic replies are globally disabled.
-- Keep test sends/manual-only campaigns operational; all prior delivery checks still run.
begin;
alter function public.mc_campaign_action(uuid,text,timestamptz)
rename to mc_campaign_action_before_ai_reply_preflight;
create function public.mc_campaign_action(
 p_id uuid,p_action text,p_schedule timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_enabled boolean;v_is_test boolean;v_auto boolean;
begin
 if p_action in ('START','SCHEDULE','RESUME') then
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
$$;
alter function public.mc_campaign_readiness(uuid)
rename to mc_campaign_readiness_before_ai_reply_preflight;
create function public.mc_campaign_readiness(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(public.mc_campaign_readiness_before_ai_reply_preflight(p_id),'{}'::jsonb) ||
 jsonb_build_object(
  'campaign_ai_enabled',coalesce((select bot_enabled from public.mc_campaigns where id=p_id),false),
  'ai_auto_reply_ready',public.mc_bot_enabled() and coalesce(
    (select (value #>> '{}')::boolean from public.bot_settings where key='ai_auto_reply'),false)
 );
$$;
revoke all on function public.mc_campaign_action_before_ai_reply_preflight(uuid,text,timestamptz),
 public.mc_campaign_action(uuid,text,timestamptz),
 public.mc_campaign_readiness_before_ai_reply_preflight(uuid),
 public.mc_campaign_readiness(uuid) from public,anon,authenticated;
grant execute on function public.mc_campaign_action(uuid,text,timestamptz),
 public.mc_campaign_readiness(uuid) to service_role;
notify pgrst,'reload schema';
commit;
