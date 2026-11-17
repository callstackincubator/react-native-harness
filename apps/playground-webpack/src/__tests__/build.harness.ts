import { describe, it, expect } from 'react-native-harness';
import logo from '@app/assets/logo.svg';
import { formatGreeting } from '@app/lib/greeting';

describe('webpack features', () => {
  it('resolves the @app alias', () => {
    expect(formatGreeting('Harness')).toBe('Hello, Harness!');
  });

  it('inlines the DefinePlugin constant', () => {
    expect(__BUILD_LABEL__).toBe('harness-webpack-fixture');
  });

  it('imports the SVG as a URL that serves an SVG', async () => {
    const response = await fetch(logo);

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('svg');
  });
});
