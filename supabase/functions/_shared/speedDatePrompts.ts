import { callClaude } from './claude.ts';

export const MOCK_SPEED_DATE_PROMPTS = [
  "What's a skill you've always wanted to learn?",
  "Which place changed how you see yourself?",
  "What's your version of a perfect Sunday?",
  "What's something you believed at 16 you've completely changed your mind on?",
  "If you could live anywhere for a year, where and why?",
  "What's a small thing that always makes your day better?",
  "What are you most proud of that nobody knows about?",
  "Describe your ideal first date in three words.",
  "What's the last book, show, or song that genuinely moved you?",
  "What does home mean to you?",
];

// Shared by speed-date-prompts/index.ts (regen-on-request) and
// join-speed-date-session/index.ts (generate-at-session-creation) so a new
// session never falls back to a fixed static array -- doctrine: "Generate
// once, share all participants" (60/25 token budget per CLAUDE.md §8).
export async function generateSpeedDatePrompts(): Promise<string[]> {
  const mockResponse = JSON.stringify(MOCK_SPEED_DATE_PROMPTS);

  const raw = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Generate exactly 10 conversation starter prompts for a 5-minute speed date between two WLW users. Prompts must be: light, fun, emotionally interesting (not small talk), queer-affirming and inclusive, varied (one nostalgic, one future-focused, one playful, one values-based). Return ONLY a JSON array of 10 strings. No markdown, no explanation.`,
    messages: [{ role: 'user', content: 'Generate the 10 prompts.' }],
    maxTokens: 300,
    mockResponse,
  });

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 10) {
      return parsed;
    }
  } catch {
    // fall through to mock
  }
  return MOCK_SPEED_DATE_PROMPTS;
}
