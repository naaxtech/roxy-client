import { THEMES } from './theme';

export const IDENTITY_LABELS = [
  'Lesbian', 'Bisexual', 'Queer', 'Pansexual', 'Trans',
  'Non-binary', 'Questioning', 'WLW ally',
] as const;

export const PRONOUNS = [
  'she/her', 'they/them', 'she/they',
] as const;

export const INTERESTS = [
  'Music', 'Books', 'Art', 'Activism', 'Sport', 'Travel', 'Gaming', 'Film',
  'Food', 'Wellness', 'Coding', 'Nature', 'Crafts', 'Comedy', 'Dancing',
  'Fashion', 'Yoga', 'Podcasts', 'Photography', 'Writing', 'Theatre',
  'Politics', 'Volunteering', 'Pets',
] as const;

/**
 * RETIRED palette. Origin: 9a50bb1 (2026-03-04, "shared TypeScript types and
 * app constants"), the first dark violet palette, before lib/theme.ts. No app
 * code reads it now; it stays exported (never delete unused code) and points
 * at the v2 dark roles so nothing violet survives (direction v2 › Bans,
 * superseded 2026-10-21). Remove once a release confirms no caller.
 */
const V2 = THEMES.dark;
export const COLORS = {
  primary: V2.pink,
  secondary: V2.pinkInk,
  accent: V2.pinkInk,
  background: V2.ground,
  surface: V2.surface,
  surfaceLight: V2.raised,
  textPrimary: V2.ink,
  textSecondary: V2.ink2,
  textMuted: V2.ink3,
  success: V2.success,
  warning: V2.warning,
  error: V2.danger,
  roxy: V2.roxy,
  devPanel: V2.pink,
} as const;

export const ROXY_SISTER_RESOURCES = {
  mindout: { name: 'Mindout LGBT+ Helpline', number: '0300 304 7000' },
  samaritans: { name: 'Samaritans', number: '116 123' },
  crisisText: { name: 'Crisis Text Line', instruction: 'Text HELLO to 85258' },
  lgbtFoundation: { name: 'LGBT Foundation', url: 'https://lgbt.foundation' },
} as const;

export const DEV_MOCK_PROMPTS = [
  "What's a skill you've always wanted to learn?",
  "Which place changed how you see yourself?",
  "What's your version of a perfect Sunday?",
  "What's something you believed at 16 that you've completely changed your mind on?",
  "If you could live anywhere for a year, where and why?",
  "What's a small thing that always makes your day better?",
  "What are you most proud of that nobody knows about?",
  "Describe your ideal first date in three words.",
  "What's the last book / show / song that genuinely moved you?",
  "What does home mean to you?",
] as const;

export const MAX_INTERESTS = 8;
export const MAX_BIO_LENGTH = 280;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
export const ROXY_SISTER_MAX_TURNS = 10;
export const ROXY_WINGWOMAN_DAILY_LIMIT = 5;
export const ROXY_NUDGE_LIFETIME_LIMIT = 3;
export const PRESENCE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
export const REGISTER_BUSINESS_URL = 'https://tally.so/r/VL1J5g';
