#!/usr/bin/env bash
# Prove every migration applies from zero and every supabase/tests/*.sql check passes,
# against a DISPOSABLE local Postgres. Used by the CI `database` job and locally:
#
#   bash scripts/db-verify.sh            # from repo root
#
# Never touches a remote project: it only uses `supabase db start` / `db reset --local`
# and `docker exec` into the local db container.
#
# Staging copy: supabase/ is copied to a temp dir with CRLF -> LF normalised. On a
# Windows checkout with core.autocrlf=true the CLI's statement splitter rejects
# `DO $$\r\nDECLARE` (SQLSTATE 42601) — git's index is LF, so CI never saw it, but
# local runs did. Staging makes local == CI.
#
# Isolation: the staged config gets its own project_id ("<id>-verify") and ports
# (544xx instead of 543xx), so this NEVER touches the developer's own local stack
# (`supabase start` from the repo root) or another agent's — they can run side by side.
# If a verify container is already running (a previous run that was interrupted) it is
# reused and left running; the script only stops what it started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE="${SUPABASE_CLI:-npx --yes supabase@2.99.0}"
BASE_ID="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$ROOT/supabase/config.toml" | head -1)"
PROJECT_ID="${BASE_ID}-verify"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/roxy-db-verify.XXXXXX")"
mkdir -p "$STAGE/supabase"
for item in config.toml seed.sql migrations tests; do
  cp -r "$ROOT/supabase/$item" "$STAGE/supabase/"
done
# Native Windows CLIs (git-bash) cannot resolve MSYS paths like /tmp/...; hand them a C:/ path.
if command -v cygpath >/dev/null 2>&1; then STAGE="$(cygpath -m "$STAGE")"; fi
find "$STAGE/supabase" -type f \( -name '*.sql' -o -name '*.toml' \) -exec sed -i 's/\r$//' {} +
# Own project id + shift every 543xx port to 544xx (db 54322 -> 54422, shadow, pooler...).
sed -i -e "s/^project_id *= *\".*\"/project_id = \"${PROJECT_ID}\"/" \
       -e 's/\b543\([0-9][0-9]\)\b/544\1/g' "$STAGE/supabase/config.toml"
# Pin the Postgres image to production's. A fresh stage has no .temp, so the CLI
# would pull its own default image; supabase/postgres 17.6.1.106 segfaults
# (signal 11) on any "permission denied for function", which every grant check
# here exercises. Order: ROXY_PG_VERSION, then the linked project's recorded
# version (supabase/.temp/postgres-version, written by `supabase link`), then
# production's version as of 2026-10-11.
PG_VERSION="${ROXY_PG_VERSION:-}"
if [ -z "$PG_VERSION" ] && [ -f "$ROOT/supabase/.temp/postgres-version" ]; then
  PG_VERSION="$(tr -d '[:space:]' < "$ROOT/supabase/.temp/postgres-version")"
fi
PG_VERSION="${PG_VERSION:-17.6.1.084}"
mkdir -p "$STAGE/supabase/.temp"
printf '%s' "$PG_VERSION" > "$STAGE/supabase/.temp/postgres-version"
echo "postgres image: supabase/postgres:${PG_VERSION}"

started_here=0
cleanup() {
  if [ "$started_here" = 1 ]; then
    echo "::group::stopping local stack (started by this script)"
    $SUPABASE stop --workdir "$STAGE" --no-backup || true
    echo "::endgroup::"
  else
    echo "local stack was already running before this script — leaving it up"
  fi
  rm -rf "$STAGE"
}
trap cleanup EXIT

if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "reusing already-running verify container $DB_CONTAINER (will leave it running)"
else
  echo "::group::supabase db start (Postgres only)"
  started_here=1
  $SUPABASE db start --workdir "$STAGE"
  echo "::endgroup::"
fi

# A fresh `db start` already applies every migration from zero + seed. Only a reused
# container needs an explicit reset to get back to zero.
if [ "$started_here" = 0 ]; then
  echo "::group::supabase db reset --local (all migrations from zero + seed)"
  $SUPABASE db reset --local --workdir "$STAGE"
  echo "::endgroup::"
fi

applied=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations")
expected=$(ls "$STAGE/supabase/migrations"/*.sql | wc -l)
echo "migrations recorded: $applied / files: $expected"
if [ "$applied" -ne "$expected" ]; then
  echo "migration count mismatch" >&2
  exit 1
fi

fail=0
shopt -s nullglob
tests=("$STAGE"/supabase/tests/*.sql)
if [ ${#tests[@]} -eq 0 ]; then echo "no supabase/tests/*.sql found" >&2; exit 1; fi
for t in "${tests[@]}"; do
  name="$(basename "$t")"
  echo "::group::$name"
  # ON_ERROR_STOP makes any RAISE EXCEPTION / SQL error a non-zero exit.
  # A check that manages its own transaction (a top-level BEGIN;) runs as is.
  # Every other check is written to run inside ONE transaction that is rolled
  # back (migration-proof.cjs does exactly that): its SET LOCAL ROLE, its
  # set_config(..., true) JWT claims and its fixtures only live for that
  # transaction. Run raw, each statement autocommits, so the role and claims
  # are gone by the next statement and fixtures leak into the next check.
  if grep -qiE '^[[:space:]]*BEGIN[[:space:]]*;' "$t"; then
    run_check() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X < "$t"; }
  else
    run_check() { { echo 'BEGIN;'; cat "$t"; printf '\nROLLBACK;\n'; } \
      | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X; }
  fi
  if run_check; then
    echo "PASS $name"
  else
    echo "FAIL $name"
    echo "::error title=SQL check failed::$name"
    fail=1
  fi
  echo "::endgroup::"
done

if [ "$fail" = 0 ]; then
  echo "all ${#tests[@]} SQL checks passed"
  # Attest the exact migration contents that passed (apply-migration.mjs gate 3).
  # Skipped in CI: the ledger is a per-machine file under supabase/.temp.
  if [ -z "${CI:-}" ]; then
    # Native node on Windows cannot resolve an MSYS path (/d/Work/...).
    PROOF_SCRIPT="$ROOT/scripts/record-local-proof.mjs"
    if command -v cygpath >/dev/null 2>&1; then PROOF_SCRIPT="$(cygpath -m "$PROOF_SCRIPT")"; fi
    node "$PROOF_SCRIPT"
  fi
fi
exit "$fail"
