import { describe, test, render, expect } from 'react-native-harness';
import { View, Text } from 'react-native';
import { screen } from '@react-native-harness/ui';

describe('Screenshot', () => {
  test('should match unbounded image snapshot', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            width: 100,
            height: 100,
            backgroundColor: 'blue',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white' }}>Hello, world!</Text>
        </View>
      </View>
    );
    const screenshot = await screen.screenshot();
    await expect(screenshot).toMatchImageSnapshot({ name: 'full-ui' });
  });
    
  test('should match bounded image snapshot', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            width: 100,
            height: 100,
            backgroundColor: 'yellow',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'black' }}>Custom options test</Text>
        </View>
      </View>
    );
    const screenshot = await screen.screenshot();
    await expect(screenshot).toMatchImageSnapshot({
      name: 'yellow-square-custom-options',
      threshold: 0.05, // More sensitive threshold
      diffColor: [0, 255, 0], // Green diff color
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
