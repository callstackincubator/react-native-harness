import { logger, spawn } from '@react-native-harness/tools';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getXCTestAgentBuildProductsPath } from './xctest-agent-build.js';
import {
  resolvePrebuiltEntry,
  toPrebuiltArtifacts,
  unpackPrebuiltEntry,
} from './xctest-agent-prebuilt.js';
import type {
  XCTestAgentProvider,
  XCTestAgentProviderContext,
} from './xctest-agent-artifacts.js';

const xctestAgentLogger = logger.child('ios-xctest-agent');

const DEFAULT_SIGNING_IDENTITY = 'Apple Development';

let usableIdentityHashes: string[] | undefined;

/**
 * SHA-1 fingerprints of the codesigning identities this machine can sign with.
 *
 * `-v` does not mean "usable": it still lists revoked and otherwise invalid
 * identities, merely appending a status such as `(CSSMERR_TP_CERT_REVOKED)`
 * instead of the end of the line. Only an unannotated identity is usable, and
 * the distinction matters because `codesign` accepts a revoked SHA-1 and fails
 * partway through signing rather than when the identity is chosen.
 */
const getUsableIdentityHashes = (): string[] => {
  if (usableIdentityHashes) {
    return usableIdentityHashes;
  }

  const found = spawnSync('security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
  ]);

  usableIdentityHashes =
    found.status === 0
      ? found.stdout
          .toString()
          .split('\n')
          .map(
            (line) =>
              // Anchored after the closing quote, so a line trailing an
              // "(CSSMERR_…)" annotation matches nothing.
              /^\s*\d+\)\s+([0-9A-F]{40})\s+"[^"]*"$/.exec(line.trimEnd())?.[1]
          )
          .filter((hash): hash is string => hash !== undefined)
      : [];

  return usableIdentityHashes;
};

/**
 * Chooses the `codesign` identity to sign with.
 *
 * An explicit `signingIdentity` always wins. Otherwise the profile's own
 * embedded certificates are matched against the usable keychain identities,
 * which is both precise and cheap: a profile lists exactly the certificates it
 * can be used with, so the intersection cannot name another account's
 * certificate. Matching by name is not an option — `codesign --sign "Apple
 * Development"` fails with "ambiguous (matches …)" as soon as a keychain holds
 * two development certificates, which is routine for a personal and a work
 * account on one machine.
 */
export const resolveSigningIdentity = (options: {
  identity?: string;
  profile: ProvisioningProfile;
}): { error?: string; identity: string } => {
  if (options.identity) {
    return { identity: options.identity };
  }

  const usable = getUsableIdentityHashes();
  const candidates = options.profile.developerCertificateHashes.filter((hash) =>
    usable.includes(hash)
  );

  if (candidates.length === 1) {
    return { identity: candidates[0] };
  }

  if (candidates.length === 0) {
    return {
      error: `no usable "Apple Development" certificate in the keychain matches the provisioning profile "${options.profile.name}"`,
      identity: DEFAULT_SIGNING_IDENTITY,
    };
  }

  return {
    error:
      `several keychain certificates match the provisioning profile ` +
      `"${options.profile.name}", so set device.codeSign.signingIdentity to ` +
      `one of ${candidates.join(', ')}`,
    identity: DEFAULT_SIGNING_IDENTITY,
  };
};
const AGENT_BUNDLE_ID_PREFIX = 'com.callstackincubator.';

export type ProvisioningProfile = {
  /** `application-identifier` entitlement, e.g. `TEAMID.*`. */
  applicationIdentifier: string;
  /** Certificates this profile may be used with, as codesign SHA-1 fingerprints. */
  developerCertificateHashes: string[];
  name: string;
  path: string;
  provisionedDevices: string[];
  teamId: string;
  uuid: string;
};

