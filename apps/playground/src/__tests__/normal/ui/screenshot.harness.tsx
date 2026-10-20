import { describe, test, render, expect } from 'react-native-harness';
import { Dimensions, PixelRatio, View } from 'react-native';
import { screen } from '@react-native-harness/ui';

const pngSize = (data: Uint8Array) => {
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
};

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
    expect(pngSize(screenshot!.data)).toEqual({
      width: Math.round(100 * PixelRatio.get()),
      height: Math.round(100 * PixelRatio.get()),
    });
    await expect(screenshot).toMatchImageSnapshot({
      name: 'orange-square-element-only',
    });
  });
});
