import {
  describe,
  it,
  expect,
  render,
  fn,
  waitFor,
} from 'react-native-harness';
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

type TestComponentProps = {
  text: string;
  onMount: () => void;
  onUnmount: () => void;
};

const TestComponent = ({ text, onMount, onUnmount }: TestComponentProps) => {
  useEffect(() => {
    onMount();
    return () => {
      onUnmount();
    };
  }, [onMount, onUnmount]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
};

describe('render', () => {
  it('should mount component when render is called', async () => {
    const onMount = fn();
    const onUnmount = fn();

    const { unmount } = await render(
      <TestComponent text="Test" onMount={onMount} onUnmount={onUnmount} />
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);

    unmount();
  });

  it('should unmount component when unmount is called', async () => {
    const onMount = fn();
    const onUnmount = fn();

    const { unmount } = await render(
      <TestComponent text="Test" onMount={onMount} onUnmount={onUnmount} />
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);

    unmount();

    await waitFor(() => {
      expect(onUnmount).toHaveBeenCalledTimes(1);
    });
  });

  it('should not remount component when rerender is called', async () => {
    const onMount = fn();
    const onUnmount = fn();

    const { rerender } = await render(
      <TestComponent text="Initial" onMount={onMount} onUnmount={onUnmount} />
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);

    await rerender(
      <TestComponent text="Updated" onMount={onMount} onUnmount={onUnmount} />
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);
  });
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  text: {
    fontSize: 24,
    color: '#38bdf8',
    fontWeight: '600',
  },
});