export type FindProvisioningProfileOptions = {
  /**
   * Prefix the artifacts will be remapped to, when the consumer's profile
   * cannot cover the agent's own bundle ids. Omitted when searching for a
   * profile that covers the shipped ids as-is.
   */
  bundleIdPrefix?: string;
  /** Device the agent must run on; profiles listing devices must include it. */
  deviceId?: string;
  /** Path, name, or UUID of a profile to use. Otherwise any installed match. */
  profile?: string;
  /**
   * Requested `codesign` identity. A SHA-1 restricts profiles to those that name
   * that certificate; a name is too coarse to restrict anything, since several
   * certificates share the display name "Apple Development".
   */
  signingIdentity?: string;
  signal?: AbortSignal;
  teamId: string;
};

const getProfileSearchPaths = (): string[] => {
  const home = os.homedir();

  return [
    path.join(
      home,
      'Library',
      'Developer',
      'Xcode',
      'UserData',
      'Provisioning Profiles'
    ),
    path.join(home, 'Library', 'MobileDevice', 'Provisioning Profiles'),
  ];
};

/**
 * `application-identifier` values the agent must be allowed to claim: the
 * app-under-test id and the test runner host id, team-qualified.
 *
 * Profiles grant this entitlement rather than bare bundle ids, so coverage is
 * checked against these. Remapping changes the prefix, so the lookup is asked
 * about the ids the agent will actually be signed with — the XCTest bundle
 * itself is signed without entitlements and needs no coverage.
 */
export const getAgentApplicationIdentifiers = (options: {
  bundleIdPrefix?: string;
  teamId: string;
}): string[] => {
  const prefix = options.bundleIdPrefix
    ? `${options.bundleIdPrefix.replace(/\.$/, '')}.`
    : AGENT_BUNDLE_ID_PREFIX;

  return [
    `${options.teamId}.${prefix}HarnessXCTestAgent`,
    `${options.teamId}.${prefix}HarnessXCTestAgentUITests.xctrunner`,
  ];
};

const readPlistJson = <T>(plistPath: string, keyPath: string): T | null => {
  const result = spawnSync('plutil', [
    '-extract',
    keyPath,
    'json',
    '-o',
    '-',
    plistPath,
  ]);

  if (result.status !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout.toString()) as T;
  } catch {
    return null;
  }
};

/**
 * The fingerprint `security find-identity` and `codesign` name a certificate
 * by: SHA-1 over its DER bytes, uppercase hex without separators. It identifies
 * the certificate; it does not protect anything.
 */
const getCertificateFingerprint = (der: Buffer): string =>
  new X509Certificate(der).fingerprint.replaceAll(':', '');

/**
 * Certificates a profile may be used with, as codesign SHA-1 fingerprints.
 *
 * Each entry is the DER certificate, which `plutil` prints as base64 when
 * extracted on its own.
 */
const readDeveloperCertificateHashes = (plistPath: string): string[] => {
  const hashes: string[] = [];

  for (let index = 0; index < MAX_DEVELOPER_CERTIFICATES; index += 1) {
    const certificate = spawnSync('plutil', [
      '-extract',
      `DeveloperCertificates.${index}`,
      'raw',
      '-o',
      '-',
      plistPath,
    ]);

    if (certificate.status !== 0) {
      break;
    }

    const der = Buffer.from(certificate.stdout.toString().trim(), 'base64');

    if (der.length === 0) {
      continue;
    }

    try {
      hashes.push(getCertificateFingerprint(der));
    } catch {
      // A blob that is not a certificate cannot match a keychain identity.
    }
  }

  return hashes;
};

/**
 * Reads a provisioning profile's signing-relevant fields.
 *
 * The profile is a CMS message, and its decoded payload holds binary
 * `DeveloperCertificates` blobs that `plutil -convert json` refuses to
 * represent. So fields are extracted one key at a time rather than by
 * converting the file, which also puts the cheap team check first: a profile
 * from another account costs one extraction instead of six.
 */
