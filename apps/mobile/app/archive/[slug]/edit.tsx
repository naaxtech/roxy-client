import { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ComposerShell } from '../../../components/archive/ComposerShell';
import { ComposerField, ComposerSubmit } from '../../../components/archive/ComposerField';
import { submitEdit, type EntryDraft } from '../../../components/archive/composerActions';
import { useComposerEntry } from '../../../components/archive/useComposerEntry';
import { useMembership } from '../../../hooks/useMembership';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { Analytics } from '../../../lib/analytics';

/**
 * Suggest an edit. Copy is the prototype's `M.edit`, verbatim.
 *
 * Pre-filled with the live row, and only the fields she actually CHANGED are
 * sent. Sending the whole form would queue a revision whose diff is every
 * field, and a mod reviewing that cannot see what she meant to change — the
 * studio's diff builder deliberately diffs the patch's own keys for the same
 * reason.
 */
export default function SuggestEditScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const membership = useMembership();
  const { entry, status } = useComposerEntry(slug);

  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [lengthLabel, setLengthLabel] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setTitle(entry.title);
    setCreator(entry.creator ?? '');
    setLengthLabel(entry.length_label ?? '');
    setSummary(entry.summary ?? '');
  }, [entry]);

  const close = () => router.back();
  const s = StyleSheet.create({ hint: { ...TYPE.micro, color: colors.textMuted } });

  /** Only what differs from the live row. An unchanged field is not a proposal. */
  const changedFields = (): Partial<EntryDraft> => {
    if (!entry) return {};
    const patch: Partial<EntryDraft> = {};
    if (title.trim() && title.trim() !== entry.title) patch.title = title.trim();
    if (creator.trim() !== (entry.creator ?? '')) patch.creator = creator.trim() || null;
    if (lengthLabel.trim() !== (entry.length_label ?? '')) patch.length_label = lengthLabel.trim() || null;
    if (summary.trim() !== (entry.summary ?? '')) patch.summary = summary.trim() || null;
    return patch;
  };

  const send = async () => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    const res = await submitEdit(entry.id, changedFields());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    Analytics.archiveEditSubmitted(entry.slug);
    close();
  };

  const intro = entry
    ? `Fix a detail on “${entry.title}”. Edits are queued for a mod, then published with your name on the revision.`
    : 'Edits are queued for a mod, then published with your name on the revision.';

  return (
    <ComposerShell
      title="Suggest an edit"
      intro={intro}
      footNote="Queued for review · you’ll get a notification either way."
      locked={!membership.canEdit}
      onClose={close}
      error={error ?? (status === 'missing' ? 'That entry is no longer in the Archive.' : null)}
      testID="archive-suggest-edit"
      footer={
        <ComposerSubmit
          label="Send to mods"
          onPress={() => void send()}
          disabled={status !== 'ready' || Object.keys(changedFields()).length === 0}
          busy={busy}
          testID="archive-edit-submit"
        />
      }
    >
      <ComposerField label="Title" value={title} onChangeText={setTitle} maxLength={200} testID="archive-edit-title" />
      <ComposerField label="Creator" value={creator} onChangeText={setCreator} maxLength={120} testID="archive-edit-creator" />
      <ComposerField label="Length" value={lengthLabel} onChangeText={setLengthLabel} placeholder="2h 2m · 848 pages · 12 tracks" maxLength={40} testID="archive-edit-length" />
      <ComposerField label="Spoiler-free summary" value={summary} onChangeText={setSummary} multiline maxLength={400} testID="archive-edit-summary" />
      <Text style={s.hint}>Only what you change is sent, so a mod sees exactly what you meant.</Text>
    </ComposerShell>
  );
}
