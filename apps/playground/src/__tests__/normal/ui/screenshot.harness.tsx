import { describe, test, render, expect } from 'react-native-harness';
import { createRef } from 'react';
import { Dimensions, PixelRatio, View } from 'react-native';
import { screen } from '@react-native-harness/ui';

const pngSize = (data: Uint8Array) => {
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
};

// Captures round each edge of the element to a whole pixel, so a fractional
// size covers one pixel more or less depending on where the element sits.
const capturedSize = (view: View) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    view.measureInWindow((x, y, width, height) => {
      const ratio = PixelRatio.get();
      resolve({
        width: Math.round((x + width) * ratio) - Math.round(x * ratio),
        height: Math.round((y + height) * ratio) - Math.round(y * ratio),
      });
    });
  });

describe('Screenshot', () => {
  test('should screenshot the full window without bounds', async () => {
    await render(<View style={{ flex: 1, backgroundColor: 'orange' }} />);

    const screenshot = await screen.screenshot();
    expect(screenshot).not.toBeNull();
    const size = pngSize(screenshot!.data);
    expect(size.width).toBe(
      Math.round(Dimensions.get('window').width * PixelRatio.get())
    );
    expect(size.height).toBeGreaterThan(0);
  });

  test('should screenshot explicit bounds', async () => {
    await render(<View style={{ flex: 1, backgroundColor: 'orange' }} />);

    const screenshot = await screen.screenshot({
      x: 0,
      y: 0,
      width: 64,
      height: 48,
    });
    expect(screenshot).not.toBeNull();
    expect(pngSize(screenshot!.data)).toEqual({
      width: Math.round(64 * PixelRatio.get()),
      height: Math.round(48 * PixelRatio.get()),
    });
  });

  test('should screenshot specific element only', async () => {
    const targetRef = createRef<View>();
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            width: 200,
            height: 200,
            backgroundColor: 'gray',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            ref={targetRef}
            testID="target-element"
            style={{
              width: 100,
              height: 100,
              backgroundColor: 'orange',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <View style={{ width: 50, height: 50, backgroundColor: 'white' }} />
          </View>
        </View>
      </View>
    );

    const targetElement = await screen.findByTestId('target-element');
    const screenshot = await screen.screenshot(targetElement);
    expect(screenshot).not.toBeNull();
    expect(pngSize(screenshot!.data)).toEqual(
      await capturedSize(targetRef.current!)
    );
    await expect(screenshot).toMatchImageSnapshot({
      name: 'orange-square-element-only',
    });
  });
});
