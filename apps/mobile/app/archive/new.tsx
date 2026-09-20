import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ComposerShell } from '../../components/archive/ComposerShell';
import { ComposerField, ComposerSubmit } from '../../components/archive/ComposerField';
import { submitEntry } from '../../components/archive/composerActions';
import { useMembership } from '../../hooks/useMembership';
import { Analytics } from '../../lib/analytics';

/**
 * Suggest a new entry. Copy is the prototype's `M.add`, verbatim.
 *
 * Nothing here is a dropdown of media types by accident: the schema's
 * `archive_media_type` is a real enum, and a free-text type would be refused by
 * Postgres after she had written everything else.
 */
const TYPES = ['film', 'tv', 'book', 'comic', 'music'] as const;

export default function AddArchiveEntryScreen() {
  const router = useRouter();
  const membership = useMembership();

  const [title, setTitle] = useState('');
  const [mediaType, setMediaType] = useState<(typeof TYPES)[number]>('film');
  const [year, setYear] = useState('');
  const [creator, setCreator] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => router.back();

  const send = async () => {
    setBusy(true);
    setError(null);
    const parsedYear = year.trim() ? Number(year.trim()) : null;
    const res = await submitEntry({
      title: title.trim(),
      media_type: mediaType,
      release_year: Number.isFinite(parsedYear) ? parsedYear : null,
      creator: creator.trim() || null,
      summary: summary.trim() || null,
    });
    setBusy(false);

    // The form keeps her text on failure. Clearing it would cost her the whole
    // submission for a network blip.
    if (res.error) { setError(res.error); return; }
    Analytics.archiveEntrySubmitted();
    close();
  };

  return (
    <ComposerShell
      title="Suggest a new entry"
      intro="Add something the Archive is missing. A mod checks it, then it’s live for everyone — credited to you."
      footNote="Queued for review · most entries are published within a day."
      locked={!membership.canEdit}
      onClose={close}
      error={error}
      testID="archive-add-entry"
      footer={
        <ComposerSubmit
          label="Send to mods"
          onPress={() => void send()}
          disabled={title.trim().length === 0}
          busy={busy}
          testID="archive-add-submit"
        />
      }
    >
      <ComposerField
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Title, year, type, and why it belongs here…"
        maxLength={200}
        testID="archive-add-title"
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <ComposerSubmit
            key={t}
            label={t.toUpperCase()}
            onPress={() => setMediaType(t)}
            disabled={mediaType !== t}
            testID={`archive-add-type-${t}`}
          />
        ))}
      </View>
      <ComposerField
        label="Year"
        value={year}
        onChangeText={setYear}
        placeholder="2019"
        keyboardType="number-pad"
        maxLength={4}
        testID="archive-add-year"
      />
      <ComposerField
        label="Creator"
        value={creator}
        onChangeText={setCreator}
        placeholder="Director, author or artist"
        maxLength={120}
        testID="archive-add-creator"
      />
      <ComposerField
        label="Spoiler-free summary"
        value={summary}
        onChangeText={setSummary}
        placeholder="What it is, without saying how it ends."
        multiline
        maxLength={400}
        testID="archive-add-summary"
      />
    </ComposerShell>
  );
}
