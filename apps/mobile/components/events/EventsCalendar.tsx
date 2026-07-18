import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns';
import { useThemeColors } from '../../hooks/useThemeColors';
import { EmptyState } from '../ui/EmptyState';

export type CalendarEvent = {
  id: string;
  title: string;
  starts_at: string;
  /** e.g. community name or location — shown under the title. */
  subtitle?: string | null;
};

type Props = {
  events: CalendarEvent[];
  onEventPress: (id: string) => void;
};

/** Month calendar with event dots + tappable day agenda. Monday-first weeks. */
export function EventsCalendar({ events, onEventPress }: Props) {
  const colors = useThemeColors();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => new Date());

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  }), [month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = format(new Date(e.starts_at), 'yyyy-MM-dd');
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [events]);

  const dayEvents = eventsByDay.get(format(selected, 'yyyy-MM-dd')) ?? [];

  const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 14 },
    monthBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 8,
    },
    monthLabel: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
    navBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    weekRow: { flexDirection: 'row', marginBottom: 4 },
    weekday: {
      flex: 1, textAlign: 'center',
      color: colors.textMuted, fontSize: 11, fontWeight: '700',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: {
      width: `${100 / 7}%` as unknown as number,
      minHeight: 44, alignItems: 'center', justifyContent: 'center',
      paddingVertical: 2,
    },
    dayCircle: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    daySelected: { backgroundColor: colors.roxy },
    dayToday: { borderWidth: 1.5, borderColor: colors.roxy },
    dayText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
    dayTextOut: { color: colors.textMuted + '80' },
    dayTextSelected: { color: '#fff', fontWeight: '800' },
    dot: {
      width: 5, height: 5, borderRadius: 3,
      backgroundColor: colors.roxy, marginTop: 1,
    },
    dotHidden: { opacity: 0 },
    agendaTitle: {
      color: colors.textPrimary, fontWeight: '800', fontSize: 14,
      marginTop: 12, marginBottom: 8,
    },
    agendaRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, borderRadius: 14,
      padding: 12, marginBottom: 8,
    },
    agendaTime: { color: colors.roxy, fontWeight: '800', fontSize: 12, width: 52 },
    agendaBody: { flex: 1 },
    agendaName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    agendaSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.monthBar}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setMonth((m) => addMonths(m, -1))}
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{format(month, 'MMMM yyyy')}</Text>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setMonth((m) => addMonths(m, 1))}
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={styles.weekday}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day) => {
          const inMonth = isSameMonth(day, month);
          const isSel = isSameDay(day, selected);
          const hasEvents = eventsByDay.has(format(day, 'yyyy-MM-dd'));
          return (
            <TouchableOpacity
              key={day.toISOString()}
              style={styles.cell}
              onPress={() => setSelected(day)}
              accessibilityLabel={format(day, 'd MMMM yyyy')}
            >
              <View style={[
                styles.dayCircle,
                isSel && styles.daySelected,
                !isSel && isToday(day) && styles.dayToday,
              ]}>
                <Text style={[
                  styles.dayText,
                  !inMonth && styles.dayTextOut,
                  isSel && styles.dayTextSelected,
                ]}>
                  {format(day, 'd')}
                </Text>
              </View>
              <View style={[styles.dot, !hasEvents && styles.dotHidden]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.agendaTitle}>{format(selected, 'EEEE d MMMM')}</Text>
      {dayEvents.length === 0 ? (
        <EmptyState emoji="🗓️" title="Nothing on this day" body="Pick a day with a pink dot." />
      ) : (
        dayEvents
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .map((e) => (
            <TouchableOpacity
              key={e.id}
              style={styles.agendaRow}
              onPress={() => onEventPress(e.id)}
              activeOpacity={0.75}
              accessibilityLabel={`Open event ${e.title}`}
            >
              <Text style={styles.agendaTime}>{format(new Date(e.starts_at), 'HH:mm')}</Text>
              <View style={styles.agendaBody}>
                <Text style={styles.agendaName} numberOfLines={1}>{e.title}</Text>
                {e.subtitle ? <Text style={styles.agendaSub} numberOfLines={1}>{e.subtitle}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))
      )}
    </View>
  );
}
