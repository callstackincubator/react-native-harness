import {
  afterEach,
  describe,
  expect,
  fn,
  it,
  mock,
  render,
  requireActual,
  resetModules,
  unmock,
} from 'react-native-harness';

type Greeting = typeof import('@app/lib/greeting');

const requireApp = () =>
  (require('@app/app/App') as typeof import('@app/app/App')).App;

describe('module mocking', () => {
  afterEach(() => {
    resetModules();
  });

  it('gives App the mocked greeting and keeps the real one reachable', async () => {
    const formatGreeting = fn().mockReturnValue('Mocked hello');
    mock('@app/lib/greeting', () => ({ formatGreeting }));

    const App = requireApp();
    await render(<App />);

    expect(formatGreeting).toHaveBeenCalledWith('Harness');
    expect(
      requireActual<Greeting>('@app/lib/greeting').formatGreeting('Harness')
    ).toBe('Hello, Harness!');
  });

  it('returns the real greeting after unmock', () => {
    mock('@app/lib/greeting', () => ({ formatGreeting: () => 'Mocked hello' }));
    expect(
      (require('@app/lib/greeting') as Greeting).formatGreeting('Harness')
    ).toBe('Mocked hello');

    unmock('@app/lib/greeting');

    expect(
      (require('@app/lib/greeting') as Greeting).formatGreeting('Harness')
    ).toBe('Hello, Harness!');
  });
});
