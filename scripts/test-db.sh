#!/usr/bin/env bash
#
# Database tests. Builds throwaway databases from supabase/migrations and runs
# the SQL files in tests/db against them.
#
#   1. Fresh build: Supabase stand-ins (tests/db/supabase_stub.sql), every
#      migration in order, test helpers and data, then every
#      tests/db/test_*.sql file.
#   2. Second pass: every migration again on the same database. The schema
#      snapshot must not change and the test files must still pass.
#   3. Live data: the baseline only, rows with the problems the live database
#      can have (tests/db/live_data), then the other migrations. None may fail
#      and each rule those rows block must be skipped. After the rows are
#      fixed, running the migrations again completes every rule.
#
# Connection settings come from the usual libpq variables (PGHOST, PGPORT,
# PGUSER, PGPASSWORD). The user must be allowed to create databases and roles
# (a superuser, as in CI), and the server needs PostgreSQL 15 or later with
# the btree_gist extension (part of contrib; the official image includes it).
#
#   TEST_DB=name   prefix for the databases it creates (default: noshowly_test)
#   KEEP_DB=1      keep the databases afterwards
#   VERBOSE=1      print the output of every file, not only of failed ones
#
# Prints PASS or FAIL for every file and exits with 1 if anything failed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS="$ROOT/tests/db"
MIGRATIONS=("$ROOT"/supabase/migrations/*.sql)
PREFIX="${TEST_DB:-noshowly_test}"
FRESH_DB="${PREFIX}_fresh"
LIVE_DB="${PREFIX}_live"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
FAILED=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# run LABEL DATABASE FILE: applies FILE and prints PASS or FAIL.
run() {
  local label=$1 db=$2 file=$3 out
  if out=$("${PSQL[@]}" -d "$db" -f "$file" 2>&1); then
    printf 'PASS  %-12s %s\n' "$label" "${file#"$ROOT"/}"
    if [ "${VERBOSE:-0}" = 1 ] && [ -n "$out" ]; then printf '%s\n' "$out" | sed 's/^/        /'; fi
    return 0
  fi
  printf 'FAIL  %-12s %s\n' "$label" "${file#"$ROOT"/}"
  printf '%s\n' "$out" | sed 's/^/        /'
  FAILED=$((FAILED + 1))
  return 1
}

# migrate LABEL DATABASE FILE...: applies migrations in order, stops at the
# first failure (the next ones depend on it).
migrate() {
  local label=$1 db=$2 file
  shift 2
  for file in "$@"; do
    run "$label" "$db" "$file" || return 1
  done
}

run_tests() {
  local label=$1 db=$2 file
  for file in "$TESTS"/test_*.sql; do
    run "$label" "$db" "$file"
  done
}

create_db() {
  PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$1\"" -c "CREATE DATABASE \"$1\"" >/dev/null
}

drop_db() {
  [ "${KEEP_DB:-0}" = 1 ] && return 0
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$1\"" >/dev/null
}

snapshot() {
  "${PSQL[@]}" -d "$1" -At -F ' | ' -f "$TESTS/schema_snapshot.sql" > "$2"
}

command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }
"${PSQL[@]}" -d postgres -c 'SELECT 1' >/dev/null || { echo "Cannot connect to PostgreSQL" >&2; exit 2; }

echo "== 1. Fresh build ($FRESH_DB)"
create_db "$FRESH_DB"
if run setup "$FRESH_DB" "$TESTS/supabase_stub.sql" \
   && migrate migration "$FRESH_DB" "${MIGRATIONS[@]}" \
   && run setup "$FRESH_DB" "$TESTS/helpers.sql" \
   && run setup "$FRESH_DB" "$TESTS/seed.sql"; then
  run_tests test "$FRESH_DB"

  echo "== 2. Every migration again on the same database"
  snapshot "$FRESH_DB" "$WORK/before.txt"
  if migrate migration "$FRESH_DB" "${MIGRATIONS[@]}"; then
    snapshot "$FRESH_DB" "$WORK/after.txt"
    if diff -u "$WORK/before.txt" "$WORK/after.txt" > "$WORK/snapshot.diff"; then
      printf 'PASS  %-12s %s\n' snapshot "schema and data unchanged by the second pass"
    else
      printf 'FAIL  %-12s %s\n' snapshot "the second pass changed the schema or data:"
      sed 's/^/        /' "$WORK/snapshot.diff"
      FAILED=$((FAILED + 1))
    fi
    run_tests test "$FRESH_DB"
  fi
fi
drop_db "$FRESH_DB"

echo "== 3. Migrations on a database with live data problems ($LIVE_DB)"
create_db "$LIVE_DB"
if run setup "$LIVE_DB" "$TESTS/supabase_stub.sql" \
   && migrate migration "$LIVE_DB" "${MIGRATIONS[0]}" \
   && run setup "$LIVE_DB" "$TESTS/helpers.sql" \
   && run setup "$LIVE_DB" "$TESTS/live_data/problem_rows.sql" \
   && migrate migration "$LIVE_DB" "${MIGRATIONS[@]:1}"; then
  run test "$LIVE_DB" "$TESTS/live_data/test_guards.sql"
  if run setup "$LIVE_DB" "$TESTS/live_data/fix_rows.sql" \
     && migrate migration "$LIVE_DB" "${MIGRATIONS[@]}"; then
    run test "$LIVE_DB" "$TESTS/live_data/test_fixed.sql"
  fi
fi
drop_db "$LIVE_DB"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED file(s) failed"
  exit 1
fi
echo "All database tests passed"
