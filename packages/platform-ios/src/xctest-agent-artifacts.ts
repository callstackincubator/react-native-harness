import { logger } from '@react-native-harness/tools';

const xctestAgentLogger = logger.child('ios-xctest-agent');

export type XCTestAgentBuildDestination = 'simulator' | 'device';

export type XCTestAgentBuildSigning = {
  /** Rewrites the agent's bundle ids; see `ApplePhysicalDeviceCodeSign`. */
  bundleIdPrefix?: string;
  provisioningProfile?: string;
  signingIdentity?: string;
  teamId?: string;
};

/**
 * How a prepared artifact set reached the machine it runs from.
 *
 * - `external`: supplied through `HARNESS_IOS_XCTESTRUN_FILE`.
 * - `prebuilt`: shipped with the package and unpacked from it.
 * - `build`: produced locally with `xcodebuild build-for-testing`.
 */
export type XCTestAgentArtifactSource = 'external' | 'prebuilt' | 'build';

/**
 * Everything `xcodebuild test-without-building` needs in order to launch the
 * agent. The provider decides which form the launch input takes, so the
 * controller never has to know whether artifacts came from a build or a
 * download.
 */
export type XCTestAgentLaunchInput =
  | {
      derivedDataPath: string;
      kind: 'project';
      projectFilePath: string;
      scheme: string;
    }
  | {
      derivedDataPath: string;
      kind: 'xctestrun';
      xctestrunPath: string;
    };

export type XCTestAgentArtifacts = {
  launch: XCTestAgentLaunchInput;
  source: XCTestAgentArtifactSource;
};

export type XCTestAgentProviderContext = {
  /** UDID of the target device. Device providers need it to check a profile covers it. */
  deviceId?: string;
  destination: XCTestAgentBuildDestination;
  /** Consumer project root, used as the anchor for `.harness` paths. */
  projectRoot: string;
  /** Signing request for device runs. Providers that cannot honour it must decline. */
  signing?: XCTestAgentBuildSigning;
  signal?: AbortSignal;
};

/**
 * A way of obtaining a runnable XCTest agent. Providers are consulted in
 * order and the first one that returns artifacts wins. Returning `null` means
 * "not applicable here, try the next provider"; throwing means the run should
 * fail rather than silently fall back.
 */
export type XCTestAgentProvider = {
  id: string;
  prepare: (
    context: XCTestAgentProviderContext
  ) => XCTestAgentArtifacts | null | Promise<XCTestAgentArtifacts | null>;
};

export const resolveXCTestAgentArtifacts = async (
  providers: XCTestAgentProvider[],
  context: XCTestAgentProviderContext
): Promise<XCTestAgentArtifacts> => {
  const attempted: string[] = [];

  for (const provider of providers) {
    xctestAgentLogger.debug(
      'trying XCTest agent artifact provider %s for %s',
      provider.id,
      context.destination
    );

    const artifacts = await provider.prepare(context);

    if (!artifacts) {
      attempted.push(provider.id);
      continue;
    }

    xctestAgentLogger.debug(
      'XCTest agent artifacts for %s provided by %s',
      context.destination,
      provider.id
    );

    return artifacts;
  }

  throw new Error(
    `Unable to prepare XCTest agent artifacts for ${context.destination}: no provider supplied artifacts (tried ${attempted.join(', ') || 'none'}).`
  );
};
