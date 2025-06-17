import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { describe, it, afterEach, render, cleanup, screen, expect, fake, userEvent } from '@react-native-harness/runtime';

describe('Matchers', () => {
  it('should be able to check if an element is displayed', async () => {
    await render(
      <ScrollView
        testID="scrollView"
        style={{height: 100, backgroundColor: 'red', flexGrow: 0}}
        contentContainerStyle={{flexGrow: 1}}
      >
        <View style={{height: 150, width: 1000, backgroundColor: 'green'}} />
        <View
          style={{height: 100, width: 100, backgroundColor: 'blue'}}
          testID="testID"
        />
    </ScrollView>
    );
      // TODO: Elements not found when out of view in ScrollView
    expect(await screen.findByTestId('testID', { strict: false })).to.be.null;

    const scrollView = await screen.findByTestId('scrollView', { strict: true });
    await userEvent.scroll(scrollView, { direction: 'down', distance: 200 });

    expect(await screen.findByTestId('testID', { strict: false })).to.not.be.null;
  });

  it('should be able to check if an element is disabled', async () => {
    await render(
      <Pressable testID="testID" disabled>
        <Text>Hello</Text>
      </Pressable>,
    ); 

    const element = await screen.findByTestId('testID', { strict: true });
    await expect(element).to.be.toBeDisabled();
  });

  it('should be able to check if an element is enabled', async () => {
    await render(
      <Pressable testID="testID">
        <Text>Hello</Text>
      </Pressable>,
    );

    const element = await screen.findByTestId('testID', { strict: true });
    await expect(element).to.be.toBeEnabled();
  });
});

describe('Selectors', () => {
  it('should be able to find an element by testID', async () => {
    await render(
      <View testID="testID">
        <Text>Hello</Text>
      </View>,
    );

    const element = await screen.findByTestId('testID');
    expect(element).to.not.be.null;
  });

  it('should be able to find an element by accessibility label', async () => {
    await render(
      <Pressable accessibilityLabel="accessibilityLabel">
        <Text>Hello</Text>
      </Pressable>,
    );

    const element = await screen.findByLabel('accessibilityLabel');
    expect(element).to.not.be.null;
  });

  it('should be able to find an element by text', async () => {
    await render(
      <Text>Hello</Text>,
    );

    const element = await screen.findByText('Hello');
    expect(element).to.not.be.null;
  });
});

describe('User events', () => {
  it('should be able to press an element', async () => {
    const onPress = fake();
    await render(
      <Pressable testID="testID" onPress={onPress}>
        <Text>Hello</Text>
      </Pressable>,
    );

    const element = await screen.findByTestId('testID', { strict: true });
    await userEvent.press(element);
    expect(onPress).to.have.been.calledOnce;
  });

  it('should be able to long press an element', async () => {
    const onLongPress = fake();
    await render(
      <Pressable testID="testID" onLongPress={onLongPress}>
        <Text>Hello</Text>
      </Pressable>,
    );

    const element = await screen.findByTestId('testID', { strict: true });
    await userEvent.longPress(element);
    expect(onLongPress).to.have.been.calledOnce;
  });

  it('should be able to type in a text input', async () => {
    const onType = fake();
    await render(
      <TextInput testID="testID" onChangeText={onType} />,
    );

    const element = await screen.findByTestId('testID', { strict: true });
    await userEvent.type(element, { text: 'Hello' });
    expect(onType).to.have.been.callCount(5);
    expect(onType).to.have.been.calledWith('Hello');
  });

  it('should be able to clear a text input', async () => {
    const onClear = fake();
    await render(
      <TextInput testID="testID" defaultValue="Hello" onChangeText={onClear} />,
    );

    const element = await screen.findByTestId('testID', { strict: true });
    await userEvent.clear(element);

    expect(onClear).to.have.been.calledOnce;
    expect(onClear).to.have.been.calledWith('');
  });
});

afterEach(() => {
  cleanup();
});
