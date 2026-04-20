'use client';

import { useState, useTransition } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { updateNotificationPrefs, type StudioNotificationPrefs } from './account-actions';

const PREFS: { key: keyof StudioNotificationPrefs; label: string; description: string }[] = [
  { key: 'studio_orders', label: 'Order updates', description: 'New orders, shipping confirmations, and refund status' },
  { key: 'studio_community', label: 'Community activity', description: 'New members, event sign-ups, and community milestones' },
  { key: 'studio_news', label: 'Roxy platform news', description: 'Product updates, new features, and platform announcements' },
];

type Props = {
  initialPrefs: StudioNotificationPrefs;
};

export function NotificationPrefsClient({ initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<StudioNotificationPrefs>(initialPrefs);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleChange = (key: keyof StudioNotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaved(false);
    startTransition(async () => {
      await updateNotificationPrefs(next);
      setSaved(true);
    });
  };

  return (
    <div className="space-y-4">
      {PREFS.map(({ key, label, description }) => (
        <div key={key} className="flex items-start gap-3">
          <Checkbox
            id={key}
            checked={prefs[key]}
            disabled={isPending}
            onCheckedChange={v => handleChange(key, v === true)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor={key} className="cursor-pointer font-medium">{label}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      ))}
      {saved && <p className="text-xs text-green-600">Preferences saved.</p>}
    </div>
  );
}
