begin;
alter function public.mc_get_ai_context(text,integer) rename to mc_get_ai_context_before_worker_guidance;
create function public.mc_get_ai_context(p_chat_id text,p_history_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public as $$
with result as(select mc_get_ai_context_before_worker_guidance(p_chat_id,p_history_limit) j)
select jsonb_set(j,'{lead_state}',
 coalesce(j->'lead_state','{}'::jsonb)||jsonb_build_object(
 'AUTO_INFERRED_CUSTOMER_INSIGHTS',mc_contact_auto_insights(p_chat_id),
 'ADAPTIVE_AI_STYLE_RULE',
 'Begin polite; infer tone and response detail from conversation; be natural, persuasive where appropriate, no fixed character cap. Avoid needless repetition. Do not invent price, package duration or proof of payment. Subscription/payment is confirmed only by owner-verified data.'),
 true)
from result
$$;
revoke all on function public.mc_get_ai_context_before_worker_guidance(text,integer),
 public.mc_get_ai_context(text,integer) from public,anon,authenticated;
grant execute on function public.mc_get_ai_context(text,integer) to service_role;
notify pgrst,'reload schema';
commit;