/**
 * The one password rule for every place she sets a password (sign-up in
 * app/(auth)/welcome.tsx, a reset in app/(auth)/reset-password.tsx).
 *
 * 10 characters (gate wave 3). The server enforces it too once Auth's
 * "minimum password length" is raised to 10 in the dashboard
 * (docs/ops/launch-runbook.md); the client check only saves her a round trip.
 */
export const MIN_PASSWORD_LENGTH = 10;

/** The error to show, or null when the password is long enough. */
export function passwordTooShortMessage(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null;
}
