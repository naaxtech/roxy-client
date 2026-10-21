// apps/mobile/lib/avatars.ts
import { IDENTITY } from './theme';

export const PRESET_AVATARS = [
  '🐱', '🦊', '🐸', '🌸', '🦋', '🌙',
  '🌈', '💫', '🐧', '🍓', '🌻', '🐝',
];

// Paired background tints for each preset (same order). v2: the identity
// palette, cycled (the v0 list was hand-picked hexes, four of them violet:
// #7C3AED #8B5CF6 #6366F1 #A855F7; superseded 2026-10-21).
export const PRESET_COLORS: string[] = PRESET_AVATARS.map((_, i) => IDENTITY[i % IDENTITY.length]);

export function isPresetAvatar(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('avatar://');
}

export function presetEmoji(url: string): string {
  return url.replace('avatar://', '');
}

export function presetColor(url: string): string {
  const emoji = presetEmoji(url);
  const idx = PRESET_AVATARS.indexOf(emoji);
  return (idx >= 0 ? PRESET_COLORS[idx] : IDENTITY[0]) + '50';
}

// Single source of truth for the name-hashed gradient avatars used across
// Grow, Messages, People, feed cards, and community screens. One palette,
// one hash — the same name renders the same gradient on every screen.
//
// v2 (design direction › Color, identity): an avatar is ONE identity fill,
// inked `onBrandPink` (which inks every identity fill). The pairs stay pairs
// of two equal stops so every LinearGradient call site renders flat with no
// layout change. The v0 list was six two-tone ramps from the brand/live ramps
// and the dark lilac/periwinkle fills (superseded 2026-10-21); the shape can
// go once every caller draws a plain View.
export const AVATAR_GRADS: [string, string][] = IDENTITY.map((c) => [c, c]);

export function avatarGradient(name: string | null | undefined): [string, string] {
  let h = 0;
  const s = name ?? '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_GRADS[Math.abs(h) % AVATAR_GRADS.length];
}
