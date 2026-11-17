import { describe, expect, it } from 'vitest';
import { renderPage } from '../generated-page.js';

describe('renderPage', () => {
  it('has the element the runtime mounts into, before the scripts, in order', () => {
    const page = renderPage({ scripts: ['/runtime.js', '/vendors.js', '/main.js'], styles: ['/a.css'] });

    expect(page).toContain('<div id="root"></div>');
    expect(page.indexOf('<div id="root">')).toBeLessThan(page.indexOf('/runtime.js'));
    expect(page.indexOf('/runtime.js')).toBeLessThan(page.indexOf('/vendors.js'));
    expect(page.indexOf('/vendors.js')).toBeLessThan(page.indexOf('/main.js'));
    expect(page).toContain('<link rel="stylesheet" href="/a.css" />');
    expect(page.startsWith('<!doctype html>')).toBe(true);
  });

  it('escapes quotes in what it puts in an attribute', () => {
    expect(renderPage({ scripts: ['/a"b.js'], styles: [] })).toContain('src="/a&quot;b.js"');
  });
});
