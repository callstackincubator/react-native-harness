#!/usr/bin/env node
// Prints a fingerprint of everything that determines an app's native debug
// build for one platform, for use as a CI cache key.
//
// Usage: node scripts/ci/native-fingerprint.mjs <projectRoot> <ios|android|ios-pods> [--debug]
//
// @expo/fingerprint covers the app's native directory, the package.json
// scripts, the autolinking config, and each autolinked package by its
// name@version. A workspace package keeps its version while its native code
// changes, so this script adds the git-tracked native files and codegen specs
// of every workspace dependency, plus the toolchain settings passed as
// environment variables by the workflow.
//
// `ios-pods` prints a narrower fingerprint for the CocoaPods sandbox: the
// Podfile, the lockfile, the podspecs and the autolinked packages, but not the
// app or workspace sources that Pods/ only references.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createFingerprintAsync } from '@expo/fingerprint';

// Bump to discard every cached app, e.g. after a change the fingerprint
// cannot see.
const CACHE_VERSION = '1';

const NATIVE_PATHS = {
  ios: ['ios', '*.podspec', 'Package.swift'],
  android: ['android'],
};

// Toolchain and build settings that change the binary without changing any
// file in the repository.
const TOOLCHAIN_ENV = {
  ios: [
    'XCODE_VERSION',
    'IOS_ARCHS',
    'RCT_USE_RN_DEP',
    'RCT_USE_PREBUILT_RNCORE',
    'USE_FRAMEWORKS',
  ],
  android: ['JAVA_VERSION', 'ORG_GRADLE_PROJECT_reactNativeArchitectures'],
};

const CODEGEN_SPEC = /(^|\/)Native[^/]*\.(js|jsx|ts|tsx)$/;

// Settings that change what `pod install` generates.
const PODS_ENV = ['RCT_USE_RN_DEP', 'RCT_USE_PREBUILT_RNCORE', 'USE_FRAMEWORKS'];

const [projectRootArg, target] = process.argv.slice(2);
const debug = process.argv.includes('--debug');
const pods = target === 'ios-pods';
const platform = pods ? 'ios' : target;

if (!projectRootArg || !NATIVE_PATHS[platform]) {
  console.error(
    'Usage: native-fingerprint.mjs <projectRoot> <ios|android|ios-pods> [--debug]'
  );
  process.exit(1);
}

const projectRoot = path.resolve(projectRootArg);
const require = createRequire(path.join(projectRoot, 'package.json'));

const gitLsFiles = (cwd, pathspecs) =>
  execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const codegenSources = (packageDir, packageJson, reason) => {
  const { codegenConfig } = packageJson;
  if (!codegenConfig) {
    return [];
  }

  const sources = [
    {
      type: 'contents',
      id: `${packageJson.name}:codegenConfig`,
      contents: JSON.stringify(codegenConfig),
      reasons: [reason],
    },
  ];

  if (codegenConfig.jsSrcsDir) {
    for (const file of gitLsFiles(packageDir, [codegenConfig.jsSrcsDir])) {
      if (CODEGEN_SPEC.test(file)) {
        sources.push({
          type: 'file',
          filePath: path.relative(projectRoot, path.join(packageDir, file)),
          reasons: [reason],
        });
      }
    }
  }

  return sources;
};

const projectPackageJson = readJson(path.join(projectRoot, 'package.json'));
const extraSources = [
  {
    type: 'contents',
    id: 'cacheVersion',
    contents: CACHE_VERSION,
    reasons: ['cacheVersion'],
  },
  ...codegenSources(projectRoot, projectPackageJson, 'appCodegen'),
];

const workspaceDependencies = Object.entries({
  ...projectPackageJson.dependencies,
  ...projectPackageJson.devDependencies,
})
  .filter(([, spec]) => spec.startsWith('workspace:'))
  .map(([name]) => name)
  .sort();

for (const name of workspaceDependencies) {
  const packageDir = realpathSync(
    path.dirname(require.resolve(`${name}/package.json`))
  );
  const nativeFiles = gitLsFiles(packageDir, NATIVE_PATHS[platform]);
  if (nativeFiles.length === 0) {
    continue;
  }

  for (const file of nativeFiles) {
    extraSources.push({
      type: 'file',
      filePath: path.relative(projectRoot, path.join(packageDir, file)),
      reasons: [`workspaceNative:${name}`],
    });
  }
  extraSources.push(
    ...codegenSources(
      packageDir,
      readJson(path.join(packageDir, 'package.json')),
      `workspaceCodegen:${name}`
    )
  );
}

const toolchain = Object.fromEntries(
  TOOLCHAIN_ENV[platform].map((name) => [name, process.env[name] ?? null])
);
extraSources.push({
  type: 'contents',
  id: 'toolchain',
  contents: JSON.stringify(toolchain),
  reasons: ['toolchain'],
});

const fingerprint = await createFingerprintAsync(projectRoot, {
  platforms: [platform],
  extraSources,
  silent: true,
});

const sha1 = (value) => createHash('sha1').update(value).digest('hex');

const podsSources = () => {
  const lines = fingerprint.sources
    .filter(
      (source) =>
        source.type === 'package' ||
        source.id === 'rncoreAutolinkingConfig' ||
        source.id === 'cacheVersion' ||
        source.filePath?.endsWith('.podspec')
    )
    .map((source) => `${source.filePath ?? source.id} ${source.hash}`);

  for (const file of ['ios/Podfile', 'ios/Podfile.lock']) {
    lines.push(`${file} ${sha1(readFileSync(path.join(projectRoot, file)))}`);
  }

  const podsEnv = Object.fromEntries(
    PODS_ENV.map((name) => [name, process.env[name] ?? null])
  );
  lines.push(`env ${sha1(JSON.stringify(podsEnv))}`);

  return lines.sort();
};

const lines = pods
  ? podsSources()
  : fingerprint.sources.map(
      (source) => `${source.filePath ?? source.id} ${source.hash}`
    );

if (debug) {
  console.error(lines.join('\n'));
  console.error(`toolchain: ${JSON.stringify(toolchain)}`);
}

console.log(pods ? sha1(lines.join('\n')) : fingerprint.hash);
