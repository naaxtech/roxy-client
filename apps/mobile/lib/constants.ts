export const IDENTITY_LABELS = [
  'Lesbian', 'Bisexual', 'Queer', 'Pansexual', 'Trans',
  'Non-binary', 'Questioning', 'WLW ally', 'Prefer not to say',
] as const;

export const PRONOUNS = [
  'she/her', 'they/them', 'she/they', 'any/all', 'other',
] as const;

export const INTERESTS = [
  'Music', 'Books', 'Art', 'Activism', 'Sport', 'Travel', 'Gaming', 'Film',
  'Food', 'Wellness', 'Coding', 'Nature', 'Crafts', 'Comedy', 'Dancing',
  'Fashion', 'Yoga', 'Podcasts', 'Photography', 'Writing', 'Theatre',
  'Politics', 'Volunteering', 'Pets',
] as const;

export const COLORS = {
  primary: '#C4476A',
  secondary: '#8B5CF6',
  accent: '#F472B6',
  background: '#1a0a2e',
  surface: '#2d1b4e',
  surfaceLight: '#3d2b5e',
  textPrimary: '#FFFFFF',
  textSecondary: '#C4B5D4',
  textMuted: '#8B7AA8',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  roxy: '#E879A6',
  devPanel: '#FF1493',
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
