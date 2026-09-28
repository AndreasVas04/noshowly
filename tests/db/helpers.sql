-- Test helpers, in their own schema. Loaded after the migrations.
--
-- tests.id('salon_a') gives the fixed uuid of a seeded row, so test files can
-- refer to rows by name. The sign-in helpers switch the rest of the current
-- transaction to a Supabase role, the way PostgREST does for each request.

CREATE SCHEMA IF NOT EXISTS tests;
GRANT USAGE ON SCHEMA tests TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION tests.id(p_name text) RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$ SELECT md5(p_name)::uuid $$;

-- Back to the database user the tests connect as.
CREATE OR REPLACE FUNCTION tests.sign_out() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- A signed-in owner: role authenticated, user id in the JWT claims.
CREATE OR REPLACE FUNCTION tests.sign_in(p_name text) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM tests.sign_out();
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', tests.id(p_name), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

-- An anonymous visitor (anon key, no session).
CREATE OR REPLACE FUNCTION tests.as_anon() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM tests.sign_out();
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  PERFORM set_config('role', 'anon', true);
END;
$$;

-- The server with the service-role key.
CREATE OR REPLACE FUNCTION tests.as_service_role() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM tests.sign_out();
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END;
$$;

-- Runs p_sql and fails unless it raises the error p_sqlstate.
CREATE OR REPLACE FUNCTION tests.expect_error(p_what text, p_sqlstate text, p_sql text) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE = p_sqlstate THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'FAILED: %: expected error %, got %: %', p_what, p_sqlstate, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAILED: %: expected error %, but it succeeded', p_what, p_sqlstate;
END;
$$;

-- Runs p_sql and fails if it raises an error. Returns the number of rows it
-- inserted, updated or deleted.
CREATE OR REPLACE FUNCTION tests.expect_ok(p_what text, p_sql text) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'FAILED: %: unexpected error %: %', p_what, SQLSTATE, SQLERRM;
END;
$$;

-- Runs p_sql (a statement that changes rows) and fails unless it changes
-- exactly p_expected rows.
CREATE OR REPLACE FUNCTION tests.expect_changed(p_what text, p_expected bigint, p_sql text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows bigint := tests.expect_ok(p_what, p_sql);
BEGIN
  IF v_rows <> p_expected THEN
    RAISE EXCEPTION 'FAILED: %: expected % changed row(s), got %', p_what, p_expected, v_rows;
  END IF;
END;
$$;

-- Fails unless the query returns exactly p_expected rows.
CREATE OR REPLACE FUNCTION tests.expect_rows(p_what text, p_expected bigint, p_query text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM (%s) q', p_query) INTO v_rows;
  IF v_rows <> p_expected THEN
    RAISE EXCEPTION 'FAILED: %: expected % row(s), got %', p_what, p_expected, v_rows;
  END IF;
EXCEPTION
  WHEN raise_exception THEN
    RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'FAILED: %: unexpected error %: %', p_what, SQLSTATE, SQLERRM;
END;
$$;

-- Fails unless p_condition is true.
CREATE OR REPLACE FUNCTION tests.expect(p_what text, p_condition boolean) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: %', p_what;
  END IF;
END;
$$;