const decodeProvisioningProfile = async (
  profilePath: string,
  signal?: AbortSignal
): Promise<ProvisioningProfile | null> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-profile-'));
  const decoded = path.join(directory, 'decoded.plist');

  try {
    const { stdout } = await spawn(
      'security',
      ['cms', '-D', '-i', profilePath],
      { signal }
    );
    fs.writeFileSync(decoded, stdout);

    const teamId = readPlistString(decoded, 'TeamIdentifier.0');

    if (!teamId) {
      return null;
    }

    const applicationIdentifier = readPlistString(
      decoded,
      'Entitlements.application-identifier'
    );

    if (!applicationIdentifier) {
      return null;
    }

    // An unparseable date keeps the profile rather than discarding it: the
    // device rejects expired provisioning on its own, and a false decline here
    // would cost a full rebuild for a profile that is probably fine.
    const expiration = Date.parse(
      readPlistString(decoded, 'ExpirationDate') ?? ''
    );

    if (!Number.isNaN(expiration) && expiration <= Date.now()) {
      xctestAgentLogger.debug(
        'ignoring expired provisioning profile %s',
        profilePath
      );
      return null;
    }

    return {
      applicationIdentifier,
      developerCertificateHashes: readDeveloperCertificateHashes(decoded),
      name: readPlistString(decoded, 'Name') ?? path.basename(profilePath),
      path: profilePath,
      provisionedDevices:
        readPlistJson<string[]>(decoded, 'ProvisionedDevices') ?? [],
      teamId,
      uuid: readPlistString(decoded, 'UUID') ?? '',
    };
  } catch {
    return null;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

/**
 * Whether a profile's `application-identifier` covers a value: `TEAM.*` covers
 * the team's whole namespace, `TEAM.a.*` a subtree, anything else only an exact
 * match.
 */
const coversApplicationIdentifier = (
  profile: ProvisioningProfile,
  applicationIdentifier: string
) => {
  const granted = profile.applicationIdentifier;

  if (granted === applicationIdentifier) {
    return true;
  }

  return granted.endsWith('*')
    ? applicationIdentifier.startsWith(granted.slice(0, -1))
    : false;
};

/**
 * Finds an installed profile that can sign the agent without contacting the
 * Developer Portal, which is what makes re-signing usable offline and in CI.
 */
export const findProvisioningProfile = async (
  options: FindProvisioningProfileOptions
): Promise<ProvisioningProfile | null> => {
  const required = getAgentApplicationIdentifiers(options);

  /**
   * A profile is only worth choosing when a certificate it names is installed
   * and unrevoked. Otherwise signing is guaranteed to fail later, and on
   * machines with several accounts another profile is often usable.
   */
  // A certificate name cannot restrict anything: several certificates answer to
  // "Apple Development", so only a SHA-1 fingerprint is treated as a filter.
  const identityFilter =
    options.signingIdentity && /^[0-9a-fA-F]{40}$/.test(options.signingIdentity)
      ? options.signingIdentity.toUpperCase()
      : undefined;
  const isSignable = (profile: ProvisioningProfile) =>
    identityFilter
      ? profile.developerCertificateHashes.includes(identityFilter)
      : profile.developerCertificateHashes.some((hash) =>
          // Only read the keychain when the caller did not name a certificate.
          getUsableIdentityHashes().includes(hash)
        );

  /**
   * Everything a profile must satisfy to be chosen, for a named profile as well
   * as a scanned one. Both paths have to ask the same questions: a profile given
   * by path is still the thing that gets installed on this device, so leaving the
   * device check to the scan would let an explicit path sign for a device the
   * profile does not list — a failure that only surfaces as an install error.
   */
  const isUsable = (profile: ProvisioningProfile) =>
    profile.teamId === options.teamId &&
    isSignable(profile) &&
    required.every((identifier) =>
      coversApplicationIdentifier(profile, identifier)
    ) &&
    (!options.deviceId ||
      profile.provisionedDevices.includes(options.deviceId));

  if (options.profile && fs.existsSync(options.profile)) {
    const profile = await decodeProvisioningProfile(
      options.profile,
      options.signal
    );

    return profile && isUsable(profile) ? profile : null;
  }

  const candidates: ProvisioningProfile[] = [];

  for (const searchPath of getProfileSearchPaths()) {
    if (!fs.existsSync(searchPath)) {
      continue;
    }

    for (const entry of fs.readdirSync(searchPath)) {
      if (!entry.endsWith('.mobileprovision')) {
        continue;
      }

      const profile = await decodeProvisioningProfile(
        path.join(searchPath, entry),
        options.signal
      );

      if (profile && isUsable(profile)) {
        candidates.push(profile);
      }
    }
  }

  if (options.profile) {
    const named = candidates.find(
      (candidate) =>
        candidate.name === options.profile || candidate.uuid === options.profile
    );

    if (!named) {
      xctestAgentLogger.info(
        'No installed provisioning profile named %s covers the XCTest agent for team %s',
        options.profile,
        options.teamId
      );
    }

    return named ?? null;
  }

  // Prefer the most specific match: a profile that enumerates devices is a
  // better fit than a wildcard whose device list can silently fall behind a
  // newly added device.
  return (
    candidates.sort(
      (a, b) =>
        b.provisionedDevices.length - a.provisionedDevices.length ||
        b.applicationIdentifier.length - a.applicationIdentifier.length
    )[0] ?? null
  );
};

const readPlistString = (plistPath: string, keyPath: string): string | null => {
  const result = spawnSync('plutil', [
    '-extract',
    keyPath,
    'raw',
    '-o',
    '-',
    plistPath,
  ]);

  return result.status === 0 ? result.stdout.toString().trim() || null : null;
};

const replacePlistString = (
  plistPath: string,
  keyPath: string,
  value: string
): void => {
  const result = spawnSync('plutil', [
    '-replace',
    keyPath,
    '-string',
    value,
    plistPath,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `Unable to set ${keyPath} in ${plistPath}: ${result.stderr
        .toString()
        .trim()}`
    );
  }
};

const MAX_DEVELOPER_CERTIFICATES = 32;

/** The fields of a `.xctestrun` test target that signing and remapping use. */
type XCTestRunTarget = {
  TestBundlePath?: string;
  TestHostBundleIdentifier?: string;
  TestHostPath?: string;
  UITargetAppPath?: string;
};

/**
 * Every test target of every configuration, with the plist key path it lives
 * at, so a target can be rewritten in place with `plutil -replace`.
 *
 * Xcode emits one configuration with one target for this scheme, but reading
 * all of them means a file that ever carried two cannot make this code sign
 * one bundle while the session launches another. A `.xctestrun` holds only
 * strings, numbers, booleans, and collections, so it converts to JSON whole.
 */
const readXCTestRunTargets = (
  xctestrunPath: string
): { keyPath: string; target: XCTestRunTarget }[] => {
  const result = spawnSync('plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    xctestrunPath,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `Unable to read ${xctestrunPath}: ${result.stderr.toString().trim()}`
    );
  }

  const xctestrun = JSON.parse(result.stdout.toString()) as {
    TestConfigurations?: { TestTargets?: XCTestRunTarget[] }[];
  };

  return (xctestrun.TestConfigurations ?? []).flatMap(
    (configuration, configurationIndex) =>
      (configuration.TestTargets ?? []).map((target, targetIndex) => ({
        keyPath: `TestConfigurations.${configurationIndex}.TestTargets.${targetIndex}`,
        target,
      }))
  );
};

