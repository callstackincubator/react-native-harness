import { describe, test, render, expect } from 'react-native-harness';
import { Platform, View } from 'react-native';
import { screen } from '@react-native-harness/ui';

describe('Screenshot of an unavailable element', () => {
  test('returns null for an element of zero size instead of the whole window', async () => {
    if (Platform.OS === 'web') {
      return;
    }

    await render(
      <View style={{ flex: 1 }}>
        <View testID="empty" style={{ width: 0, height: 0 }} />
      </View>
    );

    const element = await screen.findByTestId('empty');
    const screenshot = await screen.screenshot(element);

    expect(screenshot).toBeNull();
  });

  test('returns null for an element that is no longer registered', async () => {
    if (Platform.OS === 'web') {
      return;
    }

    await render(<View style={{ flex: 1 }} />);

    const screenshot = await screen.screenshot({ nativeId: 'does-not-exist' });

    expect(screenshot).toBeNull();
  });
});
