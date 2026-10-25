import { describe, test, render, expect } from 'react-native-harness';
import { createRef } from 'react';
import { PixelRatio, View } from 'react-native';
import { screen } from '@react-native-harness/ui';

const getPngSize = (data: Uint8Array) => {
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
};

const describeSize = (screenshot: { data: Uint8Array } | null) => {
  if (screenshot === null) return 'null';
  const { width, height } = getPngSize(screenshot.data);
  return `${width}x${height}`;
};

describe('Region screenshot geometry', () => {
  test('captures a region at the same size as the element it covers', async () => {
    const boxRef = createRef<View>();

    await render(
      <View style={{ flex: 1 }}>
        <View
          ref={boxRef}
          testID="box"
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            width: 33,
            height: 33,
            backgroundColor: 'red',
          }}
        />
      </View>
    );

    // Use the box's real window bounds so the region lines up with it
    // regardless of safe-area or status-bar offsets.
    const bounds = await new Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>((resolve) => {
      boxRef.current?.measureInWindow((x, y, width, height) =>
        resolve({ x, y, width, height })
      );
    });

    const element = await screen.screenshot(await screen.findByTestId('box'));
    const region = await screen.screenshot(bounds);
    const density = `density ${PixelRatio.get()}`;

    expect(`region ${describeSize(region)} at ${density}`).toBe(
      `region ${describeSize(element)} at ${density}`
    );
  });
});
