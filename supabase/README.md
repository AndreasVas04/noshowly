# Database

The schema is defined by the migrations in `supabase/migrations`, in Supabase
CLI format (`<timestamp>_<name>.sql`). They are applied in filename order.
Each file runs in a single transaction and is safe to run again.

| File | What it does |
|---|---|
| `20260609000000_baseline.sql` | The schema before the September 2026 changes: every table, index and policy that the old `schema.sql` and `add_*.sql` files created, merged into one file. |
| `20260609000100_platform_setup.sql` | What the dashboard used to set up: the public `staff-photos` Storage bucket, Realtime for `appointments`, and a pg_cron job that calls `POST /api/cron/send-reminders` every 15 minutes (URL and secret come from Vault). Skips anything that already exists. |
| `20260928120000_security_hardening.sql` | Row Level Security fixes: owners cannot write billing fields, no public inserts, public reads limited to bookable salons, demo account password and email locked. |
| `20260928130000_data_integrity.sql` | CHECK constraints, same-salon foreign keys (replacing the single-column ones, so PostgREST embeds still find one relationship), no double booking, one salon per owner, unique slugs and Stripe customers, indexes, faster owner policies, and removes unused tables and columns. |
| `20260928140000_private_booking_reads.sql` | Removes anonymous read access to every table. **Apply only after the release in which the public booking page reads through the server with the service-role key.** |
| `20260928150000_reminders_exactly_once.sql` | At most one pending or sent 24-hour reminder per appointment. **Apply only after the reminders release** (the cron sends the queued reminder instead of inserting a second row, and test sends use the type `email_test`). |
| `20260929120000_read_only_accounts.sql` | Read-only accounts in the database, not only in the dashboard API: when the trial has ended or the subscription is inactive, the owner can still read everything and edit the salon's settings, but cannot change anything else, also not straight through the Supabase API (`public.owner_has_write_access()`, the same rule as `lib/entitlements.ts`). Owners no longer write reminders or create salons themselves; the server does, with the service-role key. **Apply only after the billing release** (the one with the free trial and read-only accounts). |
| `20260929130000_demo_reset.sql` | Nightly reset of the public demo account: `public.take_demo_snapshot()` stores a copy of the demo salon in the `private` schema, and `public.reset_demo_data()` puts it back every night at 01:30 UTC (pg_cron job `noshowly-reset-demo`), with the appointments moved to the same days relative to today. It also keeps the demo account on the Basic plan, so it never becomes read-only. Only the service role and the database owner can run either function. |
| `20260929140000_rls_auto_enable_grants.sql` | With "Enable automatic RLS" on, Supabase adds `public.rls_auto_enable()`, the function of its `ensure_rls` event trigger, executable through the API by anyone. This file revokes that from `anon` and `authenticated` (Security Advisor lints 0028 and 0029). The event trigger keeps working. Does nothing on a project without the function. |

The migrations need PostgreSQL 15 or later (every Supabase project has it).

## New database

- Local development: `supabase init` (once, creates `config.toml`), then
  `supabase start`. `supabase db reset` rebuilds the local database from the
  migrations.
- New hosted project: `supabase link --project-ref <ref>`, then
  `supabase db push`. Or paste each file into the SQL Editor, in order.

For the reminder job, add the two Vault secrets it reads, then run
`20260609000100_platform_setup.sql` again (SQL Editor):

```sql
SELECT vault.create_secret('https://your-app.example.com', 'app_url');
SELECT vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
```

## Existing project

A project built with the old files already has everything in the baseline.
Apply only the files it has not had yet, in order.

**SQL Editor.** Paste each file and run it. The SQL Editor does not show
notices, so `platform_setup`, `data_integrity`, `reminders_exactly_once` and
`read_only_accounts` end with a result table listing what each step did. In `data_integrity`, rows
with a `rows_to_fix` query come first: a rule that existing rows break was
added but is not validated yet (or, for unique rules and double booking, not
added). Run the query, fix those rows, and run the file again.

