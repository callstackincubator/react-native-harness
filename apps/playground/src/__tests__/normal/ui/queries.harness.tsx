import { View, Text } from 'react-native';
import { describe, test, expect, render } from 'react-native-harness';
import { screen } from '@react-native-harness/ui';

describe('Queries', () => {
  test('should find element by testID', async () => {
    await render(
      <View>
        <View testID="this-is-test-id">
          <Text>This is a view with a testID</Text>
        </View>
      </View>
    );
    const element = await screen.findByTestId('this-is-test-id');
    expect(element).toBeDefined();
  });

  test('should find all elements by testID', async () => {
    await render(
      <View>
        <View testID="this-is-test-id">
          <Text>First element</Text>
        </View>
        <View testID="this-is-test-id">
          <Text>Second element</Text>
        </View>
      </View>
    );
    const elements = await screen.findAllByTestId('this-is-test-id');
    expect(elements).toBeDefined();
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBe(2);
  });
});
