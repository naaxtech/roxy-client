import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logBoundaryError } from '../lib/errorLogger';
import { COLORS } from '../lib/constants';

interface State { hasError: boolean; errorMessage: string | null }

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
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          {__DEV__ && this.state.errorMessage ? (
            <Text style={styles.devMessage}>{this.state.errorMessage}</Text>
          ) : null}
          <TouchableOpacity onPress={() => this.setState({ hasError: false, errorMessage: null })}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, backgroundColor: COLORS.background,
  },
  title: {
    fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8,
  },
  devMessage: {
    fontSize: 12, color: COLORS.error, marginBottom: 16,
    textAlign: 'center', fontFamily: 'monospace',
  },
  retry: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
});
