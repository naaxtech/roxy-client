import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';

type Props = {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  linkLabel?: string;
  onLinkPress?: () => void;
};

/** Standard section bar: icon + bold title left, roxy-colored link right. */
export function SectionHeader({ title, icon, linkLabel, onLinkPress }: Props) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      marginBottom: 10,
    },
    name: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    text: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
    link: { color: colors.roxy, fontSize: 13, fontWeight: '700', paddingVertical: 6 },
  });
  return (
    <View style={styles.bar}>
      <View style={styles.name}>
        {icon ? <Ionicons name={icon} size={15} color={colors.roxy} /> : null}
        <Text style={styles.text}>{title}</Text>
      </View>
      {linkLabel && onLinkPress ? (
        <TouchableOpacity onPress={onLinkPress} accessibilityLabel={linkLabel}>
          <Text style={styles.link}>{linkLabel} →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
