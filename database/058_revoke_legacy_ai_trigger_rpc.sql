-- 058: Legacy trigger function is not an HTTP RPC.
--
-- The trigger remains SECURITY DEFINER because it updates legacy records when
-- its owning table fires it, but it must never be callable through PostgREST.
-- Revoke the implicit PUBLIC grant and the browser roles. The queue workers do
-- not call this function; they use the mc_* RPC contract under service_role.
REVOKE ALL ON FUNCTION public.apply_ai_decision_from_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_ai_decision_from_message() FROM anon;
REVOKE ALL ON FUNCTION public.apply_ai_decision_from_message() FROM authenticated;
