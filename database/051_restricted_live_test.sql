-- Expiring owner-only live test. Global controls remain OFF until verification.
BEGIN;
ALTER FUNCTION mc_bot_enabled() RENAME TO mc_bot_enabled_before_live_test;
CREATE FUNCTION public.mc_live_test_allowed(p_chat text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT value->>'enabled'='true' AND (value->>'expires_at')::timestamptz>now()
  AND coalesce(value->'chat_ids','[]'::jsonb) ? p_chat FROM bot_settings WHERE key='prime_store_live_test'),false)
$$;
CREATE FUNCTION public.mc_reply_allowed(p_chat text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT mc_bot_enabled_before_live_test() OR mc_live_test_allowed(p_chat)
$$;
CREATE FUNCTION public.mc_bot_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT mc_bot_enabled_before_live_test() OR mc_live_test_allowed(current_setting('mycontrol.live_test_chat',true))
$$;
CREATE FUNCTION public.mc_live_test_context(p_chat text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target text:=p_chat;
BEGIN
 IF target IS NULL THEN SELECT value->'chat_ids'->>0 INTO target FROM bot_settings WHERE key='prime_store_live_test'; END IF;
 PERFORM set_config('mycontrol.live_test_chat',CASE WHEN mc_live_test_allowed(target) THEN target ELSE '' END,true);
END $$;
ALTER FUNCTION mc_ingest_whatsapp(text,text,text,text,text,boolean,boolean,jsonb) RENAME TO mc_ingest_whatsapp_before_live_test;
CREATE FUNCTION public.mc_ingest_whatsapp(p_external_message_id text,p_event_type text,p_chat_id text,p_phone text,p_message_text text,p_from_me boolean,p_is_group boolean,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM mc_live_test_context(p_chat_id);
 RETURN mc_ingest_whatsapp_before_live_test(p_external_message_id,p_event_type,p_chat_id,p_phone,p_message_text,p_from_me,p_is_group,p_payload);
END $$;
ALTER FUNCTION mc_commit_claimed_ai_job(uuid,jsonb,text,smallint,text,text,integer) RENAME TO mc_commit_claimed_ai_job_before_live_test;
CREATE FUNCTION public.mc_commit_claimed_ai_job(p_job_id uuid,p_decision jsonb,p_model_used text,p_slot_used smallint,p_chat_id text,p_reply text,p_claim_attempt integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM mc_live_test_context(p_chat_id);
 RETURN mc_commit_claimed_ai_job_before_live_test(p_job_id,p_decision,p_model_used,p_slot_used,p_chat_id,p_reply,p_claim_attempt);
END $$;
ALTER FUNCTION mc_campaign_preflight(uuid,integer) RENAME TO mc_campaign_preflight_before_live_test;
CREATE FUNCTION public.mc_campaign_preflight(p_job_id uuid,p_attempt integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j mc_outbound_jobs%rowtype;
BEGIN
 SELECT * INTO j FROM mc_outbound_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.status<>'PROCESSING' OR j.attempt_count<>p_attempt THEN RETURN jsonb_build_object('allowed',false,'reason','STALE_JOB');END IF;
 PERFORM mc_live_test_context(j.chat_id);
 IF j.kind IN('AI_REPLY','FOLLOW_UP') AND NOT mc_reply_allowed(j.chat_id) THEN
  UPDATE mc_outbound_jobs SET status='CANCELLED',last_error='AUTOMATION_PAUSED',locked_at=NULL,locked_by=NULL WHERE id=j.id;
  RETURN jsonb_build_object('allowed',false,'reason','AUTOMATION_PAUSED');
 END IF;
 RETURN mc_campaign_preflight_before_live_test(p_job_id,p_attempt);
END $$;
CREATE OR REPLACE FUNCTION public.mc_claim_ai_job(p_worker text DEFAULT 'n8n')
RETURNS TABLE(job_id uuid,inbound_event_id uuid,job_kind text,attempt_count integer,requested_model text,chat_id text,message_text text,external_message_id text,inbound_payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE chosen uuid;v_chat text;ids uuid[];jobs uuid[];
BEGIN
 PERFORM mc_live_test_context();
 IF NOT mc_bot_enabled() THEN RETURN; END IF;
 SELECT j.id,e.chat_id INTO chosen,v_chat FROM mc_ai_jobs j
 JOIN mc_inbound_events e ON e.id=j.inbound_event_id JOIN mc_lead_state l ON l.chat_id=e.chat_id
 WHERE j.status IN('PENDING','RETRY') AND (j.next_retry_at IS NULL OR j.next_retry_at<=now())
 AND e.account_id=mc_active_account() AND l.account_id=e.account_id AND mc_reply_allowed(e.chat_id)
 AND (l.human_takeover_until IS NULL OR l.human_takeover_until<=now())
 AND NOT EXISTS(SELECT 1 FROM mc_ai_jobs busy JOIN mc_inbound_events be ON be.id=busy.inbound_event_id
  WHERE be.chat_id=e.chat_id AND busy.status='PROCESSING')
 AND NOT EXISTS(SELECT 1 FROM mc_ai_jobs newer JOIN mc_inbound_events ne ON ne.id=newer.inbound_event_id
  WHERE ne.chat_id=e.chat_id AND ne.account_id=e.account_id AND newer.status IN('PENDING','RETRY')
  AND (ne.received_at,ne.id)>(e.received_at,e.id))
 AND (e.received_at<=clock_timestamp()-interval '1200 milliseconds' OR
  EXISTS(SELECT 1 FROM mc_ai_jobs first_job JOIN mc_inbound_events fe ON fe.id=first_job.inbound_event_id
   WHERE fe.chat_id=e.chat_id AND fe.account_id=e.account_id AND first_job.status='PENDING'
   AND first_job.created_at<=clock_timestamp()-interval '8 seconds'))
 AND pg_try_advisory_xact_lock(hashtextextended(e.chat_id,0))
 ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF chosen IS NULL THEN RETURN; END IF;
 -- Recheck after locking: concurrent pollers cannot both claim the same contact.
 IF EXISTS(SELECT 1 FROM mc_ai_jobs b JOIN mc_inbound_events be ON be.id=b.inbound_event_id
  WHERE be.chat_id=v_chat AND b.status='PROCESSING') THEN RETURN; END IF;
 SELECT array_agg(j.id) INTO jobs FROM mc_ai_jobs j JOIN mc_inbound_events e ON e.id=j.inbound_event_id
 WHERE e.chat_id=v_chat AND e.account_id=mc_active_account() AND j.status IN('PENDING','RETRY')
 AND (j.next_retry_at IS NULL OR j.next_retry_at<=now());
 SELECT array_agg(DISTINCT event_id) INTO ids FROM (
  SELECT j.inbound_event_id event_id FROM mc_ai_jobs j WHERE j.id=ANY(jobs)
  UNION SELECT unnest(j.batch_event_ids) FROM mc_ai_jobs j WHERE j.id=ANY(jobs)
 ) batch;
 UPDATE mc_ai_jobs j SET status='DONE',processed_at=now(),last_error='COALESCED_INTO:'||chosen,
  locked_at=NULL,locked_by=NULL WHERE j.id=ANY(jobs) AND j.id<>chosen;
 UPDATE mc_ai_jobs j SET status='PROCESSING',locked_at=now(),locked_by=p_worker,
  attempt_count=j.attempt_count+1,batch_event_ids=ids WHERE j.id=chosen;
 RETURN QUERY SELECT j.id,j.inbound_event_id,j.job_kind,j.attempt_count,j.requested_model,
  e.chat_id,(SELECT string_agg(b.message_text,E'\n' ORDER BY b.received_at,b.id) FROM mc_inbound_events b WHERE b.id=ANY(ids)),
  e.external_message_id,e.payload||jsonb_build_object('batch_count',cardinality(ids),'account_id',e.account_id)
 FROM mc_ai_jobs j JOIN mc_inbound_events e ON e.id=j.inbound_event_id WHERE j.id=chosen;
END $$;

create or replace function public.mc_claim_outbound_v2(p_worker text default 'n8n-v2')returns jsonb language plpgsql security definer set search_path=public as $$
declare j mc_outbound_jobs%rowtype;
begin
 perform mc_live_test_context();
 perform mc_recover_expired_jobs();
 update mc_outbound_jobs o set status='CANCELLED'where o.kind='CAMPAIGN'and o.status in('PENDING','RETRY')and exists(select 1 from mc_outbound_jobs prev where prev.recipient_id=o.recipient_id and prev.step_no<o.step_no and prev.status in('FAILED','CANCELLED')); 
 update mc_outbound_jobs o set status='CANCELLED'from mc_lead_state l where o.chat_id=l.chat_id and o.kind<>'MANUAL'and o.status in('PENDING','RETRY')and(l.human_takeover_until>now()or(l.stage in('WON','LOST','DO_NOT_CONTACT','HUMAN_HANDOFF')and o.kind in('CAMPAIGN','FOLLOW_UP')));
 update mc_outbound_jobs o set status='CANCELLED'from mc_campaign_contacts cc where o.kind in('CAMPAIGN','FOLLOW_UP')and o.chat_id=cc.phone||'@c.us'and o.status in('PENDING','RETRY')and(not cc.consent or cc.opted_out_at is not null);
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
end$$;
DO $$DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname IN('mc_live_test_allowed','mc_live_test_context','mc_reply_allowed','mc_bot_enabled','mc_claim_ai_job','mc_claim_outbound_v2','mc_ingest_whatsapp','mc_commit_claimed_ai_job','mc_campaign_preflight') OR p.proname LIKE '%before_live_test') LOOP
 EXECUTE format('revoke all on function %s from public,anon,authenticated',f.sig);
 EXECUTE format('grant execute on function %s to service_role',f.sig);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