**Supabase CLI.** Link the project and record the files it already has, then
push the rest:

```sh
supabase link --project-ref <ref>
supabase migration repair --status applied 20260609000000 20260609000100
# also 20260928120000 if security_hardening was already run in the SQL Editor
supabase db push --dry-run
supabase db push
```

`db push` applies every file that is not recorded yet, including the ones that
wait for a release. Until those releases are live, run the other files in the
SQL Editor and record each one with `supabase migration repair --status
applied <version>`.

Running `data_integrity` again puts the owner policies that
`read_only_accounts` replaces back, so run `read_only_accounts` again after it.

### The live project

Every file above is applied on the live project and recorded in
`supabase_migrations.schema_migrations`, so `supabase db push` only applies
files added later. How it got there, for reference:

- It was built with the old hand-run files, so the baseline was recorded
  without running it.
- The dashboard had created the Storage bucket and a cron job with the cron
  secret written into its command, but had not enabled Realtime. On
  29 September 2026 the secret moved to Vault (`app_url`, `cron_secret`), the
  old job was unscheduled, and `platform_setup` created
  `noshowly-send-reminders` and enabled Realtime for `appointments`.
- The other files ran in order the same day. Existing rows needed one fix: two
  overlapping appointments in a test salon, one of which was cancelled. The
  reminders file marked 29 pending reminders of past or cancelled appointments
  as skipped.
- `users.email_reminders_used_this_month` had been created without
  `NOT NULL`; it was added, as in the baseline.
- The demo's sample data was replaced with fictitious clients (`example.com`
  addresses, phone numbers from a range reserved for fiction) and moved to
  that week, and the demo snapshot was taken.

What the advisors still report, and why it stays:

- Security: `owner_has_write_access()` is executable by signed-in users. The
  Row Level Security policies call it, and it only answers for the caller's
  own account. Leaked password protection is off: Supabase offers it on the
  Pro plan.
- Performance: the same-salon foreign keys are listed as unindexed. Their
  first column (`barber_id`, `client_id`, `service_id`) is indexed, which is
  what lookups and cascades use.

## The demo account

Anyone can sign in to the public demo account (`demo@noshowly.com`, see
`lib/demo.ts`) and change it, so it is put back to a snapshot every night at
01:30 UTC. To change what visitors see, sign in as the demo account, set it up
the way it should look, and take a new snapshot in the SQL Editor:

```sql
SELECT public.take_demo_snapshot();
```

The appointments keep their place relative to the day of the snapshot: one
that was tomorrow is always tomorrow. To reset the demo right away:

```sql
SELECT public.reset_demo_data();
```

Until there is a snapshot, the nightly job only keeps the account on the Basic
plan. The job's last runs:

```sql
SELECT d.start_time, d.status, d.return_message
FROM cron.job_run_details d JOIN cron.job j USING (jobid)
WHERE j.jobname = 'noshowly-reset-demo'
ORDER BY d.start_time DESC LIMIT 5;
```

## Tests

`scripts/test-db.sh` builds throwaway databases from the migrations and runs
the SQL checks in `tests/db` (Row Level Security, tenant isolation, read-only
accounts, constraints, double booking, reminders, the demo account, function
grants, idempotency, and a run over rows with the problems the live data can
have). It needs `psql` and
a PostgreSQL 15+ server with the `btree_gist` extension (part of contrib, so
the official Docker image has it), reached through the usual `PGHOST`,
`PGPORT`, `PGUSER` and `PGPASSWORD` variables:

```sh
docker run -d --name noshowly-db-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres scripts/test-db.sh
```

`tests/db/supabase_stub.sql` stands in for the Supabase parts (roles, `auth`,
`storage`, Vault, the Realtime publication). GitHub Actions runs the same
script on every push and pull request (`.github/workflows/db-tests.yml`).
