-- Test setup: the parts of a Supabase database that the migrations rely on,
-- for a plain PostgreSQL server (CI container or local cluster).
--
-- Safe to run more than once. Roles are cluster-wide, so they are created only
-- if missing.

-- Roles, with the attributes Supabase gives them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- Supabase grants every role full table access by default; Row Level Security
-- is what keeps tenants apart. Tables created later by the migrations get the
-- same grants through these default privileges.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- extensions: where Supabase installs extensions such as btree_gist.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- auth: the users table and the JWT helpers used by policies.
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  encrypted_password text,
  raw_user_meta_data jsonb,
  last_sign_in_at    timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
-- Databases created by older test setups have a shorter auth.users.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at    timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at         timestamptz DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS updated_at         timestamptz DEFAULT now();

-- Same bodies as Supabase: read the request's JWT claims.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- storage: buckets and objects (Supabase Storage keeps its metadata here).
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL UNIQUE,
  owner              uuid,
  public             boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        text REFERENCES storage.buckets (id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Realtime reads changes from this publication (created empty, as on Supabase).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- vault: secrets and the view that returns them decrypted. Here the secret is
-- stored as plain text.
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret      text NOT NULL,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret,
         key_id, nonce, created_at, updated_at
  FROM vault.secrets;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret      text,
  new_name        text DEFAULT NULL,
  new_description text DEFAULT '',
  new_key_id      uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql
AS $$
  INSERT INTO vault.secrets (secret, name, description, key_id)
  VALUES (new_secret, new_name, new_description, new_key_id)
  RETURNING id
$$;
