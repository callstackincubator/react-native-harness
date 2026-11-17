import { describe, it, render } from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { App } from '@app/app/App';

describe('App', () => {
  it('updates the counter when pressed', async () => {
    await render(<App />);

    const counter = await screen.findByAccessibilityLabel('Pressed 0 times');
    await userEvent.press(counter);

    await screen.findByAccessibilityLabel('Pressed 1 times');
  });
});
