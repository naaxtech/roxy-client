import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards on the seed that a database would not catch.
 *
 * The content notes and reviews attach to entries by JOINing on slug. A typo
 * there does not error — the JOIN simply matches nothing and the note quietly
 * never exists. Every one of these is a content warning that silently failed to
 * appear on a work that needed it, which is the failure mode this Archive can
 * least afford.
 *
 * The spoiler check is the other one. "No ending references in seeded content"
 * is a line in the brief's definition of done and the single rule the Archive
 * asks members to follow. A rule the seed breaks on the way in is not a rule,
 * and the seed is what a new member reads first.
 *
 * These run in jest because there is no database in this environment — no
 * Docker, so no `supabase db reset`. They are not a substitute for applying the
 * migration; they are the part that can be checked without one.
 */

const SEED = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '098_archive_seed.sql'),
  'utf8'
);

/** Slugs in the entries INSERT — the first column of each VALUES tuple. */
function insertedSlugs(): string[] {
  const start = SEED.indexOf('INSERT INTO public.archive_entries');
  const end = SEED.indexOf('ON CONFLICT (slug) DO NOTHING');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = SEED.slice(start, end);
  return [...block.matchAll(/^\('([a-z0-9-]+)',/gm)].map((m) => m[1]);
}

/** Slugs referenced by the notes and reviews blocks. */
function referencedSlugs(): string[] {
  const start = SEED.indexOf('INSERT INTO public.archive_content_notes');
  const block = SEED.slice(start);
  return [...block.matchAll(/\('([a-z0-9-]+)',\s*(?:'|u_)/g)].map((m) => m[1]);
}

describe('the archive seed', () => {
  it('publishes at least the 40 entries the demo needs', () => {
    expect(insertedSlugs().length).toBeGreaterThanOrEqual(40);
  });

  it('has no duplicate slugs', () => {
    const slugs = insertedSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers all five media types', () => {
    for (const type of ['film', 'tv', 'book', 'comic', 'music']) {
      expect(SEED).toContain(`','${type}',`);
    }
  });

  it('attaches every note and review to an entry that exists', () => {
    const inserted = new Set(insertedSlugs());
    const dangling = [...new Set(referencedSlugs())].filter((s) => !inserted.has(s));
    expect(dangling).toEqual([]);
  });

  it('says nothing about how anything ends', () => {
    // The one Archive rule. Matched on the phrases a summary or a content note
    // would actually use — an ending discussed obliquely is still discussed.
    const forbidden = [
      /\bthe ending\b/i,
      /\bends? (?:with|on|in)\b/i,
      /\bfinale\b/i,
      /\blast (?:scene|chapter|episode|page)\b/i,
      /\bdies?\b/i,
      /\bdeath of (?!a parent)/i,
      /\bbury your gays\b/i,
      /\bspoiler/i,
    ];
    const offenders: string[] = [];
    for (const line of SEED.split('\n')) {
      // Skip the file's own commentary — it discusses the rule, by necessity.
      if (line.trimStart().startsWith('--')) continue;
      for (const pattern of forbidden) {
        if (pattern.test(line)) offenders.push(line.trim().slice(0, 100));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the demo weight out of production by guarding on the dev profiles', () => {
    // Fabricated consensus in front of real members would undermine the one
    // screen whose value is that the number came from people like them.
    expect(SEED).toMatch(/IF u_alex IS NULL THEN[\s\S]{0,200}RETURN;/);
    expect(SEED).toContain('baseline_vote_count');
  });

  it('seeds at least one entry below the vote gate so the NEW state is demonstrable', () => {
    const weights = [...SEED.matchAll(/\('([a-z0-9-]+)',(\d+),(\d+)\)/g)]
      .map((m) => Number(m[2]));
    expect(weights.length).toBeGreaterThan(0);
    expect(weights.some((total) => total < 10)).toBe(true);
  });
});
