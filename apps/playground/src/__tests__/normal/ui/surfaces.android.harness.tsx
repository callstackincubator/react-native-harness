import { createRef } from 'react';
import { describe, test, render, expect, waitFor } from 'react-native-harness';
import { Dimensions, ScrollView, View } from 'react-native';
import { screen } from '@react-native-harness/ui';

import {
  RootShiftView,
  SolidColorSurfaceView,
  SolidColorTextureView,
  SplitColorSurfaceView,
  SplitColorVideoView,
} from '../../../native/PaintedSurfaces';

describe('Screenshot of views drawn on a surface of their own', () => {
  test('shows what a TextureView and a SurfaceView display', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <SolidColorTextureView
          testID="texture-view"
          style={{ width: 96, height: 96 }}
        />
        <SolidColorSurfaceView
          testID="surface-view"
          style={{ width: 96, height: 96 }}
        />
      </View>
    );
    await screen.findByAccessibilityLabel('texture-view-painted');
    await screen.findByAccessibilityLabel('surface-view-painted');

    const textureView = await screen.findByTestId('texture-view');
    await expect(await screen.screenshot(textureView)).toMatchImageSnapshot({
      name: 'texture-view-red',
    });

    const surfaceView = await screen.findByTestId('surface-view');
    await expect(await screen.screenshot(surfaceView)).toMatchImageSnapshot({
      name: 'surface-view-blue',
    });
  });

  test('places a SurfaceView at its offset, under the views drawn over it', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          testID="surfaces"
          style={{ flexDirection: 'row', padding: 8, backgroundColor: 'white' }}
        >
          <SolidColorTextureView style={{ width: 96, height: 96 }} />
          <SolidColorSurfaceView
            style={{ width: 96, height: 96, marginLeft: 8 }}
          />
          <View
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 48,
              height: 48,
              backgroundColor: 'green',
            }}
          />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('texture-view-painted');
    await screen.findByAccessibilityLabel('surface-view-painted');

    const surfaces = await screen.findByTestId('surfaces');
    await expect(await screen.screenshot(surfaces)).toMatchImageSnapshot({
      name: 'surfaces-overlapped',
    });
  });

  test('draws a SurfaceView under a scale transform at the size the screen shows it', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View testID="scaled-surface" style={{ transform: [{ scale: 0.5 }] }}>
          <SplitColorSurfaceView style={{ width: 96, height: 96 }} />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('split-surface-view-painted');

    const scaledSurface = await screen.findByTestId('scaled-surface');
    await expect(await screen.screenshot(scaledSurface)).toMatchImageSnapshot({
      name: 'surface-view-scaled',
    });
  });

  test('copies only the part of a SurfaceView inside the captured region', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View>
          <SplitColorSurfaceView style={{ width: 96, height: 96 }} />
          <View
            testID="right-half"
            collapsable={false}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 48,
              height: 96,
            }}
          />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('split-surface-view-painted');

    const rightHalf = await screen.findByTestId('right-half');
    await expect(await screen.screenshot(rightHalf)).toMatchImageSnapshot({
      name: 'surface-view-right-half',
    });
  });

  test('draws a SurfaceView under a fractional scale into the box the screen shows it in', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          testID="fractionally-scaled-surface"
          style={{ transform: [{ scale: 0.35 }] }}
        >
          <SplitColorSurfaceView style={{ width: 96, height: 96 }} />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('split-surface-view-painted');

    const scaledSurface = await screen.findByTestId(
      'fractionally-scaled-surface'
    );
    await expect(await screen.screenshot(scaledSurface)).toMatchImageSnapshot({
      name: 'surface-view-fractional-scale',
    });
  });

  test('draws a SurfaceView under a half-pixel translation into the box the screen shows it in', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          testID="half-pixel-translated-surface"
          style={{ transform: [{ translateX: 4 }] }}
        >
          <SplitColorSurfaceView style={{ width: 96, height: 96 }} />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('split-surface-view-painted');

    const translatedSurface = await screen.findByTestId(
      'half-pixel-translated-surface'
    );
    await expect(
      await screen.screenshot(translatedSurface)
    ).toMatchImageSnapshot({
      name: 'surface-view-half-pixel-translation',
    });
  });

  test('draws a SurfaceView under an enlarging scale into the box the screen shows it in', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View testID="enlarged-surface" style={{ transform: [{ scale: 1.5 }] }}>
          <SplitColorSurfaceView style={{ width: 96, height: 96 }} />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('split-surface-view-painted');

    const enlargedSurface = await screen.findByTestId('enlarged-surface');
    await expect(await screen.screenshot(enlargedSurface)).toMatchImageSnapshot(
      {
        name: 'surface-view-enlarged',
      }
    );
  });

  test('copies a video frame larger than its SurfaceView at the size the screen shows it', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <SplitColorVideoView
          testID="video-surface"
          style={{ width: 96, height: 54 }}
        />
      </View>
    );
    await screen.findByAccessibilityLabel('split-video-painted');

    const videoSurface = await screen.findByTestId('video-surface');
    await expect(await screen.screenshot(videoSurface)).toMatchImageSnapshot({
      name: 'video-surface-view',
    });
  });

  test('captures the window while a SurfaceView is scaled to nothing', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ transform: [{ scale: 0 }] }}>
          <SplitColorSurfaceView style={{ width: 96, height: 96 }} />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('split-surface-view-painted');

    expect(await screen.screenshot()).not.toBeNull();
  });
});

