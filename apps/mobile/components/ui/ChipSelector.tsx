import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface Props {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  max?: number;
}

export function ChipSelector({ options, selected, onToggle, max }: Props) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    container: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
      borderWidth: 1.5, borderColor: colors.textMuted,
    },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipDisabled: { opacity: 0.4 },
    label: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    labelSelected: { color: colors.textPrimary },
  });

  return (
    <View style={styles.container}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt);
        const isDisabled = !isSelected && max !== undefined && selected.length >= max;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, isSelected && styles.chipSelected, isDisabled && styles.chipDisabled]}
            onPress={() => !isDisabled && onToggle(opt)}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
