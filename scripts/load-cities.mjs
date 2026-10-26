#!/usr/bin/env node
/**
 * Load GeoNames cities into public.cities (migration 139) for Nearby communities.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     node scripts/load-cities.mjs <cities15000.txt> [--admin1=<admin1CodesASCII.txt>] [--rollback]
 *   DATABASE_URL=<prod url> node scripts/load-cities.mjs <file> --confirm-ref=<project ref>
 *
 * Data: https://download.geonames.org/export/dump/cities15000.zip (cities with a population
 * of 15,000 or more) and, optionally, admin1CodesASCII.txt from the same directory for region
 * names. GeoNames data is licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/):
 * credit "GeoNames (geonames.org)" in the app's About screen. The files are untrusted input:
 * every field is validated, nothing in them is executed, and text reaches SQL only as an
 * escaped literal.
 *
 * Columns used from the 19 tab-separated columns of the GeoNames main table:
 *    0 geonameid -> id          1 name -> name             2 asciiname -> ascii_name
 *    4 latitude  -> lat         5 longitude -> lng         8 country code -> country_code
 *   10 admin1 code -> admin1 (the region name from --admin1 when given, else the code)
 *   14 population -> population
 *
 * Behaviour: one transaction; batches of --batch rows (default 1000) as
 * INSERT .. ON CONFLICT (id) DO UPDATE, touching only rows that changed (a moved centroid
 * re-points its communities through 139's trigger). Cities missing from the file are kept:
 * deleting one would clear the place of every community in it. --rollback counts, then rolls
 * back. A DATABASE_URL that is not localhost needs --confirm-ref=<ref>, and the ref must be the
 * project the URL names (db.<ref>.supabase.co or the pooler user postgres.<ref>). The direct
 * db.<ref> host may be IPv6-only; on an IPv4 network use the session pooler URL instead.
 * Away from localhost the password goes only through SCRAM-SHA-256 (never cleartext or md5), and
 * the server must prove it knows it. Add `?sslrootcert=<path to the project's CA .crt>` (Supabase
 * dashboard -> Database -> SSL) to have the certificate checked (verify-full); without it the
 * connection is encrypted (`require`) but the server's identity is not checked.
 *
 * No driver is installed in this repo and installs are off-limits, so this file carries a
 * minimal Postgres client: startup, SCRAM-SHA-256 / md5 / cleartext auth, TLS via SSLRequest,
 * simple query. Never prints the password or the URL.
 * Exit: 0 = loaded (or rolled back as asked), 1 = failed, 2 = usage or refused target.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const MAX_INT = 2147483647;
const CONTROL = /[\u0000-\u001f\u007f]/;
const COORD = /^-?\d{1,3}(\.\d+)?$/;

// ── parsing (untrusted input) ─────────────────────────────────────────────
function cleanText(value) {
  const s = (value ?? '').trim();
  const n = [...s].length;
  if (n < 1 || n > 200 || CONTROL.test(s)) return null;
  return s;
}

/** admin1CodesASCII.txt: "CC.code<TAB>name<TAB>asciiname<TAB>geonameid" -> Map("CC.code" -> name). */
export function parseAdmin1(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [key, name] = line.split('\t');
    if (!key || !/^[A-Z]{2}\.[A-Za-z0-9]{1,20}$/.test(key)) continue;
    const clean = cleanText(name);
    if (clean) map.set(key, clean);
  }
  return map;
}

/** One GeoNames line -> { row } or { reason } (the first field that failed). */
export function parseGeonamesLine(line, admin1Map) {
  const f = line.split('\t');
  if (f.length !== 19) return { reason: 'columns' };

  if (!/^\d{1,10}$/.test(f[0])) return { reason: 'id' };
  const id = Number(f[0]);
  if (id < 1 || id > MAX_INT) return { reason: 'id' };

  const name = cleanText(f[1]);
  if (!name) return { reason: 'name' };
  const ascii = f[2].trim() === '' ? name : cleanText(f[2]);
  if (!ascii) return { reason: 'ascii_name' };

  if (!COORD.test(f[4]) || Math.abs(Number(f[4])) > 90) return { reason: 'lat' };
  if (!COORD.test(f[5]) || Math.abs(Number(f[5])) > 180) return { reason: 'lng' };

  if (!/^[A-Z]{2}$/.test(f[8])) return { reason: 'country' };

  let admin1 = null;
  if (/^[A-Za-z0-9]{1,20}$/.test(f[10])) admin1 = admin1Map.get(`${f[8]}.${f[10]}`) ?? f[10];

  let population = 0;
  if (f[14] !== '') {
    if (!/^\d{1,10}$/.test(f[14]) || Number(f[14]) > MAX_INT) return { reason: 'population' };
    population = Number(f[14]);
  }

  return {
    row: { id, name, ascii_name: ascii, admin1, country_code: f[8], lat: f[4], lng: f[5], population },
  };
}