/**
 * Bundles named by a `.xctestrun`, resolved through its relocation macros.
 *
 * Reading the paths out of the file rather than globbing for `*.app` keeps this
 * correct when the layout changes; `TestHostPath` and `UITargetAppPath` are what
 * the test session itself installs and launches.
 *
 * The macros are relative to each other: `__TESTROOT__` is the products directory
 * the `.xctestrun` sits in, while `__TESTHOST__` is the resolved `TestHostPath`,
 * which is where the nested XCTest bundle lives. Treating `__TESTHOST__` as the
 * products directory would look for the test bundle outside the runner and leave
 * it unsigned, which the device rejects at install time.
 */
const getArtifactBundles = (xctestrunPath: string) => {
  const productsPath = path.dirname(xctestrunPath);
  const targets = readXCTestRunTargets(xctestrunPath);
  const first = (key: 'TestHostPath' | 'TestBundlePath' | 'UITargetAppPath') =>
    targets.find(({ target }) => target[key])?.target[key];
  const rawRunnerPath = first('TestHostPath');

  if (!rawRunnerPath) {
    throw new Error(
      `Prebuilt XCTest agent artifacts have no test host next to ${xctestrunPath}.`
    );
  }

  const runnerPath = path.join(
    productsPath,
    rawRunnerPath.replace('__TESTROOT__', '.')
  );

  const resolve = (value: string | null | undefined) =>
    value
      ? path.join(
          productsPath,
          value
            .replace('__TESTROOT__', '.')
            // A function replacement, so a path containing `$` is not read as a
            // replacement pattern.
            .replace('__TESTHOST__', () =>
              path.relative(productsPath, runnerPath)
            )
        )
      : null;

  if (!fs.existsSync(runnerPath)) {
    throw new Error(
      `Prebuilt XCTest agent artifacts are incomplete next to ${xctestrunPath}: ${runnerPath} is missing.`
    );
  }

  const appPath = resolve(first('UITargetAppPath'));

  if (!appPath || !fs.existsSync(appPath)) {
    throw new Error(
      `Prebuilt XCTest agent artifacts are incomplete next to ${xctestrunPath}: ${appPath} is missing.`
    );
  }

  const pluginPath = resolve(first('TestBundlePath'));

  return {
    appPath,
    pluginPath: pluginPath && fs.existsSync(pluginPath) ? pluginPath : null,
    runnerPath,
  };
};

