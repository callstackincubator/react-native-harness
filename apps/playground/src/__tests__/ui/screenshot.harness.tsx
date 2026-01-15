import { describe, test, render, expect } from 'react-native-harness';
import { View, Text } from 'react-native';
import { screen } from '@react-native-harness/ui';

describe('Screenshot', () => {
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
            <Text style={{ color: 'white' }}>Target</Text>
          </View>
        </View>
      </View>
    );

    const targetElement = await screen.findByTestId('target-element');
    const screenshot = await screen.screenshot(targetElement);
    await expect(screenshot).toMatchImageSnapshot({
      name: 'orange-square-element-only',
    });
  });
});
