import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return { ...actual, spawn: mocks.spawn };
});

import { findProvisioningProfile } from '../xctest-agent-resign.js';

const teamId = 'TESTTEAM01';
const device = '00008150-0000000000000000';

// The profile's certificate list is matched against the signing identity, so a
// known blob whose hash the test can compute keeps the keychain out of it.
const certificate = Buffer.from('pretend-der-certificate');
const certificateHash = crypto
  .createHash('sha1')
  .update(certificate)
  .digest('hex')
  .toUpperCase();

let tempRoot = '';

const writeProfile = (options: { devices: string[]; teamId?: string }) => {
  const profilePath = path.join(
    tempRoot,
    `${options.devices.join('-') || 'none'}.mobileprovision`
  );
  // Stand-in bytes: decoding is mocked, so only the decoded payload matters.
  fs.writeFileSync(profilePath, 'not-really-cms');
  mocks.spawn.mockImplementation(async (file: string) => {
    if (file !== 'security') {
      throw new Error(`Unexpected command ${file}`);
    }

    return {
      stdout: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Name</key><string>Test profile</string>
  <key>UUID</key><string>test-uuid</string>
  <key>TeamIdentifier</key><array><string>${
    options.teamId ?? teamId
  }</string></array>
  <key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date>
  <key>ProvisionedDevices</key><array>${options.devices
    .map((value) => `<string>${value}</string>`)
    .join('')}</array>
  <key>Entitlements</key><dict>
    <key>application-identifier</key><string>${teamId}.*</string>
  </dict>
  <key>DeveloperCertificates</key><array><data>${certificate.toString(
    'base64'
  )}</data></array>
</dict></plist>`,
    };
  });

  return profilePath;
};

const search = (profile: string) =>
  findProvisioningProfile({
    deviceId: device,
    profile,
    signingIdentity: certificateHash,
    teamId,
  });

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-profile-test-'));
  mocks.spawn.mockReset();
});

describe('a profile named by path', () => {
  it('is accepted when it lists the target device', async () => {
    const profile = writeProfile({ devices: [device] });

    await expect(search(profile)).resolves.toMatchObject({
      name: 'Test profile',
    });
  });

  it('is declined when it does not list the target device', async () => {
    // Naming a profile must not skip the device check: the profile is still what
    // the device installs, so an unlisted device would fail later as an install
    // error instead of falling back to building.
    const profile = writeProfile({ devices: ['some-other-device'] });

    await expect(search(profile)).resolves.toBeNull();
  });

  it('is declined when it belongs to another team', async () => {
    const profile = writeProfile({ devices: [device], teamId: 'OTHERTEAM1' });

    await expect(search(profile)).resolves.toBeNull();
  });
});
