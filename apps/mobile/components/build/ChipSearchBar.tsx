import { useState } from 'react';
import { View, TextInput, ScrollView, StyleSheet } from 'react-native';
import { SearchChip } from './SearchChip';
import { useThemeColors } from '../../hooks/useThemeColors';

interface ChipSearchBarProps {
  chips: string[];
  onAddChip: (chip: string) => void;
  onRemoveChip: (chip: string) => void;
}

export function ChipSearchBar({ chips, onAddChip, onRemoveChip }: ChipSearchBarProps) {
  const colors = useThemeColors();
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddChip(trimmed);
    setText('');
  };

  const styles = StyleSheet.create({
    wrapper: { gap: 6, paddingHorizontal: 12, paddingTop: 8 },
    input: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.textPrimary,
      fontSize: 14,
    },
    chipRow: { maxHeight: 36 },
    chipRowContent: { alignItems: 'center', paddingBottom: 4 },
  });

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={styles.input}
        placeholder="Search businesses…"
        placeholderTextColor={colors.textMuted}
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

