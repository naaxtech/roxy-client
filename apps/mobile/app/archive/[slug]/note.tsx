import { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ComposerShell } from '../../../components/archive/ComposerShell';
import { ComposerField, ComposerSubmit } from '../../../components/archive/ComposerField';
import { submitContentNote } from '../../../components/archive/composerActions';
import { useComposerEntry } from '../../../components/archive/useComposerEntry';
import { useMembership } from '../../../hooks/useMembership';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { NOTE_AGREEMENT_GATE } from '../../../components/archive/ContentNoteChip';

/**
 * Add a content note. Copy is the prototype's `M.cw`, verbatim.
 *
 * The prototype marks this one `lock:false` — but that is the prototype's own
 * simplification, and 096 disagrees: `archive_notes_insert_approved` requires
 * `is_approved_member()`. A pending member who typed a note here would have it
 * refused by RLS after she wrote it. The gate is honoured, and the design's
 * intent — that this is the lightest contribution — is honoured instead by the
 * copy, which explains the agreement threshold rather than the restriction.
 */
export default function AddContentNoteScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const membership = useMembership();
  const { entry, status } = useComposerEntry(slug);

  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => router.back();
  const s = StyleSheet.create({ hint: { ...TYPE.micro, color: colors.textMuted } });

  const send = async () => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    const res = await submitContentNote(entry.id, label.trim());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    close();
  };

  return (
    <ComposerShell
      title="Add a content note"
      intro="Help people decide before they press play. Notes are member-tagged and only count once others agree."
      footNote="Notes never describe endings."
      locked={!membership.canEdit}
      onClose={close}
      error={error ?? (status === 'missing' ? 'That entry is no longer in the Archive.' : null)}
      testID="archive-add-note"
      footer={
        <ComposerSubmit
          label="Add note"
          onPress={() => void send()}
          disabled={label.trim().length < 2 || status !== 'ready'}
          busy={busy}
          testID="archive-note-submit"
        />
      }
    >
      <ComposerField
        label="What is in it"
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. on-screen biphobia, hospital scenes…"
        maxLength={60}
        testID="archive-note-label"
      />
      <Text style={s.hint}>
        It appears on the card once {NOTE_AGREEMENT_GATE} members agree — so no one is
        labelling a whole title on their own.
      </Text>
    </ComposerShell>
  );
}
