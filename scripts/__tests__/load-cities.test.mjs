// node --test scripts/__tests__/load-cities.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  scramClientFinal,
  parseGeonamesLine,
  parseGeonames,
  parseAdmin1,
  sqlText,
  buildUpsert,
  parseDatabaseUrl,
  checkTarget,
  authAllowed,
  PgClient,
} from '../load-cities.mjs';

// A real cities15000.txt row (Parañaque), tab-separated, 19 columns.
const PARANAQUE = [
  '1694759', 'Parañaque City', 'Paranaque City', 'Paranaque,Parañaque', '14.4793', '121.0198',
  'P', 'PPLA2', 'PH', '', '00', '', '', '', '665822', '', '15', 'Asia/Manila', '2017-12-13',
].join('\t');

test('SCRAM-SHA-256 client proof matches the RFC 7677 test vector', () => {
  const { clientFinal, serverSignature } = scramClientFinal({
    password: 'pencil',
    clientFirstBare: 'n=user,r=rOprNGfwEbeRWgbNEkqO',
    serverFirst: 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  });
  assert.equal(clientFinal,
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
  assert.equal(serverSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
});

test('SCRAM refuses a server nonce that does not extend ours', () => {
  assert.throws(() => scramClientFinal({
    password: 'pencil',
    clientFirstBare: 'n=,r=abc',
    serverFirst: 'r=evil,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  }), /nonce/);
});

test('parses the columns it uses and resolves the region name', () => {
  const admin1 = parseAdmin1('PH.00\tMetro Manila\tMetro Manila\t7521311\nPH.01\tIlocos\tIlocos\t1\n');
  const r = parseGeonamesLine(PARANAQUE, admin1);
  assert.deepEqual(r, {
    row: {
      id: 1694759, name: 'Parañaque City', ascii_name: 'Paranaque City', admin1: 'Metro Manila',
      country_code: 'PH', lat: '14.4793', lng: '121.0198', population: 665822,
    },
  });
});

test('keeps the admin1 code when no region file was given, and none when blank', () => {
  assert.equal(parseGeonamesLine(PARANAQUE, new Map()).row.admin1, '00');
  const blank = PARANAQUE.split('\t'); blank[10] = '';
  assert.equal(parseGeonamesLine(blank.join('\t'), new Map()).row.admin1, null);
});

test('an empty ascii name falls back to the name', () => {
  const f = PARANAQUE.split('\t'); f[2] = '';
  assert.equal(parseGeonamesLine(f.join('\t'), new Map()).row.ascii_name, 'Parañaque City');
});

test('refuses rows that are not what the table accepts (the file is untrusted)', () => {
  const bad = (i, v) => { const f = PARANAQUE.split('\t'); f[i] = v; return parseGeonamesLine(f.join('\t'), new Map()); };
  assert.equal(bad(0, '12x').reason, 'id');
  assert.equal(bad(0, '0').reason, 'id');
  assert.equal(bad(0, '9999999999').reason, 'id');
  assert.equal(bad(1, '').reason, 'name');
  assert.equal(bad(1, 'Evil\u0007Town').reason, 'name');
  assert.equal(bad(1, 'x'.repeat(201)).reason, 'name');
  assert.equal(bad(4, '91').reason, 'lat');
  assert.equal(bad(4, '1e3').reason, 'lat');
  assert.equal(bad(5, '-180.5').reason, 'lng');
  assert.equal(bad(8, 'ph').reason, 'country');
  assert.equal(bad(14, '-5').reason, 'population');
  assert.equal(bad(14, '3000000000').reason, 'population');
  assert.equal(parseGeonamesLine('1\tonly\tthree', new Map()).reason, 'columns');
});

test('a blank population is zero', () => {
  const f = PARANAQUE.split('\t'); f[14] = '';
  assert.equal(parseGeonamesLine(f.join('\t'), new Map()).row.population, 0);
});

test('parseGeonames skips blank lines, counts refusals, keeps the last row per id', () => {
  const second = PARANAQUE.replace('665822', '700000');
  const out = parseGeonames(`${PARANAQUE}\r\n\r\n${second}\nnot a row\n`, new Map());
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].population, 700000);
  assert.equal(out.duplicates, 1);
  assert.deepEqual(out.skipped, { columns: 1 });
});

test('sqlText doubles quotes and refuses NUL', () => {
  assert.equal(sqlText("Côte d'Ivoire"), "'Côte d''Ivoire'");
  assert.equal(sqlText('back\\slash'), "'back\\slash'");
  assert.equal(sqlText(null), 'NULL');
  assert.throws(() => sqlText('a\u0000b'));
});

test('buildUpsert writes one statement that only touches changed rows', () => {
  const sql = buildUpsert([
    { id: 1, name: "O'Hare", ascii_name: "O'Hare", admin1: null, country_code: 'US', lat: '41.97', lng: '-87.9', population: 0 },
    { id: 2, name: 'B', ascii_name: 'B', admin1: 'X', country_code: 'PH', lat: '1', lng: '2', population: 3 },
  ]);
  assert.match(sql, /^INSERT INTO public\.cities \(id, name, ascii_name, admin1, country_code, lat, lng, population\) VALUES/);
  assert.match(sql, /\(1, 'O''Hare', 'O''Hare', NULL, 'US', 41\.97, -87\.9, 0\)/);
  assert.match(sql, /\(2, 'B', 'B', 'X', 'PH', 1, 2, 3\)/);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(sql, /IS DISTINCT FROM/);
});

test('parseDatabaseUrl decodes credentials and picks sslmode by host', () => {
  const local = parseDatabaseUrl('postgresql://postgres:p%40ss@127.0.0.1:54322/postgres');
  assert.deepEqual(local, { host: '127.0.0.1', port: 54322, user: 'postgres', password: 'p@ss', database: 'postgres', sslmode: 'disable', sslrootcert: null, local: true });
  const remote = parseDatabaseUrl('postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-x.pooler.supabase.com:5432/postgres');
  assert.equal(remote.sslmode, 'require');
  assert.equal(remote.local, false);
  assert.equal(parseDatabaseUrl('postgresql://u:p@db.x.supabase.co/postgres?sslmode=verify-full').sslmode, 'verify-full');
  assert.throws(() => parseDatabaseUrl('mysql://u:p@h/db'));
});

test('a non-local database needs --confirm-ref naming the project in the URL', () => {
  const local = parseDatabaseUrl('postgresql://postgres:postgres@localhost:54322/postgres');
  assert.equal(checkTarget(local, undefined).ok, true);

  const url = 'postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
  const remote = parseDatabaseUrl(url);
  assert.equal(checkTarget(remote, undefined).ok, false);
  assert.equal(checkTarget(remote, 'zzzzzzzzzzzzzzzzzzzz').ok, false);
  assert.equal(checkTarget(remote, 'not a ref').ok, false);
  assert.equal(checkTarget(remote, 'abcdefghijklmnopqrst').ok, true);

  const pooler = 'postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-x.pooler.supabase.com:5432/postgres';
  assert.equal(checkTarget(parseDatabaseUrl(pooler), 'abcdefghijklmnopqrst').ok, true);
  // The ref must be the project, not something that happens to sit in the password.
  const sneaky = 'postgresql://postgres:abcdefghijklmnopqrst@db.zzzzzzzzzzzzzzzzzzzz.supabase.co/postgres';
  assert.equal(checkTarget(parseDatabaseUrl(sneaky), 'abcdefghijklmnopqrst').ok, false);
});

test('a CA file in the URL turns on certificate checks by default', () => {
  const cfg = parseDatabaseUrl('postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co/postgres?sslrootcert=C%3A%2Fcerts%2Fprod-ca.crt');
  assert.equal(cfg.sslmode, 'verify-full');
  assert.equal(cfg.sslrootcert, 'C:/certs/prod-ca.crt');
});

test('away from localhost only SCRAM may carry the password', () => {
  const local = parseDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  const remote = parseDatabaseUrl('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co/postgres');
  for (const code of [3, 5, 10]) assert.equal(authAllowed(local, code), true);
  assert.equal(authAllowed(remote, 10), true);
  assert.equal(authAllowed(remote, 3), false);
  assert.equal(authAllowed(remote, 5), false);
});

// A fake server that answers each client message with the next scripted reply.
function fakeServer(replies) {
  const seen = [];
  const server = net.createServer((sock) => {
    let i = 0;
    sock.on('data', (d) => {
      seen.push(d);
      const r = replies[i++];
      if (r) sock.write(r);
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}
const authMsg = (code, extra = Buffer.alloc(0)) => {
  const b = Buffer.alloc(9); b.write('R', 0, 'latin1'); b.writeInt32BE(8 + extra.length, 1); b.writeInt32BE(code, 5);
  return Buffer.concat([b, extra]);
};

test('a server that skips the SCRAM proof is refused', { timeout: 5000 }, async () => {
  const { server, port } = await fakeServer([authMsg(10, Buffer.from('SCRAM-SHA-256\0\0', 'latin1')), authMsg(0)]);
  const c = new PgClient({ host: '127.0.0.1', port, user: 'u', password: 'pw', database: 'd', sslmode: 'disable', local: true });
  await assert.rejects(c.connect(), /SCRAM/);
  c.end();
  server.close();
});

test('a remote server asking for the password in clear never gets it', { timeout: 5000 }, async () => {
  const { server, seen, port } = await fakeServer([authMsg(3)]);
  const c = new PgClient({ host: '127.0.0.1', port, user: 'u', password: 'secret-pw', database: 'd', sslmode: 'disable', local: false });
  await assert.rejects(c.connect(), /refus/);
  c.end();
  server.close();
  assert.equal(Buffer.concat(seen).includes('secret-pw'), false);
});
