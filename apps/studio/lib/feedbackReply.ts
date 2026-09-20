export function feedbackReporterName(
  displayName: string | null | undefined,
  username: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) return name;
  const handle = username?.trim();
  if (handle) return `@${handle}`;
  return 'Member';
}

export function feedbackReplyMailto(input: {
  email: string;
  reporterName: string;
  reportedAt: string;
  message: string;
  categoryLabel: string;
}): string {
  const subject = `Re: your Roxy report (${input.categoryLabel})`;
  const body = [
    `Hi ${input.reporterName},`,
    '',
    'Thanks for writing in to Roxy. You reported this on ' + input.reportedAt + ':',
    '',
    input.message.trim(),
    '',
    '— Roxy',
  ].join('\n');
  return `mailto:${encodeURIComponent(input.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
