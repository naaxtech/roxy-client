// node --test scripts/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSql, stripSql, checkMigrationSet } from '../check-migrations.mjs';

const rules = (sql) => lintSql(sql).filter((f) => !f.waived).map((f) => f.rule);

test('clean, well-formed migration has no findings', () => {
  const sql = `
    create table public.widgets (id uuid primary key, owner uuid not null);
    alter table public.widgets enable row level security;
    create policy widgets_read on public.widgets for select to authenticated using (owner = auth.uid());
    create or replace function public.f() returns void language plpgsql security definer set search_path = public as $$
    begin delete from public.widgets; end $$;
    grant select on public.widgets to authenticated;
  `;
  assert.deepEqual(rules(sql), []);
});

test('destructive statements are flagged', () => {
  assert.deepEqual(rules('drop table public.x;'), ['destructive']);
  assert.deepEqual(rules('alter table public.x drop column y;'), ['destructive']);
  assert.deepEqual(rules('alter table public.x drop column if exists y;'), ['destructive']);
  assert.deepEqual(rules('truncate public.x;'), ['destructive']);
  assert.deepEqual(rules('delete from public.x;'), ['destructive']);
  assert.deepEqual(rules('alter table public.x alter column y type bigint;'), ['destructive']);
  assert.deepEqual(rules('alter table public.x rename to z;'), ['destructive']);
  assert.deepEqual(rules('alter table public.x rename column a to b;'), ['destructive']);
});

test('non-destructive look-alikes are not flagged', () => {
  assert.deepEqual(rules('delete from public.x where id = 1;'), []);
  assert.deepEqual(rules('alter table public.x drop constraint x_pkey;'), []);
  assert.deepEqual(rules('alter table public.x alter column y drop default;'), []);
  assert.deepEqual(rules('alter table public.x alter column y drop not null;'), []);
  assert.deepEqual(rules('drop policy if exists p on public.x;'), []);
  assert.deepEqual(rules('drop function if exists public.f();'), []);
});

test('destructive-ok marker waives destructive rule', () => {
  assert.deepEqual(rules('-- destructive-ok: contract phase of 120, column unused since 2026-09\nalter table public.x drop column y;'), []);
  // marker without a reason does not count
  assert.deepEqual(rules('-- destructive-ok:\nalter table public.x drop column y;'), ['destructive']);
});

test('statements inside function bodies, strings and comments are ignored', () => {
  assert.deepEqual(stripSql("select 'drop table x'; -- drop table y\n/* truncate z */").includes('drop'), false);
  const sql = `create or replace function public.purge() returns void language sql security definer set search_path = '' as $fn$ delete from public.x; truncate public.y $fn$;`;
  assert.deepEqual(rules(sql), []);
});

test('CREATE TABLE in public without RLS is flagged; other schemas and quoted names handled', () => {
  assert.deepEqual(rules('create table public.a (id int);'), ['rls']);
  assert.deepEqual(rules('create table a (id int);'), ['rls']);
  assert.deepEqual(rules('create table if not exists "public"."A" (id int); alter table public."A" enable row level security;'), []);
  assert.deepEqual(rules('create table private.a (id int);'), []);
  assert.deepEqual(rules('create temp table t (id int);'), []);
});

test('CREATE POLICY without TO is flagged', () => {
  assert.deepEqual(rules('create policy p on public.x for select using (true);'), ['policy-to']);
  assert.deepEqual(rules('create policy "talk to mods" on public.x for select using (true);'), ['policy-to']);
  assert.deepEqual(rules('create policy p on public.x as restrictive for all to authenticated using (true) with check (true);'), []);
});

test('SECURITY DEFINER without search_path is flagged, separate ALTER FUNCTION satisfies it', () => {
  const bad = 'create function public.f() returns int language sql security definer as $$ select 1 $$;';
  assert.deepEqual(rules(bad), ['search-path']);
  assert.deepEqual(rules(bad + ' alter function public.f() set search_path = public;'), []);
  assert.deepEqual(rules('create function public.g() returns int language sql security invoker as $$ select 1 $$;'), []);
});

test('GRANT to anon is flagged', () => {
  assert.deepEqual(rules('grant execute on function public.f() to anon;'), ['anon-grant']);
  assert.deepEqual(rules('grant select on public.x to authenticated, anon;'), ['anon-grant']);
  assert.deepEqual(rules('revoke all on public.x from anon;'), []);
});

test('lint-ignore waiver requires a reason', () => {
  assert.deepEqual(rules('-- lint-ignore: anon-grant public landing counter, read-only\ngrant select on public.x to anon;'), []);
  assert.deepEqual(rules('-- lint-ignore: anon-grant\ngrant select on public.x to anon;'), ['anon-grant']);
});

// ── set-level ──────────────────────────────────────────────────────────────
const f = (name, sql = 'select 1;') => ({ name, sql });

test('old migrations produce warnings, new ones errors', () => {
  const r = checkMigrationSet({
    files: [f('100_old.sql', 'drop table public.x;'), f('129_new.sql', 'drop table public.y;')],
    downs: ['129_new_down.sql'],
    base: ['100_old.sql'],
    enforceAfter: 128,
  });
  assert.equal(r.find((x) => x.file === '100_old.sql').severity, 'warning');
  assert.equal(r.find((x) => x.file === '129_new.sql').severity, 'error');
});

test('duplicate numbers and bad names are errors', () => {
  const r = checkMigrationSet({
    files: [f('129_a.sql'), f('129_b.sql'), f('Bad-Name.sql')],
    downs: ['129_a_down.sql', '129_b_down.sql'],
    base: [],
  });
  assert.ok(r.some((x) => x.rule === 'duplicate' && x.severity === 'error'));
  assert.ok(r.some((x) => x.rule === 'naming' && x.severity === 'error'));
});

test('new migration must have a down file and be numbered above base', () => {
  const r = checkMigrationSet({
    files: [f('128_x.sql'), f('129_y.sql'), f('127_sneaky.sql')],
    downs: ['127_sneaky_down.sql'],
    base: ['128_x.sql'],
  });
  assert.ok(r.some((x) => x.file === '129_y.sql' && x.rule === 'down' && x.severity === 'error'));
  assert.ok(r.some((x) => x.file === '127_sneaky.sql' && x.rule === 'ordering' && x.severity === 'error'));
  assert.ok(!r.some((x) => x.file === '128_x.sql'));
});

test('without a base ref, numbers above the cutoff still need downs', () => {
  const r = checkMigrationSet({ files: [f('130_z.sql')], downs: [], base: null });
  assert.deepEqual(r.map((x) => [x.rule, x.severity]), [['down', 'error']]);
});
