import { describe, expect, it } from 'vitest';
import {
  createEntryPointMatcher,
  getEntryPointPattern,
  describeEntry,
} from '../entry-point.js';

describe('createEntryPointMatcher', () => {
  const matches = createEntryPointMatcher({
    projectRoot: '/project',
    entryPoint: './src/index.tsx',
  });

  it('recognizes the request before it is resolved, with or without an extension', () => {
    expect(matches({ request: './src/index.tsx', context: '/project' })).toBe(true);
    expect(matches({ request: './src/index', context: '/project' })).toBe(true);
    expect(matches({ request: './index', context: '/project/src' })).toBe(true);
    expect(matches({ request: '../src/index.tsx', context: '/project/lib' })).toBe(true);
  });

  it('recognizes the file after it is resolved, whatever its extension', () => {
    expect(matches({ createData: { resource: '/project/src/index.tsx' } })).toBe(true);
    expect(matches({ createData: { resource: '/project/src/index.js?x=1' } })).toBe(true);
  });

  it('recognizes an entry point given without an extension', () => {
    const noExtension = createEntryPointMatcher({
      projectRoot: '/project',
      entryPoint: 'index',
    });

    expect(noExtension({ createData: { resource: '/project/index.js' } })).toBe(true);
  });

  it('leaves every other module alone', () => {
    expect(matches({ request: './src/polyfill.js', context: '/project' })).toBe(false);
    expect(matches({ request: './index', context: '/project' })).toBe(false);
    expect(matches({ request: 'react', context: '/project' })).toBe(false);
    expect(matches({ createData: { resource: '/project/src/other/index.tsx' } })).toBe(false);
    expect(matches({})).toBe(false);
  });
});

describe('getEntryPointPattern', () => {
  it('matches the name of the entry', () => {
    const pattern = getEntryPointPattern('./src/index.tsx');

    expect(pattern.test('./src/index.tsx')).toBe(true);
    expect(pattern.test('/project/src/index.js')).toBe(true);
    expect(pattern.test('./src/other.js')).toBe(false);
  });

  it('escapes what a file name may contain', () => {
    expect(getEntryPointPattern('./a.b+c.js').test('./aXb+c.js')).toBe(false);
    expect(getEntryPointPattern('./a.b+c.js').test('./a.b+c.js')).toBe(true);
  });
});

describe('describeEntry', () => {
  it('shows what the config lists', () => {
    expect(describeEntry(['./a.js', './b.js'])).toBe('["./a.js","./b.js"]');
    expect(describeEntry({ main: './a.js' })).toBe('{"main":"./a.js"}');
    expect(describeEntry(undefined)).toBe('none');
    expect(describeEntry(() => './a.js')).toBe('a function');
  });
});
