import { afterEach, describe, expect, it, vi } from 'vitest';

const findIdentity = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => findIdentity(...args),
}));

const REVOKED = 'B'.repeat(40);
const USABLE = 'A'.repeat(40);

/**
 * `security find-identity -v` lists an unusable identity and annotates it rather
 * than leaving it out, so a revoked certificate is parsed like any other unless
 * the trailing annotation is honoured. Getting this wrong costs a signing failure
 * partway through a run, or worse, names a revoked certificate as the remedy.
 */
const findIdentityOutput = `\
  1) ${REVOKED} "Apple Development: Revoked Person (TEAM000001)" (CSSMERR_TP_CERT_REVOKED)
  2) ${USABLE} "Apple Development: Working Person (TEAM000002)"
     2 valid identities found
`;

const loadResignModule = async () => {
  vi.resetModules();
  findIdentity.mockReset();
  findIdentity.mockImplementation(() => ({
    status: 0,
    stdout: Buffer.from(findIdentityOutput),
  }));

  return import('../xctest-agent-resign.js');
};

afterEach(() => {
  vi.resetModules();
});

describe('choosing a codesign identity', () => {
  it('ignores an identity the keychain reports as revoked', async () => {
    const { resolveSigningIdentity } = await loadResignModule();

    const result = resolveSigningIdentity({
      profile: {
        applicationIdentifier: 'TESTTEAM01.*',
        developerCertificateHashes: [REVOKED],
        name: 'profile',
        path: '',
        provisionedDevices: [],
        teamId: 'TESTTEAM01',
        uuid: 'uuid',
      },
    });

    expect(result.identity).not.toBe(REVOKED);
    expect(result.error).toContain('no usable');
  });

  it('prefers the usable certificate when a profile also names a revoked one', async () => {
    const { resolveSigningIdentity } = await loadResignModule();

    const result = resolveSigningIdentity({
      profile: {
        applicationIdentifier: 'TESTTEAM01.*',
        developerCertificateHashes: [REVOKED, USABLE],
        name: 'profile',
        path: '',
        provisionedDevices: [],
        teamId: 'TESTTEAM01',
        uuid: 'uuid',
      },
    });

    expect(result).toEqual({ identity: USABLE });
  });

  it('never suggests a revoked certificate as the explicit identity to set', async () => {
    const { resolveSigningIdentity } = await loadResignModule();

    // Two *usable* certificates are genuinely ambiguous and must be reported.
    findIdentity.mockImplementation(() => ({
      status: 0,
      stdout: Buffer.from(
        `  1) ${REVOKED} "Apple Development: A (T1)" (CSSMERR_TP_CERT_REVOKED)\n` +
          `  2) ${USABLE} "Apple Development: B (T2)"\n` +
          `  3) ${'C'.repeat(40)} "Apple Development: C (T3)"\n`
      ),
    }));

    const result = resolveSigningIdentity({
      profile: {
        applicationIdentifier: 'TESTTEAM01.*',
        developerCertificateHashes: [REVOKED, USABLE, 'C'.repeat(40)],
        name: 'profile',
        path: '',
        provisionedDevices: [],
        teamId: 'TESTTEAM01',
        uuid: 'uuid',
      },
    });

    expect(result.error).toContain(USABLE);
    expect(result.error).toContain('C'.repeat(40));
    expect(result.error).not.toContain(REVOKED);
  });
});