describe('Screenshot of an element by the box it covers on the screen', () => {
  test('draws an element scaled to nothing as the element draws itself', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          testID="scaled-to-nothing"
          style={{
            width: 40,
            height: 40,
            backgroundColor: 'red',
            transform: [{ scaleY: 0 }],
          }}
        />
      </View>
    );

    const scaledToNothing = await screen.findByTestId('scaled-to-nothing');
    await expect(await screen.screenshot(scaledToNothing)).toMatchImageSnapshot(
      { name: 'element-scaled-to-nothing' }
    );
  });

  test("captures an element where it is drawn when the window's root view moves", async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <RootShiftView rootTranslationY={40.2} />
        <View
          testID="under-moved-root"
          style={{ width: 48, height: 48, backgroundColor: 'green' }}
        />
      </View>
    );

    const underMovedRoot = await screen.findByTestId('under-moved-root');
    await expect(await screen.screenshot(underMovedRoot)).toMatchImageSnapshot({
      name: 'element-under-moved-root',
    });
  });

  test('captures an element under nested rotations in the box it covers on the screen', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ transform: [{ rotate: '45deg' }] }}>
          <View
            testID="counter-rotated"
            style={{
              width: 48,
              height: 48,
              backgroundColor: 'red',
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      </View>
    );

    const counterRotated = await screen.findByTestId('counter-rotated');
    await expect(await screen.screenshot(counterRotated)).toMatchImageSnapshot({
      name: 'element-under-nested-rotations',
    });
  });

  test('draws an element clipped out of the view tree as the element draws itself', async () => {
    const clippingTree = (top: number) => (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          removeClippedSubviews
          style={{ width: 96, height: 96, overflow: 'hidden' }}
        >
          <View
            testID="clipped"
            style={{
              position: 'absolute',
              top,
              width: 48,
              height: 48,
              backgroundColor: 'red',
              overflow: 'hidden',
            }}
          />
        </View>
      </View>
    );
    const { rerender } = await render(clippingTree(0));
    const clipped = await screen.findByTestId('clipped');
    await rerender(clippingTree(200));
    await waitFor(() => expect(screen.queryByTestId('clipped')).toBeNull());

    await expect(await screen.screenshot(clipped)).toMatchImageSnapshot({
      name: 'element-clipped-out',
    });
  });

  test('draws a scrolled element partly off the screen at its scroll offset', async () => {
    const scrollView = createRef<ScrollView>();
    let onScrolledToBlue: () => void = () => undefined;
    const scrolledToBlue = new Promise<void>((resolve) => {
      onScrolledToBlue = resolve;
    });
    await render(
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollView}
          testID="scrolled-off-screen"
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={({ nativeEvent }) => {
            if (nativeEvent.contentOffset.x >= 95.5) {
              onScrolledToBlue();
            }
          }}
          style={{
            position: 'absolute',
            top: 96,
            left: -48,
            width: 96,
            height: 96,
          }}
        >
          <View style={{ width: 96, height: 96, backgroundColor: 'red' }} />
          <View style={{ width: 96, height: 96, backgroundColor: 'blue' }} />
        </ScrollView>
      </View>
    );
    scrollView.current?.scrollTo({ x: 96, animated: false });
    await scrolledToBlue;

    const scrolledOffScreen = await screen.findByTestId('scrolled-off-screen');
    await expect(
      await screen.screenshot(scrolledOffScreen)
    ).toMatchImageSnapshot({ name: 'element-scrolled-off-screen' });
  });
});

describe('Screenshot of a region past the edge of the window', () => {
  test('leaves the part off the window transparent', async () => {
    await render(
      <View style={{ flex: 1 }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: -48,
            width: 96,
            backgroundColor: 'red',
          }}
        />
      </View>
    );

    const { height } = Dimensions.get('window');
    await expect(
      await screen.screenshot({
        x: -24,
        y: height / 2 - 24,
        width: 48,
        height: 48,
      })
    ).toMatchImageSnapshot({ name: 'region-past-window-edge' });
  });
});
