-- My Control: prevent an invisible Word Joiner (U+2060) at the end of an
-- otherwise allowlisted campaign URL from canceling an entire Blash.
-- Preserve the existing exact URL allowlist and all other security gates.
-- Safe to reapply; aborts if the production trigger definition diverged.
DO $patch$
DECLARE
  v_definition text;
  v_old constant text := 'chr(8203)||chr(8204)||chr(8205)||chr(65279)';
  v_new constant text := 'chr(8203)||chr(8204)||chr(8205)||chr(65279)||chr(8288)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname = 'mc_prime_store_outbound_guard'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'My Control Prime Store outbound guard not found';
  END IF;

  IF position(v_new IN v_definition) = 0 THEN
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'My Control outbound guard differs: aborting unsafe patch';
    END IF;
    EXECUTE replace(v_definition, v_old, v_new);
  END IF;
END;
$patch$;
