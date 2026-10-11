// apps/mobile/lib/avatars.ts
import { BRAND_GRADIENT, LIVE_GRADIENT, THEMES } from './theme';

export const PRESET_AVATARS = [
  '🐱', '🦊', '🐸', '🌸', '🦋', '🌙',
  '🌈', '💫', '🐧', '🍓', '🌻', '🐝',
];

// Paired background tints for each preset (same order)
export const PRESET_COLORS = [
  '#7C3AED', '#EC4899', '#10B981', '#F59E0B',
  '#3B82F6', '#EF4444', '#8B5CF6', '#14B8A6',
  '#F97316', '#84CC16', '#6366F1', '#A855F7',
];

export function isPresetAvatar(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('avatar://');
}

export function presetEmoji(url: string): string {
  return url.replace('avatar://', '');
}

export function presetColor(url: string): string {
  const emoji = presetEmoji(url);
  const idx = PRESET_AVATARS.indexOf(emoji);
  return idx >= 0 ? PRESET_COLORS[idx] + '50' : '#7C3AED50';
}

// Single source of truth for the name-hashed gradient avatars used across
// Grow, Messages, People, feed cards, and community screens. One palette,
// one hash — the same name renders the same gradient on every screen.
//
// Built from lib/theme.ts tokens only (the brand and live ramps, and the
// dark theme's pink / lilac / rose / periwinkle / gold fills), never loose
// hexes: "colours only from theme tokens". The earlier palette was six
// hand-picked pairs that matched no token; `components/ui/Avatar.tsx` is the
// one component that draws them, and its test holds every stop to a token.
const T = THEMES.dark;
export const AVATAR_GRADS: [string, string][] = [
  [BRAND_GRADIENT[0], BRAND_GRADIENT[2]],
  [T.secondary, T.roxy],
  [T.primary, T.secondary],
  [T.sister, T.secondary],
  [BRAND_GRADIENT[1], T.secondary],
  [LIVE_GRADIENT[0], LIVE_GRADIENT[1]],
  // No gold: several screens outside components/ui/Avatar still print a
  // hard-coded white initial on these, and white on gold is ~1.9:1.
];

export function avatarGradient(name: string | null | undefined): [string, string] {
  let h = 0;
  const s = name ?? '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_GRADS[Math.abs(h) % AVATAR_GRADS.length];
}
