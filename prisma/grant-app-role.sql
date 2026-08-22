-- Creates (if missing) and grants the non-superuser app role that
-- APP_DATABASE_URL connects as. Postgres superusers unconditionally
-- bypass Row Level Security, so this role is what makes the RLS backstop
-- (prisma/migrations/20260821145450_enable_rls_backstop) actually apply —
-- see lib/db/prisma.ts and README.md's Authentication & authorization
-- section.
--
-- Idempotent and safe to re-run: `prisma migrate reset` recreates the
-- `public` schema from scratch, which drops this role's grants (not the
-- role itself) every time — this script is what DECISIONS.md's M1 entry
-- refers to as "redo the grant sequence," written down for the first time
-- here instead of living only in a prior interactive session. Run it
-- after every `prisma migrate dev`/`reset`/`deploy`.
--
-- Usage:
--   APP_DB_PASSWORD='<password>' psql "$DATABASE_URL" -f prisma/grant-app-role.sql
-- (`\getenv` reads the OS environment variable directly, deliberately
-- sidestepping psql's `-v name=value` command-line flag — a password
-- containing shell-special characters passed that way is one wrong shell
-- or one extra layer of quoting away from being silently mangled, which
-- is exactly what happened testing this script through git-bash calling
-- a native psql.exe on Windows: `-v` "succeeded" but set the wrong
-- password. An environment variable needs no such quoting.)
\getenv app_password APP_DB_PASSWORD

-- Postgres has no `CREATE ROLE ... IF NOT EXISTS`, and psql's `:'var'`
-- substitution is deliberately skipped inside `DO $$ ... $$` bodies (it
-- won't touch dollar-quoted text, to avoid corrupting literal code) — so
-- the conditional lives in a `\gexec`-generated statement instead, and
-- the password is set in a separate, unconditional ALTER below rather
-- than inside the CREATE itself.
SELECT 'CREATE ROLE webinar_app WITH LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'webinar_app')
\gexec

ALTER ROLE webinar_app WITH LOGIN PASSWORD :'app_password';

-- Broad table-level access; Row Level Security (enabled on 11 of these
-- tables) narrows SELECT/INSERT/UPDATE further per-row, and simply
-- defines no DELETE/UPDATE policy at all for some operations (e.g.
-- stock_movements has no UPDATE policy — the ledger is append-only) so
-- Postgres denies those commands outright for this role regardless of
-- the grant below. users/doctors/clinics/holding_companies have no RLS
-- policies (staff-directory access control is an app-layer concern, not
-- clinic-scoping — see DECISIONS.md's M1 entry), so the grant here is
-- their only gate.
GRANT USAGE ON SCHEMA public TO webinar_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO webinar_app;