const getBundleIdentifier = (bundlePath: string): string | null =>
  readPlistString(path.join(bundlePath, 'Info.plist'), 'CFBundleIdentifier');

/**
 * Rewrites a plist array of bundle ids, leaving entries this remap does not
 * know about alone.
 */
const remapBundleIdArray = (options: {
  keyPath: string;
  plistPath: string;
  rewrites: ReadonlyMap<string, string>;
}) => {
  const extracted = spawnSync('plutil', [
    '-extract',
    options.keyPath,
    'json',
    '-o',
    '-',
    options.plistPath,
  ]);

  if (extracted.status !== 0) {
    return;
  }

  let bundleIds: unknown;

  try {
    bundleIds = JSON.parse(extracted.stdout.toString());
  } catch {
    return;
  }

  if (!Array.isArray(bundleIds)) {
    return;
  }

  const remapped = bundleIds.map((bundleId) =>
    typeof bundleId === 'string'
      ? options.rewrites.get(bundleId) ?? bundleId
      : bundleId
  );

  if (JSON.stringify(remapped) === JSON.stringify(bundleIds)) {
    return;
  }

  const result = spawnSync('plutil', [
    '-replace',
    options.keyPath,
    '-json',
    JSON.stringify(remapped),
    options.plistPath,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `Unable to set ${options.keyPath} in ${options.plistPath}: ${result.stderr
        .toString()
        .trim()}`
    );
  }
};

/**
 * Replaces the agent's bundle ids with ones under the consumer's own prefix.
 *
 * Accounts that cannot mint a profile covering `com.callstackincubator.*` —
 * individual developer accounts, and many corporate ones — otherwise cannot run
 * the agent at all. Rewriting the Info.plists is not enough: the `.xctestrun`
 * names the runner bundle id per target and lists the ids whose crash reports
 * belong to the agent, so a stale id there makes the test session look for an app
 * that was never installed and attribute crashes to bundles that do not exist.
 */
