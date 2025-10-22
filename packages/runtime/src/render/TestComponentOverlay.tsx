import { View, StyleSheet } from 'react-native';
import { useRenderedElement } from '../ui/state.js';
import { store } from '../ui/state.js';
import { ErrorBoundary } from './ErrorBoundary.js';

export const TestComponentOverlay = (): React.ReactElement | null => {
  const { element, key } = useRenderedElement();

  if (!element) {
    return null;
  }

  const handleLayout = (): void => {
    const callback = store.getState().onLayoutCallback;

    if (callback) {
      callback();
      // Clear the callback after calling it
      store.getState().setOnLayoutCallback(null);
    }
  };

  return (
    <View key={key} style={styles.overlay} onLayout={handleLayout}>
      <ErrorBoundary>{element}</ErrorBoundary>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a1628',
    zIndex: 1000,
  },
});