/** The whole file -> unique rows (last one per id wins) plus what was refused and why. */
export function parseGeonames(text, admin1Map) {
  const byId = new Map();
  const skipped = {};
  let duplicates = 0;
  let lines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    lines += 1;
    const r = parseGeonamesLine(line, admin1Map);
    if (r.reason) {
      skipped[r.reason] = (skipped[r.reason] ?? 0) + 1;
      continue;
    }
    if (byId.has(r.row.id)) duplicates += 1;
    byId.set(r.row.id, r.row);
  }
  return { rows: [...byId.values()], skipped, duplicates, lines };
}

// ── SQL ───────────────────────────────────────────────────────────────────
/** A text literal for a server with standard_conforming_strings = on (checked at connect). */
export function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value);
  if (s.includes('\u0000')) throw new Error('NUL byte in text');
  return `'${s.replaceAll("'", "''")}'`;
}

const COLS = ['name', 'ascii_name', 'admin1', 'country_code', 'lat', 'lng', 'population'];

export function buildUpsert(rows) {
  const values = rows.map((r) => {
    if (!Number.isInteger(r.id) || !Number.isInteger(r.population)) throw new Error('bad numeric field');
    if (!COORD.test(r.lat) || !COORD.test(r.lng)) throw new Error('bad coordinate');
    return `(${r.id}, ${sqlText(r.name)}, ${sqlText(r.ascii_name)}, ${sqlText(r.admin1)}, ${sqlText(r.country_code)}, ${r.lat}, ${r.lng}, ${r.population})`;
  });
  return `INSERT INTO public.cities (id, ${COLS.join(', ')}) VALUES\n${values.join(',\n')}\n`
    + `ON CONFLICT (id) DO UPDATE SET ${COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}\n`
    + `WHERE (${COLS.map((c) => `cities.${c}`).join(', ')}) IS DISTINCT FROM (${COLS.map((c) => `EXCLUDED.${c}`).join(', ')})`;
}

// ── target ────────────────────────────────────────────────────────────────
const isLocalHost = (h) => h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);

export function parseDatabaseUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('DATABASE_URL must be a postgres:// URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const local = isLocalHost(host);
  // libpq's sslrootcert: the project's CA (Supabase dashboard -> Database -> SSL). With it, the
  // certificate is checked by default; without it, `require` encrypts but cannot tell an impostor.
  const sslrootcert = u.searchParams.get('sslrootcert');
  const sslmode = u.searchParams.get('sslmode') ?? (local ? 'disable' : sslrootcert ? 'verify-full' : 'require');
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error(`unknown sslmode ${sslmode}`);
  }
  return {
    host,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    sslmode,
    sslrootcert,
    local,
  };
}

/**
 * Which authentication requests may be answered. Away from localhost only SCRAM-SHA-256 (10):
 * cleartext (3) and md5 (5) would hand the password, or a replayable hash of it, to whoever
 * answers, and `require` does not prove who that is.
 */
export function authAllowed(cfg, code) {
  return cfg.local || code === 10;
}

/** Local: always fine. Anywhere else: --confirm-ref must name the project the URL points at. */
export function checkTarget(cfg, confirmRef) {
  if (cfg.local) return { ok: true };
  if (!confirmRef) return { ok: false, reason: `refusing ${cfg.host}: not localhost; pass --confirm-ref=<project ref>` };
  if (!/^[a-z0-9]{20}$/.test(confirmRef)) return { ok: false, reason: '--confirm-ref is not a Supabase project ref' };
  const inHost = cfg.host.toLowerCase().split('.').includes(confirmRef);
  const inUser = cfg.user.toLowerCase().split('.').slice(1).includes(confirmRef);
  if (!inHost && !inUser) return { ok: false, reason: `refusing: ${cfg.host} is not project ${confirmRef}` };
  return { ok: true };
}

