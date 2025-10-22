import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset error state when children change (new component rendered)
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  override render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <View style={styles.errorContainer}>
          <View style={styles.errorContent}>
            <Text style={styles.errorTitle}>Component Error</Text>
            <Text style={styles.errorSubtitle}>
              The rendered component threw an error:
            </Text>
            <ScrollView style={styles.errorScrollView}>
              <Text style={styles.errorMessage}>
                {this.state.error.message}
              </Text>
              {this.state.error.stack && (
                <Text style={styles.errorStack}>{this.state.error.stack}</Text>
              )}
            </ScrollView>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorContent: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 20,
    maxWidth: 500,
    width: '100%',
    maxHeight: '80%',
    borderWidth: 2,
    borderColor: '#dc2626',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#dc2626',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
  },
  errorScrollView: {
    maxHeight: 400,
  },
  errorMessage: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fca5a5',
    marginBottom: 12,
    fontFamily: 'Courier',
  },
  errorStack: {
    fontSize: 12,
    color: '#d1d5db',
    fontFamily: 'Courier',
    lineHeight: 18,
  },
});
