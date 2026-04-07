import { Linking } from 'react-native';

export function formatDuration(startsAt: string, endsAt: string | null): string | null {
  if (!endsAt) return null;
  const mins = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function buildCalendarUrl(params: {
  title: string;
  startsAt: string;
  endsAt: string | null;
  locationText: string | null;
  communityName: string | null;
}): string {
  const { title, startsAt, endsAt, locationText, communityName } = params;
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 60 * 60 * 1000);

  // Google Calendar expects YYYYMMDDTHHmmssZ
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace('.000', '');

  const details = communityName ? `Roxy event · ${communityName}` : 'Roxy event';
  const locationPart = locationText
    ? `&location=${encodeURIComponent(locationText)}`
    : '';

  return (
    `https://calendar.google.com/calendar/render` +
    `?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${fmt(start)}/${fmt(end)}` +
    locationPart +
    `&details=${encodeURIComponent(details)}`
  );
}

export function openCalendar(params: Parameters<typeof buildCalendarUrl>[0]): void {
  Linking.openURL(buildCalendarUrl(params)).catch(() => {});
}
