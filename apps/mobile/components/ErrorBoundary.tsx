import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { logBoundaryError } from '../lib/errorLogger';
import { useThemeColors } from '../hooks/useThemeColors';

interface State { hasError: boolean; errorMessage: string | null }

interface FallbackProps {
  errorMessage: string | null;
  onRetry: () => void;
}

function ErrorFallback({ errorMessage, onRetry }: FallbackProps) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    container: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      padding: 24, backgroundColor: colors.background,
    },
    title: {
      fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 8,
    },
    devMessage: {
      fontSize: 12, color: colors.error, marginBottom: 16,
      textAlign: 'center', fontFamily: 'monospace',
    },
    retry: { color: colors.primary, fontWeight: '600', fontSize: 14, marginBottom: 16 },
    report: { color: colors.textMuted, fontWeight: '500', fontSize: 13 },
  });

  const handleReport = () => {
    router.push({
      pathname: '/(tabs)/profile/feedback',
      params: {
        category: 'bug',
        prefillMessage: errorMessage ? `App crashed: ${errorMessage}` : 'App crashed.',
      },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      {__DEV__ && errorMessage ? (
        <Text style={styles.devMessage}>{errorMessage}</Text>
      ) : null}
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retry}>Try again</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleReport} accessibilityLabel="Report this problem">
        <Text style={styles.report}>Report this</Text>
      </TouchableOpacity>
    </View>
  );
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // logBoundaryError captures JS stack + React componentStack in Crashlytics + PostHog.
    logBoundaryError(error, info.componentStack ?? '');
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          errorMessage={this.state.errorMessage}
          onRetry={() => this.setState({ hasError: false, errorMessage: null })}
        />
      );
    }
    return this.props.children;
  }
}
