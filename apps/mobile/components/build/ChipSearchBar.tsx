import { useState } from 'react';
import { View, TextInput, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';
import { SearchChip } from './SearchChip';

interface ChipSearchBarProps {
  chips: string[];
  onAddChip: (chip: string) => void;
  onRemoveChip: (chip: string) => void;
}

export function ChipSearchBar({ chips, onAddChip, onRemoveChip }: ChipSearchBarProps) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddChip(trimmed);
    setText('');
  };

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={styles.input}
        placeholder="Search businesses…"
        placeholderTextColor={COLORS.textMuted}
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        returnKeyType="search"
        blurOnSubmit={false}
      />
      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {chips.map((chip) => (
            <SearchChip key={chip} label={chip} onRemove={onRemoveChip} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6, paddingHorizontal: 12, paddingTop: 8 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  chipRow: { maxHeight: 36 },
  chipRowContent: { alignItems: 'center', paddingBottom: 4 },
});
