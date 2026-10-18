#!/usr/bin/env node
// Packs prebuilt XCTest agent artifacts into this package, so consumers on a
// supported Xcode skip `xcodebuild build-for-testing`. One artifact per
// destination serves every supported Xcode, so packing uses the selected one.
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

// Both destinations ship. Simulator artifacts help every iOS run, while device
// artifacts help only the subset that runs on hardware, and
// cost roughly half again on the tarball (1.0 MB to 1.6 MB compressed). They ship
// anyway because signing them locally is the only way a device run gets a fast
// path at all, and an inert implementation would not be worth shipping. Consumers
// who never touch hardware pay one larger download and nothing at runtime: the
// provider declines before doing any work. Pack a narrower set with
// HARNESS_XCTEST_PREBUILD_DESTINATIONS=simulator.
const DEFAULT_DESTINATIONS = ['simulator', 'device'];
const DESTINATIONS_ENV = 'HARNESS_XCTEST_PREBUILD_DESTINATIONS';

const getDefaultDestinations = () => {
  const configured = process.env[DESTINATIONS_ENV]?.trim();

  if (!configured) {
    return DEFAULT_DESTINATIONS;
  }

  return configured
    .split(',')
    .map((destination) => destination.trim())
    .filter(Boolean);
};

const isSupportedDestination = (destination) =>
  destination === 'simulator' || destination === 'device';

const parseDestinations = (argv) => {
  const destinations = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--destination') {
      destinations.push(argv[(index += 1)]);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  const requested =
    destinations.length > 0 ? destinations : getDefaultDestinations();

  for (const destination of requested) {
    if (!isSupportedDestination(destination)) {
      throw new Error(
        `Unsupported destination '${destination}'. Expected 'simulator' or 'device'.`
      );
    }
  }

  return [...new Set(requested)];
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

const describeFailure = (error) =>
  error instanceof Error ? error.message : String(error);

if (skipReason) {
  console.warn(`Skipping prebuilt XCTest agent artifacts: ${skipReason}`);
} else {
  const { getPrebuiltRootPath, packXCTestAgentArtifacts } = await import(
    pathToFileURL(modulePath).href
  );

  // Start from nothing, so the tarball carries exactly what this run packed
  // and never an artifact left behind by an earlier pack.
  fs.rmSync(getPrebuiltRootPath(packageRoot), { recursive: true, force: true });

  for (const destination of destinations) {
    try {
      const result = await packXCTestAgentArtifacts({
        destination,
        packageRoot,
      });

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
    } catch (error) {
      // A failed destination costs only its own artifact; the other still
      // ships.
      const message = `${destination}: ${describeFailure(error)}`;

      if (isRequired) {
        throw new Error(`Unable to pack XCTest agent artifacts for ${message}`);
      }

      console.warn(`Skipping prebuilt XCTest agent artifacts for ${message}`);
    }
  }
}
