import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Re-signing reads and writes plists through macOS-only `plutil`.
const canRunPlutilTests = process.platform === 'darwin';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

import {
  createResignedDeviceXCTestAgentProvider,
  getAgentApplicationIdentifiers,
  resignXCTestAgentArtifacts,
  type ProvisioningProfile,
} from '../xctest-agent-resign.js';
import {
  getPrebuiltIndexPath,
  type XCTestAgentPrebuiltIndex,
} from '../xctest-agent-prebuilt.js';
import { getAgentProjectSourcesHash } from '../xctest-agent-build.js';

const teamId = 'TESTTEAM01';
const device = '00008150-0000000000000000';
const identity = 'A'.repeat(40);

const profile: ProvisioningProfile = {
  applicationIdentifier: `${teamId}.*`,
  developerCertificateHashes: [identity],
  name: 'Wildcards for TESTTEAM01',
  path: '',
  provisionedDevices: [device],
  teamId,
  uuid: 'profile-uuid-1',
};

let tempRoot = '';
let derivedDataPath = '';
let xctestrunPath = '';
let appPath = '';
let runnerPath = '';
let pluginPath = '';

const writeBundle = (bundlePath: string, bundleId: string) => {
  fs.mkdirSync(bundlePath, { recursive: true });
  fs.writeFileSync(
    path.join(bundlePath, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>${bundleId}</string>
</dict>
</plist>
`
  );
};

const readPlist = (plistPath: string, keyPath: string) => {
  const result = spawnSync('plutil', [
    '-extract',
    keyPath,
    'raw',
    '-o',
    '-',
    plistPath,
  ]);

  return result.status === 0 ? result.stdout.toString().trim() : null;
};

const readPlistJson = (plistPath: string, keyPath: string) => {
  const result = spawnSync('plutil', [
    '-extract',
    keyPath,
    'json',
    '-o',
    '-',
    plistPath,
  ]);

  return result.status === 0
    ? (JSON.parse(result.stdout.toString()) as unknown)
    : null;
};

const mockCodesign = () => {
  const signed: string[] = [];

  mocks.spawn.mockImplementation((file: string, args?: string[]) => {
    if (file === 'codesign' && args?.[0] === '--verify') {
      return Promise.resolve({ stdout: '' });
    }

    if (file === 'codesign') {
      const targetPath = args?.length ? String(args[args.length - 1]) : '';

      signed.push(targetPath);

      // Entitlements live in a directory the implementation removes once
      // signing finishes, so their contents are captured while they exist.
      if (args?.includes('--entitlements')) {
        const entitlementsPath = args[args.indexOf('--entitlements') + 1];
        const contents = fs.readFileSync(String(entitlementsPath), 'utf8');

        entitlementSnapshot.set(targetPath, contents);
      }

      return Promise.resolve({ stdout: '' });
    }

    return Promise.resolve({ stdout: '' });
  });

  return signed;
};

/**
 * Builds the tree `xcodebuild build-for-testing` leaves behind, including the
 * `.xctestrun`'s real nesting under `TestConfigurations`/`TestTargets`, which is
 * where the runner and app-under-test paths live.
 */
const writeArtifacts = () => {
  const productsPath = path.join(derivedDataPath, 'Build', 'Products');
  const debugPath = path.join(productsPath, 'Debug-iphoneos');

  appPath = path.join(debugPath, 'HarnessXCTestAgent.app');
  runnerPath = path.join(debugPath, 'HarnessXCTestAgentUITests-Runner.app');
  pluginPath = path.join(
    runnerPath,
    'PlugIns',
    'HarnessXCTestAgentUITests.xctest'
  );

  writeBundle(appPath, 'com.callstackincubator.HarnessXCTestAgent');
  writeBundle(
    runnerPath,
    'com.callstackincubator.HarnessXCTestAgentUITests.xctrunner'
  );
  writeBundle(pluginPath, 'com.callstackincubator.HarnessXCTestAgentUITests');

  xctestrunPath = path.join(
    productsPath,
    'HarnessXCTestAgent_HarnessXCTestAgent_iphoneos27.0-arm64.xctestrun'
  );
  fs.writeFileSync(
    xctestrunPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>TestConfigurations</key>
\t<array>
\t\t<dict>
\t\t\t<key>IsEnabled</key>
\t\t\t<true/>
\t\t\t<key>Name</key>
\t\t\t<string>Test Scheme Action</string>
\t\t\t<key>TestTargets</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>IsEnabled</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>TestHostPath</key>
\t\t\t\t\t<string>__TESTROOT__/Debug-iphoneos/HarnessXCTestAgentUITests-Runner.app</string>
\t\t\t\t\t<key>TestBundlePath</key>
\t\t\t\t\t<string>__TESTHOST__/PlugIns/HarnessXCTestAgentUITests.xctest</string>
\t\t\t\t\t<key>UITargetAppPath</key>
\t\t\t\t\t<string>__TESTROOT__/Debug-iphoneos/HarnessXCTestAgent.app</string>
\t\t\t\t\t<key>TestHostBundleIdentifier</key>
\t\t\t\t\t<string>com.callstackincubator.HarnessXCTestAgentUITests.xctrunner</string>
\t\t\t\t\t<key>BundleIdentifiersForCrashReportEmphasis</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.callstackincubator.HarnessXCTestAgent</string>
\t\t\t\t\t\t<string>com.callstackincubator.HarnessXCTestAgentUITests</string>
\t\t\t\t\t\t<string>com.apple.dt.unit.testtarget</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t</array>
\t\t</dict>
\t\t</array>
</dict>
</plist>
`.replace('\t\t</array>\n</dict>', '</array>\n</dict>')
  );
};

/** Entitlement file contents, keyed by the bundle they were signed into. */
const entitlementSnapshot = new Map<string, string>();

const codesignCalls = () =>
  mocks.spawn.mock.calls.filter(
    (call) => call[0] === 'codesign' && call[1]?.[0] === '--force'
  );

/** The bundle path a `codesign` invocation targets, i.e. its last argument. */
const signedTarget = (call: unknown[]) =>
  Array.isArray(call[1]) && call[1].length > 0
    ? String(call[1][call[1].length - 1])
    : '';

const entitlementsUsedBy = (bundlePath: string) =>
  entitlementSnapshot.get(bundlePath) ?? null;

describe('re-signing prebuilt XCTest agent artifacts for a device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // These tests exercise the shipped artifacts, so a skip flag inherited from
    // the developer's shell would disable the very thing under test.
    delete process.env.HARNESS_SKIP_XCTEST_PREBUILDS;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-resign-'));
    profile.path = path.join(tempRoot, 'signing.mobileprovision');
    fs.writeFileSync(profile.path, 'profile bytes');
    derivedDataPath = path.join(tempRoot, 'derived');
    fs.mkdirSync(derivedDataPath, { recursive: true });
    writeArtifacts();
  });

  afterEach(() => {
    entitlementSnapshot.clear();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  describe.skipIf(!canRunPlutilTests)('bundle resolution', () => {
    it('signs the bundles the xctestrun points at, innermost first', async () => {
      const signed = mockCodesign();

      await resignXCTestAgentArtifacts({
        profile,
        xctestrunPath,
      });

      expect(signed).toEqual([pluginPath, runnerPath, appPath]);
    });

    it('signs frameworks embedded by Xcode 26 before the bundles holding them', async () => {
      const embedded = [
        path.join(runnerPath, 'Frameworks', 'XCTest.framework'),
        path.join(runnerPath, 'Frameworks', 'libXCTestSwiftSupport.dylib'),
      ];
      for (const embeddedPath of embedded) {
        fs.mkdirSync(path.dirname(embeddedPath), { recursive: true });
        fs.writeFileSync(path.join(runnerPath, 'Frameworks', 'Info.plist'), '');
        if (embeddedPath.endsWith('.framework')) {
          fs.mkdirSync(embeddedPath, { recursive: true });
        } else {
          fs.writeFileSync(embeddedPath, 'dylib');
        }
      }
      mockCodesign();

      await resignXCTestAgentArtifacts({ profile, xctestrunPath });

      const calls = codesignCalls();
      const embeddedCall = calls[0]?.[1] as string[];

      // Signed in one invocation, without entitlements, ahead of the runner.
      expect(embeddedCall.slice(-2).sort()).toEqual([...embedded].sort());
      expect(embeddedCall).not.toContain('--entitlements');
      expect(calls.slice(1).map(signedTarget)).toEqual([
        pluginPath,
        runnerPath,
        appPath,
      ]);
    });

    it('embeds the profile in the bundles that carry entitlements', async () => {
      mockCodesign();
      const profilePath = path.join(tempRoot, 'profile.mobileprovision');
      fs.writeFileSync(profilePath, 'profile bytes');

      await resignXCTestAgentArtifacts({
        profile: { ...profile, path: profilePath },
        xctestrunPath,
      });

      expect(
        fs
          .readFileSync(path.join(runnerPath, 'embedded.mobileprovision'))
          .toString()
      ).toBe('profile bytes');
      expect(
        fs
          .readFileSync(path.join(appPath, 'embedded.mobileprovision'))
          .toString()
      ).toBe('profile bytes');
    });

    it('gives the runner a keychain group and the app-under-test none', async () => {
      mockCodesign();

      await resignXCTestAgentArtifacts({
        profile,
        xctestrunPath,
      });

      const runnerEntitlements = entitlementsUsedBy(runnerPath);
      const appEntitlements = entitlementsUsedBy(appPath);

      expect(runnerEntitlements).toContain(
        `<key>application-identifier</key><string>${teamId}.com.callstackincubator.HarnessXCTestAgentUITests.xctrunner</string>`
      );
      expect(runnerEntitlements).toContain('keychain-access-groups');
      expect(runnerEntitlements).toContain('get-task-allow');
      expect(appEntitlements).toContain(
        `<key>application-identifier</key><string>${teamId}.com.callstackincubator.HarnessXCTestAgent</string>`
      );
      expect(appEntitlements).not.toContain('keychain-access-groups');
    });

    it('signs the nested XCTest bundle without entitlements', async () => {
      mockCodesign();

      await resignXCTestAgentArtifacts({
        profile,
        xctestrunPath,
      });

      const pluginCall = codesignCalls().find(
        (call) => signedTarget(call) === pluginPath
      );

      expect(pluginCall?.[1]).not.toContain('--entitlements');
    });

    it('verifies the signed runner strictly', async () => {
      mockCodesign();

      await resignXCTestAgentArtifacts({
        profile,
        xctestrunPath,
      });

      expect(
        mocks.spawn.mock.calls.find(
          (call) => call[0] === 'codesign' && call[1]?.[0] === '--verify'
        )?.[1]
      ).toEqual(['--verify', '--deep', '--strict', runnerPath]);
    });

    it('rejects artifacts whose xctestrun points at a missing runner', async () => {
      mockCodesign();
      fs.rmSync(runnerPath, { recursive: true });

      await expect(
        resignXCTestAgentArtifacts({ profile, xctestrunPath })
      ).rejects.toThrow(/incomplete/);
    });
  });

  describe.skipIf(!canRunPlutilTests)('bundle id remapping', () => {
    it('rewrites the Info.plists and every bundle id the xctestrun names', async () => {
      mockCodesign();

      await resignXCTestAgentArtifacts({
        bundleIdPrefix: 'com.example.consumer',
        profile,
        xctestrunPath,
      });

      const targetKey = 'TestConfigurations.0.TestTargets.0';

      expect(
        readPlist(path.join(appPath, 'Info.plist'), 'CFBundleIdentifier')
      ).toBe('com.example.consumer.HarnessXCTestAgent');
      expect(
        readPlist(path.join(runnerPath, 'Info.plist'), 'CFBundleIdentifier')
      ).toBe('com.example.consumer.HarnessXCTestAgentUITests.xctrunner');
      expect(
        readPlist(path.join(pluginPath, 'Info.plist'), 'CFBundleIdentifier')
      ).toBe('com.example.consumer.HarnessXCTestAgentUITests');
      // The session launches the runner by the id in the xctestrun, so a stale
      // value there means the bundle it looks for was never installed.
      expect(
        readPlist(xctestrunPath, `${targetKey}.TestHostBundleIdentifier`)
      ).toBe('com.example.consumer.HarnessXCTestAgentUITests.xctrunner');
      expect(
        readPlistJson(
          xctestrunPath,
          `${targetKey}.BundleIdentifiersForCrashReportEmphasis`
        )
      ).toEqual([
        'com.example.consumer.HarnessXCTestAgent',
        'com.example.consumer.HarnessXCTestAgentUITests',
        'com.apple.dt.unit.testtarget',
      ]);
    });

    it('derives entitlements from the remapped ids', async () => {
      mockCodesign();

      await resignXCTestAgentArtifacts({
        bundleIdPrefix: 'com.example.consumer',
        profile,
        xctestrunPath,
      });

      expect(entitlementsUsedBy(runnerPath)).toContain(
        `<string>${teamId}.com.example.consumer.HarnessXCTestAgentUITests.xctrunner</string>`
      );
      expect(entitlementsUsedBy(appPath)).toContain(
        `<string>${teamId}.com.example.consumer.HarnessXCTestAgent</string>`
      );
    });

    it('accepts a prefix with or without a trailing dot', async () => {
      mockCodesign();

      await resignXCTestAgentArtifacts({
        bundleIdPrefix: 'com.example.consumer.',
        profile,
        xctestrunPath,
      });

      expect(
        readPlist(path.join(appPath, 'Info.plist'), 'CFBundleIdentifier')
      ).toBe('com.example.consumer.HarnessXCTestAgent');
    });

    it('leaves already-remapped artifacts alone', async () => {
      mockCodesign();
      fs.writeFileSync(
        path.join(appPath, 'Info.plist'),
        fs
          .readFileSync(path.join(appPath, 'Info.plist'), 'utf8')
          .replace(
            'com.callstackincubator.HarnessXCTestAgent',
            'com.example.consumer.HarnessXCTestAgent'
          )
      );

      await resignXCTestAgentArtifacts({
        bundleIdPrefix: 'com.example.consumer',
        profile,
        xctestrunPath,
      });

      expect(
        readPlist(path.join(appPath, 'Info.plist'), 'CFBundleIdentifier')
      ).toBe('com.example.consumer.HarnessXCTestAgent');
    });
  });

  describe('profile application identifiers', () => {
    it('asks about the app-under-test and runner, team-qualified', () => {
      expect(
        getAgentApplicationIdentifiers({
          teamId,
        })
      ).toEqual([
        `${teamId}.com.callstackincubator.HarnessXCTestAgent`,
        `${teamId}.com.callstackincubator.HarnessXCTestAgentUITests.xctrunner`,
      ]);
    });

    it('asks about the remapped ids when a prefix is configured', () => {
      expect(
        getAgentApplicationIdentifiers({
          bundleIdPrefix: 'com.example.consumer',
          teamId,
        })
      ).toEqual([
        `${teamId}.com.example.consumer.HarnessXCTestAgent`,
        `${teamId}.com.example.consumer.HarnessXCTestAgentUITests.xctrunner`,
      ]);
    });
  });

  describe('provider', () => {
    const xcodeVersion = '27.0';
    const xcodeBuild = '17A400';
    const deviceSdkVersion = '27.0';
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          'package.json'
        ),
        'utf8'
      )
    ) as { version: string };

    let packageRoot = '';
    let projectRoot = '';
    let profileLookup: ReturnType<typeof vi.fn> = vi.fn();

    const writeDeviceArtifact = (directoryName: string) => {
      const productsPath = path.join(
        packageRoot,
        'xctest-agent-prebuilds',
        directoryName,
        'Build',
        'Products'
      );
      const debugPath = path.join(productsPath, 'Debug-iphoneos');

      writeBundle(
        path.join(debugPath, 'HarnessXCTestAgent.app'),
        'com.callstackincubator.HarnessXCTestAgent'
      );
      writeBundle(
        path.join(debugPath, 'HarnessXCTestAgentUITests-Runner.app'),
        'com.callstackincubator.HarnessXCTestAgentUITests.xctrunner'
      );
      writeBundle(
        path.join(
          debugPath,
          'HarnessXCTestAgentUITests-Runner.app',
          'PlugIns',
          'HarnessXCTestAgentUITests.xctest'
        ),
        'com.callstackincubator.HarnessXCTestAgentUITests'
      );

      const xctestrunName = 'HarnessXCTestAgent_iphoneos.xctestrun';

      fs.writeFileSync(
        path.join(productsPath, xctestrunName),
        fs.readFileSync(xctestrunPath, 'utf8')
      );

      return xctestrunName;
    };

    const writeDeviceIndex = (options?: {
      directoryName?: string;
      xcodeVersion?: string;
    }) => {
      const directoryName = options?.directoryName ?? 'device-abc123';
      const xctestrunName = writeDeviceArtifact(directoryName);
      const indexPath = getPrebuiltIndexPath(packageRoot);

      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      fs.writeFileSync(
        indexPath,
        JSON.stringify(
          {
            entries: [
              {
                agentVersion: packageJson.version,
                buildInputsHash: getAgentProjectSourcesHash(),
                destination: 'device',
                directoryName,
                sdkVersion: deviceSdkVersion,
                xctestrunRelativePath: xctestrunName,
                xcodeBuild,
                xcodeVersion: options?.xcodeVersion ?? xcodeVersion,
              },
            ],
            schemaVersion: 1,
          } satisfies XCTestAgentPrebuiltIndex,
          null,
          2
        )
      );

      return { directoryName, xctestrunName };
    };

    const makeProvider = () =>
      createResignedDeviceXCTestAgentProvider({
        findProfile: profileLookup,
        packageRoot,
      });

    const deviceContext = () => ({
      deviceId: device,
      destination: 'device' as const,
      projectRoot,
      signing: { signingIdentity: identity, teamId },
    });

    beforeEach(() => {
      packageRoot = path.join(tempRoot, 'package');
      projectRoot = path.join(tempRoot, 'project');
      fs.mkdirSync(packageRoot, { recursive: true });
      fs.mkdirSync(projectRoot, { recursive: true });
      profileLookup = vi.fn(async () => profile);
      mockCodesign();

      mocks.spawn.mockImplementation((file: string, args?: string[]) => {
        if (file === 'xcodebuild' && args?.join(' ') === '-version') {
          return Promise.resolve({
            stdout: `Xcode ${xcodeVersion}\nBuild version ${xcodeBuild}`,
          });
        }

        if (
          file === 'xcodebuild' &&
          args?.join(' ') === '-version -sdk iphoneos SDKVersion'
        ) {
          return Promise.resolve({ stdout: deviceSdkVersion });
        }

        return Promise.resolve({ stdout: '' });
      });
    });

    it('declines simulator runs', async () => {
      await expect(
        makeProvider().prepare({ destination: 'simulator', projectRoot })
      ).resolves.toBeNull();
      expect(profileLookup).not.toHaveBeenCalled();
    });

    it('declines before reading any profile when the package ships no artifact', async () => {
      await expect(makeProvider().prepare(deviceContext())).resolves.toBeNull();
      // Profile discovery decodes every installed .mobileprovision, so a run
      // that has no usable artifact must not trigger it.
      expect(profileLookup).not.toHaveBeenCalled();
    });

    it('declines when no signing configuration exists', async () => {
      writeDeviceIndex();

      await expect(
        makeProvider().prepare({ destination: 'device', projectRoot })
      ).resolves.toBeNull();
      expect(profileLookup).not.toHaveBeenCalled();
    });

    it('declines when no profile can sign the agent', async () => {
      writeDeviceIndex();
      profileLookup = vi.fn(async () => null);

      await expect(makeProvider().prepare(deviceContext())).resolves.toBeNull();
      expect(codesignCalls()).toHaveLength(0);
    });

    it('declines on an Xcode older than the supported minimum', async () => {
      writeDeviceIndex();
      const baseImplementation = mocks.spawn.getMockImplementation();
      mocks.spawn.mockImplementation((file: string, args?: string[]) =>
        file === 'xcodebuild' && args?.join(' ') === '-version'
          ? Promise.resolve({ stdout: 'Xcode 16.4\nBuild version 16F6' })
          : baseImplementation?.(file, args)
      );

      await expect(makeProvider().prepare(deviceContext())).resolves.toBeNull();
      expect(profileLookup).not.toHaveBeenCalled();
      expect(codesignCalls()).toHaveLength(0);
    });

    it.skipIf(!canRunPlutilTests)('signs a copy in the project cache and leaves the packaged artifact unsigned', async () => {
      const { directoryName, xctestrunName } = writeDeviceIndex();

      const artifacts = await makeProvider().prepare(deviceContext());

      expect(artifacts?.source).toBe('prebuilt');
      if (artifacts?.launch.kind !== 'xctestrun') {
        throw new Error('Expected an xctestrun launch input');
      }

      const unpackedRoot = artifacts.launch.derivedDataPath;

      expect(path.basename(unpackedRoot)).toMatch(
        /^xctest-agent-prebuilt-device-abc123-/
      );
      expect(artifacts.launch.xctestrunPath).toBe(
        path.join(unpackedRoot, 'Build', 'Products', xctestrunName)
      );

      const signed = codesignCalls();

      expect(signed).toHaveLength(3);
      // Signing runs on a staged copy that is renamed into place afterwards, so
      // compare paths below each copy's products directory.
      expect(
        signed.map(
          (call) =>
            signedTarget(call).split(
              `${path.sep}Build${path.sep}Products${path.sep}`
            )[1]
        )
      ).toEqual([
        path.join(
          'Debug-iphoneos',
          'HarnessXCTestAgentUITests-Runner.app',
          'PlugIns',
          'HarnessXCTestAgentUITests.xctest'
        ),
        path.join('Debug-iphoneos', 'HarnessXCTestAgentUITests-Runner.app'),
        path.join('Debug-iphoneos', 'HarnessXCTestAgent.app'),
      ]);
      expect(
        fs
          .readdirSync(path.dirname(unpackedRoot))
          .filter((entry) => entry.includes('.staging-'))
      ).toEqual([]);
      expect(directoryName).toBe('device-abc123');

      // The packaged artifact is shared by every project on the machine, so it
      // must never carry a signature for one consumer's identity.
      const packagedProducts = path.join(
        packageRoot,
        'xctest-agent-prebuilds',
        directoryName,
        'Build',
        'Products'
      );

      for (const bundle of [
        'HarnessXCTestAgentUITests-Runner.app',
        'HarnessXCTestAgent.app',
      ]) {
        expect(
          fs.existsSync(
            path.join(
              packagedProducts,
              'Debug-iphoneos',
              bundle,
              'embedded.mobileprovision'
            )
          )
        ).toBe(false);
      }
    });

    it('asks the profile lookup about the target device', async () => {
      writeDeviceIndex();

      await makeProvider().prepare(deviceContext());

      expect(profileLookup).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: device, teamId })
      );
    });

    it.skipIf(!canRunPlutilTests)('signs under the configured bundle id prefix', async () => {
      writeDeviceIndex();

      const artifacts = await makeProvider().prepare({
        ...deviceContext(),
        signing: {
          bundleIdPrefix: 'com.example.consumer',
          signingIdentity: identity,
          teamId,
        },
      });

      if (artifacts?.launch.kind !== 'xctestrun') {
        throw new Error('Expected an xctestrun launch input');
      }

      expect(
        readPlist(
          path.join(
            path.dirname(artifacts.launch.xctestrunPath),
            'Debug-iphoneos',
            'HarnessXCTestAgent.app',
            'Info.plist'
          ),
          'CFBundleIdentifier'
        )
      ).toBe('com.example.consumer.HarnessXCTestAgent');
      // A configured prefix decides the bundle ids outright, so the lookup is
      // asked about the remapped names and never about the shipped ones.
      expect(profileLookup).toHaveBeenCalledTimes(1);
      expect(profileLookup).toHaveBeenCalledWith(
        expect.objectContaining({ bundleIdPrefix: 'com.example.consumer' })
      );
    });

    it('declines when the configured prefix matches no profile, even if the shipped ids would', async () => {
      writeDeviceIndex();
      profileLookup = vi.fn(async (options: { bundleIdPrefix?: string }) =>
        options.bundleIdPrefix ? null : profile
      );

      await expect(
        makeProvider().prepare({
          ...deviceContext(),
          signing: {
            bundleIdPrefix: 'com.example.consumer',
            signingIdentity: identity,
            teamId,
          },
        })
      ).resolves.toBeNull();
      expect(codesignCalls()).toHaveLength(0);
    });

    it.skipIf(!canRunPlutilTests)('signs once and reuses the signed copy', async () => {
      writeDeviceIndex();
      const provider = makeProvider();

      await provider.prepare(deviceContext());
      expect(codesignCalls()).toHaveLength(3);

      await provider.prepare(deviceContext());
      expect(codesignCalls()).toHaveLength(3);
    });

    it('falls back to building when signing fails, leaving nothing half-signed', async () => {
      const { directoryName } = writeDeviceIndex();
      mocks.spawn.mockImplementation((file: string, args?: string[]) => {
        if (file === 'xcodebuild') {
          return Promise.resolve({
            stdout:
              args?.join(' ') === '-version'
                ? `Xcode ${xcodeVersion}\nBuild version ${xcodeBuild}`
                : deviceSdkVersion,
          });
        }

        if (file === 'codesign' && args?.[0] === '--verify') {
          return Promise.reject(
            new Error(
              'resource fork, Finder information, or similar detritus not allowed'
            )
          );
        }

        return Promise.resolve({ stdout: '' });
      });

      await expect(makeProvider().prepare(deviceContext())).resolves.toBeNull();

      // Unpacked copies are named `xctest-agent-prebuilt-<directoryName>-<hash>`,
      // so filtering on the artifact's own directory name would match nothing and
      // the assertion would pass even if the half-signed copy were left behind.
      const cacheRoot = path.join(projectRoot, '.harness', 'cache');
      const leftovers = fs
        .readdirSync(cacheRoot)
        .filter((entry) =>
          entry.startsWith(`xctest-agent-prebuilt-${directoryName}`)
        );

      expect(leftovers).toEqual([]);
    });

    it.skipIf(!canRunPlutilTests)('keys the cache by profile so switching identities re-signs', async () => {
      writeDeviceIndex();
      const otherProfile = { ...profile, uuid: 'profile-uuid-2' };
      profileLookup = vi.fn(async () => profile);

      const first = await makeProvider().prepare(deviceContext());
      expect(codesignCalls()).toHaveLength(3);

      profileLookup = vi.fn(async () => otherProfile);
      const second = await makeProvider().prepare(deviceContext());

      expect(codesignCalls()).toHaveLength(6);
      if (
        first?.launch.kind !== 'xctestrun' ||
        second?.launch.kind !== 'xctestrun'
      ) {
        throw new Error('Expected xctestrun launch inputs');
      }
      expect(second.launch.derivedDataPath).not.toBe(
        first.launch.derivedDataPath
      );
    });
  });
});
