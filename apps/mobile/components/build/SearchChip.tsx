import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { COLORS } from '../../lib/constants';

interface SearchChipProps {
  label: string;
  onRemove: (label: string) => void;
}

export function SearchChip({ label, onRemove }: SearchChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => onRemove(label)} hitSlop={8}>
        <Text style={styles.remove}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '25',
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    gap: 6,
  },
  label: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  remove: { color: COLORS.primary, fontSize: 15, fontWeight: '700', lineHeight: 18 },
});
