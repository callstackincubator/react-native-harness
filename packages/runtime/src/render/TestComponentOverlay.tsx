import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRenderedElement } from '../ui/state.js';
import { store } from '../ui/state.js';
import { ErrorBoundary } from './ErrorBoundary.js';

/**
 * Waits for the native view hierarchy to be fully updated.
 * Uses double requestAnimationFrame to ensure native has processed
 * all view creation commands after React's commit phase.
 */
const waitForNativeViewHierarchy = (): Promise<void> => {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
};

export const TestComponentOverlay = (): React.ReactElement | null => {
  const { element, key } = useRenderedElement();

  useEffect(() => {
    // Call onRenderCallback when element changes
    const callback = store.getState().onRenderCallback;

    if (callback) {
      // Wait for native view hierarchy to be fully updated before calling callback.
      // useEffect fires after React commits, but native processes commands async.
      // Double rAF ensures native has finished processing all view creation.
      waitForNativeViewHierarchy().then(() => {
        callback();
        store.getState().setOnRenderCallback(null);
      });
    }
  }, [element]);

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