const remapBundleIdentifiers = (options: {
  bundles: string[];
  bundleIdPrefix: string;
  xctestrunPath: string;
}) => {
  const prefix = `${options.bundleIdPrefix.replace(/\.$/, '')}.`;
  const rewrites = new Map<string, string>();

  for (const bundlePath of options.bundles) {
    const bundleId = getBundleIdentifier(bundlePath);

    if (!bundleId?.startsWith(AGENT_BUNDLE_ID_PREFIX)) {
      continue;
    }

    const remapped = `${prefix}${bundleId.slice(
      AGENT_BUNDLE_ID_PREFIX.length
    )}`;

    replacePlistString(
      path.join(bundlePath, 'Info.plist'),
      'CFBundleIdentifier',
      remapped
    );
    rewrites.set(bundleId, remapped);
  }

  if (rewrites.size === 0) {
    return;
  }

  for (const { keyPath, target } of readXCTestRunTargets(
    options.xctestrunPath
  )) {
    const current = target.TestHostBundleIdentifier;
    const remapped = current ? rewrites.get(current) : undefined;

    if (remapped) {
      replacePlistString(
        options.xctestrunPath,
        `${keyPath}.TestHostBundleIdentifier`,
        remapped
      );
    }

    remapBundleIdArray({
      keyPath: `${keyPath}.BundleIdentifiersForCrashReportEmphasis`,
      plistPath: options.xctestrunPath,
      rewrites,
    });
  }
};

const writeEntitlements = (options: {
  applicationIdentifier: string;
  keychainAccessGroup?: string;
  path: string;
  teamId: string;
}) => {
  const entries = [
    `  <key>application-identifier</key><string>${options.applicationIdentifier}</string>`,
    `  <key>com.apple.developer.team-identifier</key><string>${options.teamId}</string>`,
    '  <key>get-task-allow</key><true/>',
  ];

  if (options.keychainAccessGroup) {
    entries.push(
      `  <key>keychain-access-groups</key><array><string>${options.keychainAccessGroup}</string></array>`
    );
  }

  fs.writeFileSync(
    options.path,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      ...entries,
      '</dict></plist>',
      '',
    ].join('\n')
  );
};

const signBundle = async (options: {
  entitlementsPath?: string;
  identity: string;
  signal?: AbortSignal;
  targetPath: string | string[];
}) => {
  const args = ['--force', '--sign', options.identity, '--timestamp=none'];

  if (options.entitlementsPath) {
    args.push('--entitlements', options.entitlementsPath);
  }

  await spawn('codesign', [...args, ...[options.targetPath].flat()], {
    signal: options.signal,
  });
};

/**
 * Frameworks and dylibs embedded in a bundle's `Frameworks` directory.
 *
 * From Xcode 26 the test runner embeds XCTest, XCUIAutomation, Testing, and
 * their support libraries, signed by Apple. A device refuses to install an app
 * whose embedded code is not signed by the same identity as the app itself
 * ("The identity used to sign the executable is no longer valid"), which is
 * why `xcodebuild` re-signs them too.
 */
const getEmbeddedCodePaths = (bundlePath: string): string[] => {
  const frameworksPath = path.join(bundlePath, 'Frameworks');

  if (!fs.existsSync(frameworksPath)) {
    return [];
  }

  return fs
    .readdirSync(frameworksPath)
    .filter((entry) => entry.endsWith('.framework') || entry.endsWith('.dylib'))
    .sort()
    .map((entry) => path.join(frameworksPath, entry));
};

export type ResignXCTestAgentArtifactsOptions = {
  /** Rewrites the agent's bundle ids; see `remapBundleIdentifiers`. */
  bundleIdPrefix?: string;
  identity?: string;
  profile: ProvisioningProfile;
  signal?: AbortSignal;
  xctestrunPath: string;
};

/**
 * Signs unpacked device artifacts so the configured device can run them.
 *
 * Order matters: signing goes inside out, so embedded frameworks come first,
 * then the XCTest bundle that lives inside the runner, then the runner that
 * embeds it, then the app under test. Entitlements mirror what `xcodebuild` emits for the same team and bundle id — confirmed by
 * diffing against a real signed build — because diverging would change which
 * permission prompts the agent can observe. Signing takes about a second and
 * needs no network, versus a rebuild.
 */
