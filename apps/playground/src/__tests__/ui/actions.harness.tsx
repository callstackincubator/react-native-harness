import { describe, test, render, fn, expect } from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { View, Text, Pressable } from 'react-native';

describe('Actions', () => {
  test('should press element found by testID', async () => {
    const onPress = fn();

    await render(
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'white',
        }}
      >
        <Pressable
          testID="this-is-test-id"
          onPress={onPress}
          style={{ padding: 10, backgroundColor: 'red' }}
        >
          <Text style={{ color: 'black' }}>This is a view with a testID</Text>
        </Pressable>
      </View>
    );

    const element = await screen.findByTestId('this-is-test-id');
    await userEvent.press(element);

    expect(onPress).toHaveBeenCalled();
  });
});
