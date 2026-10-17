#!/usr/bin/env node
// Packs prebuilt XCTest agent artifacts into this package, so consumers whose
// Xcode matches the release machine's skip `xcodebuild build-for-testing`.
//
// Runs as `prepack`, which npm and pnpm trigger during `nx release publish`.
// By then `nx release version` has already bumped package.json, so artifacts
// are stamped with the version they ship under.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const modulePath = path.join(packageRoot, 'dist', 'xctest-agent-prebuilt.js');
const DEFAULT_DESTINATIONS = ['simulator'];

const parseDestinations = (argv) => {
  const destinations = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--destination') {
      destinations.push(argv[(index += 1)]);
      continue;
    }

    if (argument === '--all') {
      destinations.push('simulator', 'device');
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  for (const destination of destinations) {
    if (destination !== 'simulator' && destination !== 'device') {
      throw new Error(
        `Unsupported destination '${destination}'. Expected 'simulator' or 'device'.`
      );
    }
  }

  return destinations.length > 0 ? destinations : DEFAULT_DESTINATIONS;
};

const canBuildForIos = () => {
  try {
    execFileSync('xcodebuild', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// Reason an unpackable release is still releasable: consumers just build the
// agent locally, exactly as they did before these artifacts existed. So a pack
// failure warns instead of aborting the release. A job that must produce
// artifacts sets HARNESS_REQUIRE_XCTEST_PREBUILDS=1 to make failures fatal.
const isRequired = process.env.HARNESS_REQUIRE_XCTEST_PREBUILDS === '1';

const getSkipReason = () => {
  if (process.env.HARNESS_SKIP_XCTEST_PREBUILDS === '1') {
    return 'HARNESS_SKIP_XCTEST_PREBUILDS is set.';
  }

  if (!fs.existsSync(modulePath)) {
    return `${modulePath} is missing. Build this package before packing.`;
  }

  if (!canBuildForIos()) {
    return 'xcodebuild is unavailable on this machine.';
  }

  return null;
};

// Argument mistakes are unambiguous (and cannot come from `npm publish`, which
// passes no arguments), so they fail loudly regardless of how strict this run
// is. Environment limitations are handled below.
let destinations;

try {
  destinations = parseDestinations(process.argv.slice(2));
} catch (error) {
  console.error(
    `Unable to pack XCTest agent artifacts: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
}

const skipReason = getSkipReason();

if (skipReason && isRequired) {
  throw new Error(`Unable to pack XCTest agent artifacts: ${skipReason}`);
}

if (skipReason) {
  console.warn(`Skipping prebuilt XCTest agent artifacts: ${skipReason}`);
} else {
  try {
    const { packXCTestAgentArtifacts } = await import(
      pathToFileURL(modulePath).href
    );

    for (const destination of destinations) {
      const result = await packXCTestAgentArtifacts({ destination, packageRoot });

      console.log(
        `Packed prebuilt XCTest agent artifacts ${[
          `destination=${result.entry.destination}`,
          `xcode=${result.entry.xcodeVersion}${
            result.entry.xcodeBuild ? ` (${result.entry.xcodeBuild})` : ''
          }`,
          `sdk=${result.entry.sdkVersion}`,
          `version=${result.entry.agentVersion}`,
        ].join(' ')}`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isRequired) {
      throw new Error(`Unable to pack XCTest agent artifacts: ${message}`);
    }

    console.warn(`Skipping prebuilt XCTest agent artifacts: ${message}`);
  }
}
