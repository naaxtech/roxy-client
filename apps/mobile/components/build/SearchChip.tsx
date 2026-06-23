import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';

interface SearchChipProps {
  label: string;
  onRemove: (label: string) => void;
}

export function SearchChip({ label, onRemove }: SearchChipProps) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary + '25',
      borderColor: colors.primary,
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginRight: 6,
      gap: 6,
    },
    label: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  });

  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => onRemove(label)} hitSlop={8}>
        <Ionicons name="close" size={14} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}
