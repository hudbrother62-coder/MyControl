-- 061: Keep customer opt-out and owner blocking independent from internal
-- promotion settings. New Blash staging rows have consent=false on purpose;
-- campaign jobs must not be cancelled solely because of that setting.
-- Follow-up still requires its own consent. No campaign is started here.
CREATE OR REPLACE FUNCTION public.mc_campaign_preflight_exclusion_base(p_job_id uuid, p_attempt integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j mc_outbound_jobs%rowtype;v_ok boolean;
begin
 if not pg_try_advisory_xact_lock(hashtextextended((select chat_id from mc_outbound_jobs where id=p_job_id),0))then update mc_outbound_jobs set status='RETRY',next_retry_at=now()+interval '2 seconds',locked_at=null,locked_by=null where id=p_job_id and status='PROCESSING'and attempt_count=p_attempt;return jsonb_build_object('allowed',false);end if;
 select * into j from mc_outbound_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'PROCESSING'or j.attempt_count<>p_attempt then return jsonb_build_object('allowed',false);end if;
 if j.inbound_event_id is not null and j.kind in('AI_REPLY','FOLLOW_UP')and exists(select 1 from mc_inbound_events newer join mc_inbound_events original on original.id=j.inbound_event_id where newer.chat_id=j.chat_id and not newer.from_me and not newer.is_group and newer.received_at>original.received_at)then update mc_outbound_jobs set status='CANCELLED',locked_at=null,locked_by=null where id=j.id;return jsonb_build_object('allowed',false);end if;
 v_ok:=j.kind='MANUAL'or not exists(select 1 from mc_lead_state where chat_id=j.chat_id and human_takeover_until>now());
 if j.kind='CAMPAIGN'then
  v_ok:=v_ok and exists(select 1 from mc_campaigns where id=j.campaign_id and status='RUNNING')and exists(select 1 from mc_campaign_contacts where phone=split_part(j.chat_id,'@',1)and opted_out_at is null and not owner_promo_disabled)and not exists(select 1 from mc_campaign_recipients where id=j.recipient_id and replied_at is not null);
 else v_ok:=v_ok and(j.kind='MANUAL'or mc_bot_enabled());
  if j.kind='FOLLOW_UP' then v_ok:=v_ok and not exists(select 1 from mc_campaign_contacts where phone=split_part(j.chat_id,'@',1)and(not consent or opted_out_at is not null));end if;
 end if;
 if not v_ok then update mc_outbound_jobs set status=case when j.kind='CAMPAIGN'and exists(select 1 from mc_campaigns where id=j.campaign_id and status='PAUSED')then 'PENDING'else 'CANCELLED'end,locked_at=null,locked_by=null where id=j.id;end if;
 return jsonb_build_object('allowed',v_ok);
end$function$;

CREATE OR REPLACE FUNCTION public.mc_claim_outbound_v2(p_worker text DEFAULT 'n8n-v2'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j mc_outbound_jobs%rowtype;
begin
 perform mc_live_test_context();
 perform mc_recover_expired_jobs();
 update mc_outbound_jobs o set status='CANCELLED'where o.kind='CAMPAIGN'and o.status in('PENDING','RETRY')and exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status in('FAILED','CANCELLED')); 
 update mc_outbound_jobs o set status='CANCELLED'from mc_lead_state l where o.chat_id=l.chat_id and o.kind<>'MANUAL'and o.status in('PENDING','RETRY')and(l.human_takeover_until>now()or(l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')and o.kind in('CAMPAIGN','FOLLOW_UP')));
 update mc_outbound_jobs o set status='CANCELLED'from mc_campaign_contacts cc where o.kind in('CAMPAIGN','FOLLOW_UP')and o.chat_id=cc.phone||'@c.us'and o.status in('PENDING','RETRY')and(cc.opted_out_at is not null or cc.owner_promo_disabled
 or exists(select 1 from public.mc_contact_exclusions ex where ex.phone=cc.phone)
 or (o.kind='FOLLOW_UP' and not cc.consent));
 update mc_campaigns c set status='COMPLETED',updated_at=now()where c.status in('RUNNING','PAUSED')and exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id)and not exists(select 1 from mc_outbound_jobs o where o.campaign_id=c.id and o.status in('PENDING','RETRY','PROCESSING','UNKNOWN'));
 update mc_campaigns set status='RUNNING'where status='SCHEDULED'and scheduled_at<=now();
 select o.* into j from mc_outbound_jobs o left join mc_campaigns c on c.id=o.campaign_id
 where (o.kind in('MANUAL','CAMPAIGN') or mc_reply_allowed(o.chat_id)) and o.account_id=mc_active_account() and o.status in('PENDING','RETRY')and(o.next_retry_at is null or o.next_retry_at<=now())
 and (o.kind='MANUAL'or(o.kind<>'CAMPAIGN'and mc_bot_enabled())or(o.kind='CAMPAIGN'and c.status='RUNNING'))
 and not exists(select 1 from mc_outbound_jobs busy where busy.chat_id=o.chat_id and busy.status='PROCESSING')
 and (o.kind<>'CAMPAIGN'or not exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status<>'SENT'))
 order by case when o.kind='MANUAL'then 0 when o.kind='AI_REPLY'then 1 when o.kind='FOLLOW_UP'then 2 else 3 end,o.created_at
 for update of o skip locked limit 1;
 if j.id is null then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(j.chat_id,0))then return null;end if;
 if exists(select 1 from mc_outbound_jobs where chat_id=j.chat_id and status='PROCESSING')then return null;end if;
 update mc_outbound_jobs set status='PROCESSING',locked_at=now(),locked_by=p_worker,attempt_count=attempt_count+1 where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('job_id',j.id,'session_name',coalesce((select session_name from mc_campaigns where id=j.campaign_id),'default'));
end$function$;

