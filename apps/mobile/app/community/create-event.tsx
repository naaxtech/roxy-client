import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { showAlert } from '../../lib/confirm';
import { logError } from '../../lib/errorLogger';
import { canCreateEvent } from '../../lib/createAccess';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

type EventMode = 'online' | 'in_person';

function combineStart(date: string, time: string): string | null {
  if (!date.trim() || !time.trim()) return null;
  const iso = new Date(`${date.trim()}T${time.trim()}`);
  if (Number.isNaN(iso.getTime())) return null;
  return iso.toISOString();
}

/**
 * Claude Design: "Event composer — online or in person, one object."
 * Only official community accounts host from the phone.
 */
export default function CreateEventScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const profile = useProfileStore((s) => s.profile);
  const officialId = profile?.official_community_id ?? null;

  const [mode, setMode] = useState<EventMode>('in_person');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    cancel: { color: colors.primary, fontSize: 15 },
    title: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    publish: {
      backgroundColor: colors.primary, paddingHorizontal: 16,
      paddingVertical: 8, borderRadius: 20, minHeight: 36, justifyContent: 'center',
    },
    publishText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    body: { padding: 16, gap: 14 },
    label: { ...TYPE.caption, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.4 },
    modes: { flexDirection: 'row', gap: 8 },
    mode: {
      flex: 1, minHeight: MIN_TOUCH_TARGET, borderRadius: RADII.pill,
      borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
    },
    modeOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    modeText: { color: colors.textSecondary, fontWeight: '700' },
    modeTextOn: { color: '#fff' },
    input: {
      borderRadius: RADII.md, backgroundColor: colors.surface,
      color: colors.textPrimary, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    },
    hint: { ...TYPE.caption, color: colors.textMuted },
  });

  const publish = async () => {
    if (submitting) return;
    if (!canCreateEvent(profile) || !officialId || !user?.id) {
      showAlert('Community accounts only', 'Events are for official community profiles.');
      return;
    }
    if (!title.trim()) {
      showAlert('Add a title', 'Name the event so people know what they are joining.');
      return;
    }
    const startsAt = combineStart(date, time);
    if (!startsAt) {
      showAlert('When is it?', 'Add a date (YYYY-MM-DD) and a time (HH:MM).');
      return;
    }
    if (mode === 'in_person' && !place.trim()) {
      showAlert('Where is it?', 'Add a venue for an in-person event.');
      return;
    }
    if (mode === 'online' && !place.trim()) {
      showAlert('Where do they join?', 'Add a room link or say it is a Roxy room.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from('events').insert({
      title: title.trim(),
      host_id: user.id,
      community_id: officialId,
      event_type: mode,
      starts_at: startsAt,
      description: description.trim() || null,
      location_text: mode === 'in_person' ? place.trim() : null,
      location_url: mode === 'online' ? place.trim() : null,
      is_paid: false,
    });
    setSubmitting(false);
    if (error) {
      logError(error, 'createEvent_insert');
      showAlert('Could not create the event', 'Please try again.');
      return;
    }
    router.replace('/you');
  };

  return (
    <SafeAreaView style={s.container} testID="create-event">
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={s.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>New Event</Text>
        <TouchableOpacity onPress={() => void publish()} disabled={submitting} style={s.publish}>
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.publishText}>Publish</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>WHERE</Text>
        <View style={s.modes}>
          <TouchableOpacity
            style={[s.mode, mode === 'in_person' && s.modeOn]}
            onPress={() => setMode('in_person')}
            testID="event-mode-in-person"
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'in_person' }}
          >
            <Text style={[s.modeText, mode === 'in_person' && s.modeTextOn]}>In person</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.mode, mode === 'online' && s.modeOn]}
            onPress={() => setMode('online')}
            testID="event-mode-online"
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'online' }}
          >
            <Text style={[s.modeText, mode === 'online' && s.modeTextOn]}>Online</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.label}>TITLE</Text>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Sapphic Cinema Night"
          placeholderTextColor={colors.textMuted}
          testID="event-title"
        />

        <Text style={s.label}>DATE · YYYY-MM-DD</Text>
        <TextInput
          style={s.input}
          value={date}
          onChangeText={setDate}
          placeholder="2026-09-12"
          placeholderTextColor={colors.textMuted}
          testID="event-date"
        />

        <Text style={s.label}>TIME · HH:MM</Text>
        <TextInput
          style={s.input}
          value={time}
          onChangeText={setTime}
          placeholder="19:00"
          placeholderTextColor={colors.textMuted}
          testID="event-time"
        />

        <Text style={s.label}>{mode === 'online' ? 'JOIN LINK' : 'VENUE'}</Text>
        <TextInput
          style={s.input}
          value={place}
          onChangeText={setPlace}
          placeholder={mode === 'online' ? 'https://… or “Roxy room”' : 'Rio Cinema, Dalston'}
          placeholderTextColor={colors.textMuted}
          testID="event-place"
        />

        <Text style={s.label}>ABOUT (OPTIONAL)</Text>
        <TextInput
          style={[s.input, { minHeight: 96, textAlignVertical: 'top' }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Two classic wlw films back-to-back. Discussion after."
          placeholderTextColor={colors.textMuted}
          multiline
        />

        <Text style={s.hint}>
          This event sits on your community profile. Tickets stay free from the phone — paid tiers stay in Studio.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