// ── a minimal Postgres client ─────────────────────────────────────────────
const cstr = (s) => Buffer.from(`${s}\0`, 'utf8');

function frame(type, body) {
  const head = Buffer.alloc(5);
  head.write(type, 0, 'latin1');
  head.writeInt32BE(4 + body.length, 1);
  return Buffer.concat([head, body]);
}

/** RFC 5802 / 7677 client-final-message for SCRAM-SHA-256, and the signature the server must send. */
export function scramClientFinal({ password, clientFirstBare, serverFirst }) {
  const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
  const clientNonce = /(?:^|,)r=([^,]*)/.exec(clientFirstBare)?.[1] ?? '';
  if (!clientNonce || !attrs.r || !attrs.r.startsWith(clientNonce) || attrs.r.length <= clientNonce.length) {
    throw new Error('SCRAM: server nonce does not extend the client nonce');
  }
  const salt = Buffer.from(attrs.s ?? '', 'base64');
  const iterations = Number(attrs.i);
  if (!salt.length || !Number.isInteger(iterations) || iterations < 1) throw new Error('SCRAM: bad salt or iteration count');

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  // NFKC is SASLprep's normalisation step; it is the identity for ASCII passwords.
  const salted = crypto.pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = hmac(salted, 'Client Key');
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const withoutProof = `c=biws,r=${attrs.r}`;
  const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
  const clientSignature = hmac(storedKey, authMessage);
  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < proof.length; i += 1) proof[i] = clientKey[i] ^ clientSignature[i];
  const serverSignature = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
  return { clientFinal: `${withoutProof},p=${proof.toString('base64')}`, serverSignature };
}

function pgError(body) {
  const fields = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]);
    const end = body.indexOf(0, i + 1);
    fields[code] = body.subarray(i + 1, end).toString('utf8');
    i = end + 1;
  }
  const err = new Error(`${fields.M ?? 'server error'} (${fields.C ?? '?'})`);
  err.code = fields.C;
  return err;
}

class MessageReader {
  constructor(stream) {
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.error = null;
    stream.on('data', (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); this.pump(); });
    stream.on('error', (e) => this.fail(e));
    stream.on('close', () => this.fail(new Error('connection closed')));
  }

  pump() {
    while (this.waiters.length && this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) return;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this.waiters.shift().resolve({ type, body });
    }
  }

  fail(e) {
    this.error ??= e;
    while (this.waiters.length) this.waiters.shift().reject(this.error);
  }

  next() {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.pump(); });
  }
}

function openSocket(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.setTimeout(15000, () => s.destroy(new Error('connect timeout')));
    s.once('connect', () => { s.setTimeout(0); resolve(s); });
    s.once('error', reject);
  });
}