export const resignXCTestAgentArtifacts = async (
  options: ResignXCTestAgentArtifactsOptions
): Promise<void> => {
  const bundles = getArtifactBundles(options.xctestrunPath);
  const identity = options.identity ?? DEFAULT_SIGNING_IDENTITY;
  const teamId = options.profile.teamId;

  if (options.bundleIdPrefix) {
    remapBundleIdentifiers({
      bundleIdPrefix: options.bundleIdPrefix,
      bundles: [bundles.appPath, bundles.runnerPath, bundles.pluginPath].filter(
        (bundle): bundle is string => Boolean(bundle)
      ),
      xctestrunPath: options.xctestrunPath,
    });
  }

  const runnerBundleId =
    getBundleIdentifier(bundles.runnerPath) ??
    `${AGENT_BUNDLE_ID_PREFIX}HarnessXCTestAgentUITests.xctrunner`;
  const appBundleId =
    getBundleIdentifier(bundles.appPath) ??
    `${AGENT_BUNDLE_ID_PREFIX}HarnessXCTestAgent`;
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'harness-entitlements-')
  );

  try {
    const embeddedCode = [
      bundles.pluginPath,
      bundles.runnerPath,
      bundles.appPath,
    ]
      .filter((bundle): bundle is string => Boolean(bundle))
      .flatMap(getEmbeddedCodePaths);

    if (embeddedCode.length > 0) {
      await signBundle({
        identity,
        signal: options.signal,
        targetPath: embeddedCode,
      });
    }

    if (bundles.pluginPath) {
      await signBundle({
        identity,
        signal: options.signal,
        targetPath: bundles.pluginPath,
      });
    }

    const runnerEntitlements = path.join(temporary, 'runner.plist');
    fs.copyFileSync(
      options.profile.path,
      path.join(bundles.runnerPath, 'embedded.mobileprovision')
    );
    writeEntitlements({
      applicationIdentifier: `${teamId}.${runnerBundleId}`,
      keychainAccessGroup: `${teamId}.${runnerBundleId}`,
      path: runnerEntitlements,
      teamId,
    });
    await signBundle({
      entitlementsPath: runnerEntitlements,
      identity,
      signal: options.signal,
      targetPath: bundles.runnerPath,
    });

    const appEntitlements = path.join(temporary, 'app.plist');
    fs.copyFileSync(
      options.profile.path,
      path.join(bundles.appPath, 'embedded.mobileprovision')
    );
    writeEntitlements({
      applicationIdentifier: `${teamId}.${appBundleId}`,
      path: appEntitlements,
      teamId,
    });
    await signBundle({
      entitlementsPath: appEntitlements,
      identity,
      signal: options.signal,
      targetPath: bundles.appPath,
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  // A bundle that fails strict verification cannot launch, so fail here and let
  // the caller rebuild rather than surface a cryptic device-side error.
  await spawn(
    'codesign',
    ['--verify', '--deep', '--strict', bundles.runnerPath],
    { signal: options.signal }
  );
};

/**
 * Chooses the profile and bundle ids to sign with.
 *
 * An explicit `bundleIdPrefix` always decides the bundle ids, even when a
 * profile would also cover the agent's own ones. Signing otherwise or not based
 * on which profiles happen to be installed would make the agent's identity on a
 * device change as a side effect of unrelated Xcode activity, and the test
 * session's own bookkeeping — crash attribution, existing installs — keys off it.
 *
 * Without a prefix the shipped ids are used, and no profile that covers them
 * ends the attempt: the caller falls back to a local build, which can still
 * reach the Developer Portal to mint one.
 */
const resolveSigningProfile = async (
  context: XCTestAgentProviderContext,
  findProfile: (
    options: FindProvisioningProfileOptions
  ) => Promise<ProvisioningProfile | null>
) => {
  const teamId = context.signing?.teamId;

  if (!teamId) {
    return null;
  }

  const bundleIdPrefix = context.signing?.bundleIdPrefix;
  const profile = await findProfile({
    bundleIdPrefix,
    deviceId: context.deviceId,
    profile: context.signing?.provisioningProfile,
    signingIdentity: context.signing?.signingIdentity,
    signal: context.signal,
    teamId,
  });

  if (profile) {
    return { bundleIdPrefix, profile };
  }

  xctestAgentLogger.info(
    bundleIdPrefix
      ? 'No installed provisioning profile for team %s covers %s.HarnessXCTestAgent*, building the agent instead'
      : 'No installed provisioning profile for team %s covers the XCTest agent and no device.codeSign.bundleIdPrefix is configured, building the agent instead',
    teamId,
    ...(bundleIdPrefix ? [bundleIdPrefix] : [])
  );

  return null;
};

/**
 * Provider for physical devices: takes the unsigned artifact shipped with the
 * package and signs it locally for the configured device.
 *
 * Device artifacts cannot be shipped ready to run the way simulator ones can,
 * because a runnable device build embeds the consumer's certificate and a
 * profile that lists their device. Re-signing closes that gap offline in about a
 * second, versus a rebuild that also needs the Developer Portal reachable when
 * automatic signing is in use.
 *
 * It declines, leaving the local build to run, when no signing configuration or
 * no usable profile exists. Verification of the signed bundle happens inside
 * `resignXCTestAgentArtifacts`, so a bad profile surfaces as a fallback rather
 * than a device-side failure.
 */
export const createResignedDeviceXCTestAgentProvider = (options?: {
  /**
   * Profile lookup, overridable so the signing path is testable without reading
   * the machine's installed profiles.
   */
  findProfile?: (
    options: FindProvisioningProfileOptions
  ) => Promise<ProvisioningProfile | null>;
  packageRoot?: string;
}): XCTestAgentProvider => ({
  id: 'prebuilt-resigned-device',
  prepare: async (context) => {
    if (context.destination !== 'device') {
      return null;
    }

    // Checked before the profile lookup on purpose: finding a profile means
    // decoding every installed `.mobileprovision`, which is the slowest thing
    // this provider does and is pointless when no artifact matches the local
    // toolchain or the consumer never asked for signing.
    const entry = await resolvePrebuiltEntry({
      destination: context.destination,
      packageRoot: options?.packageRoot,
      signal: context.signal,
    });

    if (!entry) {
      return null;
    }

    const signing = await resolveSigningProfile(
      context,
      options?.findProfile ?? findProvisioningProfile
    );

    if (!signing) {
      return null;
    }

    // Resolved before any copying: an ambiguous or missing certificate cannot
    // sign, and naming it here beats a codesign error three steps later.
    const identity = resolveSigningIdentity({
      identity: context.signing?.signingIdentity,
      profile: signing.profile,
    });

    if (identity.error) {
      xctestAgentLogger.warn('%s Building the agent instead.', identity.error);
      return null;
    }

    // Identity and profile are baked into the copied bundles, so two runs that
    // differ in either must not share an unpacked copy.
    const variant = [
      signing.profile.uuid || signing.profile.path,
      signing.bundleIdPrefix ?? '',
      identity.identity,
    ].join('\0');
    let prepared;

    try {
      prepared = await unpackPrebuiltEntry(entry, {
        packageRoot: options?.packageRoot,
        // Signing runs on the staged copy, so a failure here leaves nothing
        // half-signed behind and the next run starts from the pristine artifact.
        prepare: (derivedDataPath) =>
          resignXCTestAgentArtifacts({
            bundleIdPrefix: signing.bundleIdPrefix,
            identity: identity.identity,
            profile: signing.profile,
            signal: context.signal,
            xctestrunPath: path.join(
              getXCTestAgentBuildProductsPath(derivedDataPath),
              entry.xctestrunRelativePath
            ),
          }),
        projectRoot: context.projectRoot,
        variant,
      });
    } catch (error) {
      context.signal?.throwIfAborted();
      xctestAgentLogger.warn(
        'Unable to re-sign prebuilt XCTest agent artifacts for the device (%s), building instead',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }

    xctestAgentLogger.info(
      'Using prebuilt XCTest agent artifacts for device target, signed with %s',
      signing.profile.name
    );

    return toPrebuiltArtifacts(prepared);
  },
});
