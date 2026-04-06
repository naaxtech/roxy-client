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