export class PgClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.params = {};
  }

  write(buf) {
    this.stream.write(buf);
  }

  async negotiateTls(sock) {
    const request = Buffer.alloc(8);
    request.writeInt32BE(8, 0);
    request.writeInt32BE(80877103, 4);
    sock.write(request);
    const answer = await new Promise((resolve, reject) => { sock.once('data', resolve); sock.once('error', reject); });
    // One byte, nothing after it: bytes smuggled behind it would be read as if encrypted.
    if (answer.length !== 1) throw new Error('unexpected bytes in the TLS answer');
    if (answer[0] === 0x4e) { // 'N'
      if (['require', 'verify-ca', 'verify-full'].includes(this.cfg.sslmode)) throw new Error('server refused TLS');
      return sock;
    }
    if (answer[0] !== 0x53) throw new Error('bad TLS answer'); // 'S'
    const verify = this.cfg.sslmode === 'verify-ca' || this.cfg.sslmode === 'verify-full';
    const secure = tls.connect({
      socket: sock,
      servername: net.isIP(this.cfg.host) ? undefined : this.cfg.host,
      rejectUnauthorized: verify,
      ...(this.cfg.sslrootcert ? { ca: readFileSync(this.cfg.sslrootcert) } : {}),
      ...(this.cfg.sslmode === 'verify-ca' ? { checkServerIdentity: () => undefined } : {}),
    });
    await new Promise((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject); });
    return secure;
  }

  async connect() {
    const sock = await openSocket(this.cfg.host, this.cfg.port);
    this.stream = this.cfg.sslmode === 'disable' ? sock : await this.negotiateTls(sock);
    this.reader = new MessageReader(this.stream);

    const kv = Buffer.from(
      `user\0${this.cfg.user}\0database\0${this.cfg.database}\0client_encoding\0UTF8\0application_name\0roxy-load-cities\0\0`,
      'utf8',
    );
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + kv.length, 0);
    head.writeInt32BE(196608, 4); // protocol 3.0
    this.write(Buffer.concat([head, kv]));

    await this.authenticate();
    for (;;) {
      const m = await this.reader.next();
      if (m.type === 'Z') return;
      if (m.type === 'E') throw pgError(m.body);
      if (m.type === 'S') {
        const [k, v] = m.body.toString('utf8').split('\0');
        this.params[k] = v;
      }
    }
  }

  async authenticate() {
    const password = this.cfg.password;
    let clientFirstBare = '';
    let scram = null;
    let scramVerified = false;
    for (;;) {
      const m = await this.reader.next();
      if (m.type === 'E') throw pgError(m.body);
      if (m.type !== 'R') throw new Error(`unexpected message ${m.type} during authentication`);
      const code = m.body.readInt32BE(0);
      if (code === 0) {
        // Once SCRAM starts, only a server that proved it knows the password may let us in.
        if (clientFirstBare && !scramVerified) throw new Error('SCRAM: the server skipped its proof');
        return;
      }
      if ([3, 5, 10].includes(code) && !authAllowed(this.cfg, code)) {
        throw new Error(`refusing to send the password with auth method ${code} to a non-local server (SCRAM only)`);
      }
      if (!password) throw new Error('the server wants a password and DATABASE_URL has none');
      if (code === 3) {
        this.write(frame('p', cstr(password)));
      } else if (code === 5) {
        const salt = m.body.subarray(4, 8);
        const inner = crypto.createHash('md5').update(password + this.cfg.user).digest('hex');
        const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
        this.write(frame('p', cstr(`md5${outer}`)));
      } else if (code === 10) {
        const mechanisms = m.body.subarray(4).toString('utf8').split('\0').filter(Boolean);
        if (!mechanisms.includes('SCRAM-SHA-256')) throw new Error(`no supported SASL mechanism (${mechanisms.join(', ')})`);
        clientFirstBare = `n=,r=${crypto.randomBytes(18).toString('base64')}`;
        const first = Buffer.from(`n,,${clientFirstBare}`, 'utf8');
        const len = Buffer.alloc(4);
        len.writeInt32BE(first.length, 0);
        this.write(frame('p', Buffer.concat([cstr('SCRAM-SHA-256'), len, first])));
      } else if (code === 11) {
        scram = scramClientFinal({ password, clientFirstBare, serverFirst: m.body.subarray(4).toString('utf8') });
        this.write(frame('p', Buffer.from(scram.clientFinal, 'utf8')));
      } else if (code === 12) {
        if (!scram || m.body.subarray(4).toString('utf8') !== `v=${scram.serverSignature}`) {
          throw new Error('SCRAM: the server could not prove it knows the password');
        }
        scramVerified = true;
      } else {
        throw new Error(`unsupported authentication method ${code}`);
      }
    }
  }

  /** Simple-query protocol. Resolves to one { fields, rows, command } per statement. */
  async query(sql) {
    this.write(frame('Q', cstr(sql)));
    const results = [];
    let current = null;
    let error = null;
    for (;;) {
      const m = await this.reader.next();
      if (m.type === 'T') {
        const n = m.body.readInt16BE(0);
        const fields = [];
        let i = 2;
        for (let k = 0; k < n; k += 1) {
          const end = m.body.indexOf(0, i);
          fields.push(m.body.subarray(i, end).toString('utf8'));
          i = end + 1 + 18;
        }
        current = { fields, rows: [] };
      } else if (m.type === 'D') {
        const n = m.body.readInt16BE(0);
        const row = [];
        let i = 2;
        for (let k = 0; k < n; k += 1) {
          const len = m.body.readInt32BE(i);
          i += 4;
          if (len === -1) { row.push(null); continue; }
          row.push(m.body.subarray(i, i + len).toString('utf8'));
          i += len;
        }
        (current ??= { fields: [], rows: [] }).rows.push(row);
      } else if (m.type === 'C') {
        results.push({ ...(current ?? { fields: [], rows: [] }), command: m.body.toString('utf8').replace(/\0$/, '') });
        current = null;
      } else if (m.type === 'E') {
        error = pgError(m.body);
      } else if (m.type === 'Z') {
        if (error) throw error;
        return results;
      } else if (!['I', 'N', 'S'].includes(m.type)) {
        throw new Error(`unexpected message ${m.type}`);
      }
    }
  }

  end() {
    if (!this.stream) return;
    this.stream.end(frame('X', Buffer.alloc(0)));
  }
}

