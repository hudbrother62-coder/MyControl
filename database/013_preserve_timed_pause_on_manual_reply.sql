begin;
-- An owner replying during a timed per-contact pause must not silently change it to permanent.
-- Outside an active pause, the existing manual-send behavior (indefinite takeover) remains.
create or replace function public.mc_manual_send(p_chat_id text,p_body text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_existing_pause timestamptz;
begin
 if p_chat_id !~ '^[0-9]+@(c\.us|s\.whatsapp\.net|lid)$' or
    length(trim(p_body)) not between 1 and 4000 or
    length(p_request_id) not between 16 and 80 then
    raise exception 'Invalid manual message';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_chat_id,0));
 select human_takeover_until into v_existing_pause
 from mc_lead_state where chat_id=p_chat_id for update;
 if v_existing_pause is null or v_existing_pause<=now() then
   perform mc_control_takeover(p_chat_id,true);
 end if;
 insert into mc_outbound_jobs(chat_id,body,kind,idempotency_key)
 values(p_chat_id,p_body,'MANUAL','manual:'||p_request_id)
 on conflict(idempotency_key) do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from mc_outbound_jobs
   where idempotency_key='manual:'||p_request_id
   and chat_id=p_chat_id and body=p_body;
   if v_id is null then raise exception 'Idempotency key conflict'; end if;
 end if;
 return jsonb_build_object('ok',true,'outbound_job_id',v_id,'status','QUEUED');
end $$;
revoke all on function public.mc_manual_send(text,text,text) from public,anon,authenticated;
grant execute on function public.mc_manual_send(text,text,text) to service_role;
notify pgrst,'reload schema';
commit;