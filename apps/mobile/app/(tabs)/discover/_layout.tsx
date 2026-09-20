import { Stack } from 'expo-router';
import { FeatureGate } from '../../../components/features/FeatureGate';

export default function DiscoverLayout() {
  return (
    <FeatureGate feature="discover">
      <Stack screenOptions={{ headerShown: false }} />
    </FeatureGate>
  );
}