// ── load ──────────────────────────────────────────────────────────────────
/** Upsert rows in batches inside the caller's transaction. Returns rows written and the table count. */
export async function loadRows(client, rows, batchSize) {
  const [exists] = await client.query("SELECT to_regclass('public.cities') IS NOT NULL");
  if (exists.rows[0][0] !== 't') throw new Error('public.cities does not exist: apply migration 139 first');
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const [res] = await client.query(buildUpsert(rows.slice(i, i + batchSize)));
    written += Number(res.command.split(' ')[2] ?? 0);
  }
  const [count] = await client.query('SELECT count(*) FROM public.cities');
  return { written, count: Number(count.rows[0][0]) };
}

function parseArgs(argv) {
  const out = { file: null, admin1: null, rollback: false, confirmRef: undefined, batch: 1000 };
  for (const a of argv) {
    if (a === '--rollback') out.rollback = true;
    else if (a.startsWith('--admin1=')) out.admin1 = a.slice(9);
    else if (a.startsWith('--confirm-ref=')) out.confirmRef = a.slice(14);
    else if (a.startsWith('--batch=')) out.batch = Number(a.slice(8));
    else if (!a.startsWith('--') && !out.file) out.file = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(out.batch) || out.batch < 1 || out.batch > 5000) throw new Error('--batch must be 1..5000');
  return out;
}

async function main(argv) {
  let args;
  let cfg;
  try {
    args = parseArgs(argv);
    if (!args.file) throw new Error('usage: node scripts/load-cities.mjs <cities15000.txt> [--admin1=<file>] [--rollback] [--confirm-ref=<ref>] [--batch=1000]');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    cfg = parseDatabaseUrl(process.env.DATABASE_URL);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const target = checkTarget(cfg, args.confirmRef);
  if (!target.ok) {
    console.error(target.reason);
    return 2;
  }

  const admin1 = args.admin1 ? parseAdmin1(readFileSync(args.admin1, 'utf8')) : new Map();
  const parsed = parseGeonames(readFileSync(args.file, 'utf8'), admin1);
  console.log('GeoNames (geonames.org), CC BY 4.0 - credit GeoNames in the About screen.');
  console.log(`parsed ${parsed.lines} lines: ${parsed.rows.length} cities, ${parsed.duplicates} duplicate ids, skipped ${JSON.stringify(parsed.skipped)}; ${admin1.size} region names`);
  console.log(`target ${cfg.host}:${cfg.port}/${cfg.database}${args.rollback ? ' (rollback)' : ''}`);

  const client = new PgClient(cfg);
  const t0 = performance.now();
  try {
    await client.connect();
    if (client.params.standard_conforming_strings !== 'on') throw new Error('standard_conforming_strings is not on; refusing to send literals');
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout = '10s'");
      const { written, count } = await loadRows(client, parsed.rows, args.batch);
      await client.query(args.rollback ? 'ROLLBACK' : 'COMMIT');
      const ms = Math.round(performance.now() - t0);
      console.log(`${args.rollback ? 'rolled back' : 'committed'}: ${written} rows inserted or changed, public.cities had ${count} rows, ${ms} ms`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
    return 0;
  } catch (e) {
    console.error(`load failed: ${e.message}`);
    return 1;
  } finally {
    client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
