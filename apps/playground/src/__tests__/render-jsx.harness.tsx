import {
  describe,
  it,
  expect,
  render,
  fn,
  waitFor,
} from 'react-native-harness';
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';

type TestComponentProps = {
  children?: React.ReactNode;
  onMount?: () => void;
  onUnmount?: () => void;
};

const TestComponent = ({
  children,
  onMount,
  onUnmount,
}: TestComponentProps) => {
  useEffect(() => {
    onMount?.();
    return () => {
      onUnmount?.();
    };
  }, [onMount, onUnmount]);

  return <View>{children}</View>;
};

describe('render', () => {
  it('should mount component when render is called', async () => {
    const onMount = fn();
    const onUnmount = fn();

    const { unmount } = await render(
      <TestComponent onMount={onMount} onUnmount={onUnmount}>
        <Text>Test</Text>
      </TestComponent>
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);

    unmount();
  });

  it('should unmount component when unmount is called', async () => {
    const onMount = fn();
    const onUnmount = fn();

    const { unmount } = await render(
      <TestComponent onMount={onMount} onUnmount={onUnmount}>
        <Text>Test</Text>
      </TestComponent>
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
      <TestComponent onMount={onMount} onUnmount={onUnmount}>
        <Text>Initial</Text>
      </TestComponent>
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);

    await rerender(
      <TestComponent onMount={onMount} onUnmount={onUnmount}>
        <Text>Updated</Text>
      </TestComponent>
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).toHaveBeenCalledTimes(0);
  });

  it('should mount wrapper when render with wrapper is called', async () => {
    const onWrapperMount = fn();
    const onWrapperUnmount = fn();

    const { unmount } = await render(<Text>Child</Text>, {
      wrapper: ({ children }) => (
        <TestComponent onMount={onWrapperMount} onUnmount={onWrapperUnmount}>
          {children}
        </TestComponent>
      ),
    });

    expect(onWrapperMount).toHaveBeenCalledTimes(1);
    expect(onWrapperUnmount).toHaveBeenCalledTimes(0);

    unmount();
  });

  it('should unmount wrapper when unmount is called', async () => {
    const onWrapperMount = fn();
    const onWrapperUnmount = fn();

    const { unmount } = await render(<Text>Child</Text>, {
      wrapper: ({ children }) => (
        <TestComponent onMount={onWrapperMount} onUnmount={onWrapperUnmount}>
          {children}
        </TestComponent>
      ),
    });

    expect(onWrapperMount).toHaveBeenCalledTimes(1);

    unmount();

    await waitFor(() => {
      expect(onWrapperUnmount).toHaveBeenCalledTimes(1);
    });
  });

  it('should not remount wrapper when component is rerendered', async () => {
    const onWrapperMount = fn();
    const onWrapperUnmount = fn();

    const { rerender } = await render(<Text>Initial</Text>, {
      wrapper: ({ children }) => (
        <TestComponent onMount={onWrapperMount} onUnmount={onWrapperUnmount}>
          {children}
        </TestComponent>
      ),
    });

    expect(onWrapperMount).toHaveBeenCalledTimes(1);

    await rerender(<Text>Updated</Text>);

    expect(onWrapperMount).toHaveBeenCalledTimes(1);
    expect(onWrapperUnmount).toHaveBeenCalledTimes(0);
  });
});
