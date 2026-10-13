-- My Control: repair login_mycontrol() failure caused by RETURNS TABLE(expires_at)
-- name colliding with app_sessions.expires_at inside PL/pgSQL.
-- Applied on 2026-10-13 to original My Control Supabase project.
-- Does not modify users, passwords, roles, sessions, or business data.
-- Existing private.login_mycontrol_impl, app_credentials, app_sessions and
-- pgcrypto in schema extensions are prerequisites (established previously).
BEGIN;
CREATE OR REPLACE FUNCTION private.login_mycontrol_impl(p_username text, p_password text)
 RETURNS TABLE(session_token text, role text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    declare
      c public.app_credentials%rowtype;
      new_token text;
      exp timestamptz;
      supplied_sha text;
    begin
      p_username := lower(trim(p_username));
      supplied_sha := encode(extensions.digest(p_password,'sha256'),'hex');

      select * into c
      from public.app_credentials
      where username=p_username and active=true;

      if c.username is null then
        raise exception 'Username atau password salah';
      end if;

      if c.password_hash like 'bootstrap-sha256:%' then
        if split_part(c.password_hash,':',2) <> supplied_sha then
          raise exception 'Username atau password salah';
        end if;

        update public.app_credentials
        set password_hash=extensions.crypt(p_password, extensions.gen_salt('bf',12)),
            updated_at=now()
        where username=p_username;

        select * into c
        from public.app_credentials
        where username=p_username and active=true;
      elsif c.password_hash <> extensions.crypt(p_password,c.password_hash) then
        raise exception 'Username atau password salah';
      end if;

      update public.app_sessions AS s
      set revoked_at=now()
      where s.username=p_username
        and s.revoked_at is null
        and s.expires_at <= now();

      new_token := encode(extensions.gen_random_bytes(32),'hex');
      exp := now() + interval '14 days';

      insert into public.app_sessions(username,token_hash,expires_at)
      values (
        p_username,
        encode(extensions.digest(new_token,'sha256'),'hex'),
        exp
      );

      return query select new_token,c.role,exp;
    end $function$;
COMMIT;
