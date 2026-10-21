import { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ComposerShell } from '../../../components/archive/ComposerShell';
import { ComposerField, ComposerSubmit } from '../../../components/archive/ComposerField';
import { submitEdit, type EntryDraft } from '../../../components/archive/composerActions';
import { useComposerEntry } from '../../../components/archive/useComposerEntry';
import { useMembership } from '../../../hooks/useMembership';
import { useArchiveStore } from '../../../store/archiveStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { Analytics } from '../../../lib/analytics';

/** The line the entry shows after an edit is sent (design direction › Archive). */
export const EDIT_SENT_COPY = 'Sent to the Archive team. It shows here once it’s approved.';

/** A cover link must be a web image link; the edge function stores it as is. */
export const COVER_LINK_ERROR = 'Use a link that starts with https://';

/** The fields she may propose here, plus the cover link (M158 + v2 covers). */
type EditPatch = Partial<EntryDraft> & { cover_url?: string | null };

/**
 * Suggest an edit (M158), the one way a member changes an Archive entry: a
 * revision queued for the Archive team (S041 in Studio), published with her
 * name on it.
 *
 * v2 adds the cover. "Add a cover" on an entry opens this screen with
 * `?focus=cover`, which focuses the cover field. The member pastes a link to
 * the cover image; `archive-submit-edit` already accepts `cover_url` in its
 * whitelist, and the team checks it before it shows (staff can also upload a
 * cover directly in Studio, S039).
 *
 * Pre-filled with the live row, and only the fields she actually CHANGED are
 * sent. Sending the whole form would queue a revision whose diff is every
 * field, and the team reviewing it cannot see what she meant to change.
 */
export default function SuggestEditScreen() {
  const { slug, focus } = useLocalSearchParams<{ slug: string; focus?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const membership = useMembership();
  const { entry, status } = useComposerEntry(slug);
  const focusCover = focus === 'cover';

  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [lengthLabel, setLengthLabel] = useState('');
  const [summary, setSummary] = useState('');
  const [cover, setCover] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const liveCover = entry?.cover_url ?? '';

  useEffect(() => {
    if (!entry) return;
    setTitle(entry.title);
    setCreator(entry.creator ?? '');
    setLengthLabel(entry.length_label ?? '');
    setSummary(entry.summary ?? '');
    setCover(entry.cover_url ?? '');
  }, [entry]);

  const close = () => router.back();
  const s = StyleSheet.create({ hint: { ...TYPE.meta, color: colors.ink3 } });

  /** Only what differs from the live row. An unchanged field is not a proposal. */
  const changedFields = (): EditPatch => {
    if (!entry) return {};
    const patch: EditPatch = {};
    if (title.trim() && title.trim() !== entry.title) patch.title = title.trim();
    if (creator.trim() !== (entry.creator ?? '')) patch.creator = creator.trim() || null;
    if (lengthLabel.trim() !== (entry.length_label ?? '')) patch.length_label = lengthLabel.trim() || null;
    if (summary.trim() !== (entry.summary ?? '')) patch.summary = summary.trim() || null;
    if (cover.trim() !== liveCover) patch.cover_url = cover.trim() || null;
    return patch;
  };

  const send = async () => {
    if (!entry) return;
    const patch = changedFields();
    if (patch.cover_url && !/^https:\/\/\S+$/i.test(patch.cover_url)) {
      setError(COVER_LINK_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await submitEdit(entry.id, patch);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    Analytics.archiveEditSubmitted(entry.slug);
    useArchiveStore.getState().setFlash(EDIT_SENT_COPY);
    close();
  };

  const intro = entry
    ? `Fix a detail on “${entry.title}” or add its cover. The Archive team checks every edit, then publishes it with your name on it.`
    : 'The Archive team checks every edit, then publishes it with your name on it.';

  return (
    <ComposerShell
      title="Suggest an edit"
      intro={intro}
      // True since 133: notify_archive_revision writes her a notification on
      // approve and on reject (ARC-09).
      footNote="You’ll get a notification either way."
      locked={!membership.canEdit}
      onClose={close}
      error={error ?? (status === 'missing' ? 'That entry is no longer in the Archive.' : null)}
      testID="archive-suggest-edit"
      footer={
        <ComposerSubmit
          label="Send to the Archive team"
          onPress={() => void send()}
          disabled={status !== 'ready' || Object.keys(changedFields()).length === 0}
          busy={busy}
          testID="archive-edit-submit"
        />
      }
    >
      <ComposerField
        label="Cover image link"
        value={cover}
        onChangeText={setCover}
        placeholder="https://"
        keyboardType="url"
        maxLength={300}
        autoFocus={focusCover}
        testID="archive-edit-cover"
      />
      <Text style={s.hint}>A link to the poster or book cover. Nothing written over it, no fan art.</Text>
      <ComposerField label="Title" value={title} onChangeText={setTitle} maxLength={200} testID="archive-edit-title" />
      <ComposerField label="Creator" value={creator} onChangeText={setCreator} maxLength={120} testID="archive-edit-creator" />
      <ComposerField label="Length" value={lengthLabel} onChangeText={setLengthLabel} placeholder="2h 2m · 848 pages · 12 tracks" maxLength={40} testID="archive-edit-length" />
      <ComposerField label="Spoiler-free summary" value={summary} onChangeText={setSummary} multiline maxLength={400} testID="archive-edit-summary" />
      <Text style={s.hint}>Only what you change is sent, so the team sees exactly what you meant.</Text>
    </ComposerShell>
  );
}
