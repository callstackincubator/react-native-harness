import { logger, spawn, type Subprocess } from '@react-native-harness/tools';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const xctestAgentLogger = logger.child('ios-xctest-agent');

const XCTEST_AGENT_PROJECT_NAME = 'HarnessXCTestAgent';
const XCTEST_AGENT_SCHEME_NAME = 'HarnessXCTestAgent';

type XCTestAgentTarget =
  | {
      kind: 'simulator';
      id: string;
    }
  | {
      kind: 'device';
      id: string;
    };

export type XCTestAgentCapability = {
  getLaunchEnvironment?: () => Record<string, string>;
};

type XCTestAgentBuildManifest = {
  buildInputsHash: string;
  destinationKind: XCTestAgentTarget['kind'];
};

export type XCTestAgentController = {
  prepare: () => Promise<void>;
  ensureStarted: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
};

const getXCTestAgentProjectRoot = (): string => {
  return fileURLToPath(new URL('../xctest-agent', import.meta.url));
};

const getXCTestAgentProjectFilePath = (): string => {
  return path.join(
    getXCTestAgentProjectRoot(),
    `${XCTEST_AGENT_PROJECT_NAME}.xcodeproj`,
  );
};

const getXCTestAgentSpecPath = (): string => {
  return path.join(getXCTestAgentProjectRoot(), 'project.yml');
};

const getXCTestAgentBuildRoot = (): string => {
  return path.join(getXCTestAgentProjectRoot(), 'build');
};

const getXCTestAgentDerivedDataPath = (target: XCTestAgentTarget): string => {
  return path.join(getXCTestAgentBuildRoot(), target.kind);
};

const getXCTestAgentBuildManifestPath = (target: XCTestAgentTarget): string => {
  return path.join(
    getXCTestAgentDerivedDataPath(target),
    'build-manifest.json',
  );
};

const getXCTestAgentDestination = (target: XCTestAgentTarget): string => {
  return target.kind === 'simulator'
    ? `platform=iOS Simulator,id=${target.id}`
    : `platform=iOS,id=${target.id}`;
};

const getXCTestAgentBuildProductsPath = (target: XCTestAgentTarget): string => {
  return path.join(getXCTestAgentDerivedDataPath(target), 'Build', 'Products');
};

const readBuildManifest = (
  target: XCTestAgentTarget,
): XCTestAgentBuildManifest | null => {
  const manifestPath = getXCTestAgentBuildManifestPath(target);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as XCTestAgentBuildManifest;
};

const writeBuildManifest = (
  target: XCTestAgentTarget,
  manifest: XCTestAgentBuildManifest,
) => {
  fs.mkdirSync(getXCTestAgentDerivedDataPath(target), { recursive: true });
  fs.writeFileSync(
    getXCTestAgentBuildManifestPath(target),
    JSON.stringify(manifest, null, 2),
  );
};

const getProjectInputFilePaths = (root: string): string[] => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === 'build' ||
      entry.name.endsWith('.xcodeproj') ||
      entry.name === '.gitignore'
    ) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...getProjectInputFilePaths(entryPath));
      continue;
    }

    files.push(entryPath);
  }

  return files.sort();
};

const getProjectInputsHash = (): string => {
  const projectRoot = getXCTestAgentProjectRoot();
  const hash = createHash('sha256');

  for (const filePath of getProjectInputFilePaths(projectRoot)) {
    hash.update(path.relative(projectRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  return hash.digest('hex');
};

const shouldReuseBuildArtifacts = (
  target: XCTestAgentTarget,
  buildInputsHash: string,
): boolean => {
  const manifest = readBuildManifest(target);

  if (!manifest) {
    return false;
  }

  if (
    manifest.buildInputsHash !== buildInputsHash ||
    manifest.destinationKind !== target.kind
  ) {
    return false;
  }

  return fs.existsSync(getXCTestAgentBuildProductsPath(target));
};

const createProcessStopper = async (process: Subprocess | null) => {
  if (!process) {
    return;
  }

  try {
    (await process.nodeChildProcess).kill();
  } catch {
    // Ignore agent shutdown failures during teardown.
  }
};

export const createXCTestAgentController = (options: {
  target: XCTestAgentTarget;
  capabilities?: XCTestAgentCapability[];
}): XCTestAgentController => {
  const { target } = options;
  const capabilities = options.capabilities ?? [];
  let prepared = false;
  let agentProcess: Subprocess | null = null;
  let processTask: Promise<void> | null = null;

  const getLaunchEnvironment = (): Record<string, string> => {
    return Object.assign(
      {},
      ...capabilities.map(
        (capability) => capability.getLaunchEnvironment?.() ?? {},
      ),
    );
  };

  const prepare = async () => {
    if (prepared) {
      return;
    }

    const projectRoot = getXCTestAgentProjectRoot();
    const buildInputsHash = getProjectInputsHash();

    xctestAgentLogger.debug(
      'generating XCTest agent project for %s',
      target.kind,
    );
    await spawn('xcodegen', [
      'generate',
      '--spec',
      getXCTestAgentSpecPath(),
      '--project',
      projectRoot,
    ]);

    if (shouldReuseBuildArtifacts(target, buildInputsHash)) {
      prepared = true;
      xctestAgentLogger.debug(
        'reusing cached XCTest agent build for %s',
        target.kind,
      );
      return;
    }

    fs.mkdirSync(getXCTestAgentBuildRoot(), { recursive: true });

    xctestAgentLogger.debug('building XCTest agent for %s', target.kind);
    await spawn('xcodebuild', [
      'build-for-testing',
      '-project',
      getXCTestAgentProjectFilePath(),
      '-scheme',
      XCTEST_AGENT_SCHEME_NAME,
      '-destination',
      getXCTestAgentDestination(target),
      '-derivedDataPath',
      getXCTestAgentDerivedDataPath(target),
    ]);

    writeBuildManifest(target, {
      buildInputsHash,
      destinationKind: target.kind,
    });
    prepared = true;
  };

  const ensureStarted = async () => {
    await prepare();

    if (agentProcess) {
      return;
    }

    xctestAgentLogger.debug('starting XCTest agent for %s', target.kind);
    agentProcess = spawn(
      'xcodebuild',
      [
        'test-without-building',
        '-project',
        getXCTestAgentProjectFilePath(),
        '-scheme',
        XCTEST_AGENT_SCHEME_NAME,
        '-destination',
        getXCTestAgentDestination(target),
        '-derivedDataPath',
        getXCTestAgentDerivedDataPath(target),
      ],
      {
        cwd: getXCTestAgentProjectRoot(),
        env: {
          ...process.env,
          ...getLaunchEnvironment(),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const currentProcess = agentProcess;

    processTask = (async () => {
      try {
        for await (const line of currentProcess) {
          xctestAgentLogger.debug('[agent:%s] %s', target.kind, line);
        }
      } catch (error) {
        xctestAgentLogger.debug('XCTest agent process stopped', error);
      } finally {
        if (agentProcess === currentProcess) {
          agentProcess = null;
          processTask = null;
        }
      }
    })();
  };

  const stop = async () => {
    const currentProcess = agentProcess;
    agentProcess = null;

    await createProcessStopper(currentProcess);
    await processTask;
    processTask = null;
  };

  return {
    prepare,
    ensureStarted,
    stop,
    dispose: async () => {
      await stop();
    },
  };
};
