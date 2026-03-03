import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { useProfileStore } from '../store/profileStore';
import { supabase } from '../lib/supabase';
import { DevPanel } from '../components/dev/DevPanel';

export default function RootLayout() {
  const { user, loading } = useAuth();
  const { profile, setProfile } = useProfileStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';

    if (!user && !inAuth) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (user && inAuth) {
      // User just signed in — check if onboarding is complete
      supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) {
            router.replace('/(auth)/onboarding/step1-identity');
          } else {
            setProfile(data);
            router.replace('/(tabs)/grow');
          }
        });
      return;
    }

    if (user && !inAuth && !profile) {
      // Already in tabs but profile not loaded — fetch it
      supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setProfile(data);
          else router.replace('/(auth)/onboarding/step1-identity');
        });
    }
  }, [user, loading, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
        {__DEV__ && <DevPanel />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
