import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../../lib/constants';

export default function ConnectScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Connect — coming in Session 2</Text>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: COLORS.textMuted },
});
