// apps/mobile/lib/avatars.ts

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
export const AVATAR_GRADS: [string, string][] = [
  ['#FF6A2E', '#E81C8E'],
  ['#8B5CF6', '#E879A6'],
  ['#FF2F71', '#8B5CF6'],
  ['#F472B6', '#FF6A2E'],
  ['#C4476A', '#8B5CF6'],
  ['#FF8A3D', '#FF2F71'],
];

export function avatarGradient(name: string | null | undefined): [string, string] {
  let h = 0;
  const s = name ?? '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_GRADS[Math.abs(h) % AVATAR_GRADS.length];
}
