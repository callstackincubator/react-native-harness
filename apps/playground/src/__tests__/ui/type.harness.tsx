import { describe, test, render, fn, expect } from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { View, TextInput } from 'react-native';

describe('userEvent.type', () => {
  test('should type text into TextInput and trigger onChangeText', async () => {
    const onChangeText = fn();

    await render(
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'white',
        }}
      >
        <TextInput
          testID="text-input"
          onChangeText={onChangeText}
          style={{
            width: 200,
            height: 40,
            borderWidth: 1,
            borderColor: 'gray',
            padding: 10,
          }}
          placeholder="Type here..."
        />
      </View>
    );

    const textInput = await screen.findByTestId('text-input');
    await userEvent.type(textInput, 'Hello');

    // onChangeText should be called for each character
    expect(onChangeText).toHaveBeenCalledTimes(5);

    // Verify the progressive text changes
    expect(onChangeText).toHaveBeenNthCalledWith(1, 'H');
    expect(onChangeText).toHaveBeenNthCalledWith(2, 'He');
    expect(onChangeText).toHaveBeenNthCalledWith(3, 'Hel');
    expect(onChangeText).toHaveBeenNthCalledWith(4, 'Hell');
    expect(onChangeText).toHaveBeenNthCalledWith(5, 'Hello');
  });

  test('should append to existing text', async () => {
    const onChangeText = fn();

    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <TextInput
          testID="text-input"
          defaultValue="Hi "
          onChangeText={onChangeText}
          style={{ width: 200, height: 40, borderWidth: 1 }}
        />
      </View>
    );

    const textInput = await screen.findByTestId('text-input');
    await userEvent.type(textInput, 'there');

    // Should append to existing "Hi " text
    expect(onChangeText).toHaveBeenLastCalledWith('Hi there');
  });

  test('should trigger onBlur when typing completes', async () => {
    const onBlur = fn();

    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <TextInput
          testID="text-input"
          onBlur={onBlur}
          style={{ width: 200, height: 40, borderWidth: 1 }}
        />
      </View>
    );

    const textInput = await screen.findByTestId('text-input');
    await userEvent.type(textInput, 'test');

    expect(onBlur).toHaveBeenCalled();
  });

  test('should not trigger blur when skipBlur is true', async () => {
    const onBlur = fn();

    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <TextInput
          testID="text-input"
          onBlur={onBlur}
          style={{ width: 200, height: 40, borderWidth: 1 }}
        />
      </View>
    );

    const textInput = await screen.findByTestId('text-input');
    await userEvent.type(textInput, 'test', { skipBlur: true });

    expect(onBlur).not.toHaveBeenCalled();
  });

  test('should trigger onSubmitEditing when submitEditing option is true', async () => {
    const onSubmitEditing = fn();

    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <TextInput
          testID="text-input"
          onSubmitEditing={onSubmitEditing}
          style={{ width: 200, height: 40, borderWidth: 1 }}
        />
      </View>
    );

    const textInput = await screen.findByTestId('text-input');
    await userEvent.type(textInput, 'test', { submitEditing: true });

    expect(onSubmitEditing).toHaveBeenCalled();
  });
});
