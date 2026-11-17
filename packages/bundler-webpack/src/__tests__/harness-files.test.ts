import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarnessFileMatcher } from '../harness-files.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-files-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const writePackage = (dir: string, name: string) => {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
};

describe('createHarnessFileMatcher', () => {
  it('matches files of a Harness package outside the project', () => {
    writePackage(path.join(root, 'app'), '@react-native-harness/playground');
    writePackage(path.join(root, 'packages', 'runtime'), '@react-native-harness/runtime');
    writePackage(path.join(root, 'packages', 'cli'), 'react-native-harness');
    writePackage(path.join(root, 'libs', 'ui-kit'), '@acme/ui-kit');
    const matches = createHarnessFileMatcher(path.join(root, 'app'));

    expect(matches(path.join(root, 'packages', 'runtime', 'src', 'a.ts'))).toBe(true);
    expect(matches(path.join(root, 'packages', 'cli', 'src', 'a.ts'))).toBe(true);
    expect(matches(path.join(root, 'libs', 'ui-kit', 'src', 'a.ts'))).toBe(false);
  });

  it('never matches the project itself, even with a Harness name', () => {
    writePackage(path.join(root, 'app'), '@react-native-harness/playground-webpack');

    expect(createHarnessFileMatcher(path.join(root, 'app'))(path.join(root, 'app', 'src', 'a.ts'))).toBe(false);
  });
});
