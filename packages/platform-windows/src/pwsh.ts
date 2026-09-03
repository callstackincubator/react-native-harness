import { spawn } from '@react-native-harness/tools';

/**
 * Runs a PowerShell snippet non-interactively and returns its trimmed stdout.
 * `-NoProfile` keeps it fast and hermetic; `-NonInteractive` makes sure it
 * never blocks on a prompt.
 */
export const runPowerShell = async (script: string): Promise<string> => {
  const { stdout } = await spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true }
  );
  return stdout.trim();
};

/**
 * Resolves the PackageFamilyName of a deployed MSIX package from its identity
 * name (`Package.appxmanifest` `Identity/@Name`). Returns `null` when the app
 * is not deployed.
 */
export const getPackageFamilyName = async (
  identityName: string
): Promise<string | null> => {
  const pfn = await runPowerShell(
    `(Get-AppxPackage -Name '${identityName}' | Select-Object -First 1).PackageFamilyName`
  );
  return pfn === '' ? null : pfn;
};

/** Whether at least one process with the given name (no `.exe`) is running. */
export const isProcessRunning = async (
  processName: string
): Promise<boolean> => {
  try {
    const count = await runPowerShell(
      `(Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Measure-Object).Count`
    );
    return Number(count) > 0;
  } catch {
    return false;
  }
};

/**
 * Launches a deployed MSIX app by its AUMID
 * (`<PackageFamilyName>!<Application Id>`).
 *
 * `explorer.exe shell:AppsFolder\<aumid>` is the reliable activation path, but
 * `explorer.exe` almost always exits non-zero even on success, so its failure
 * is swallowed — the caller confirms the app came up by polling for its
 * process.
 */
export const launchAppByAumid = async (aumid: string): Promise<void> => {
  try {
    await spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], {
      windowsHide: true,
    });
  } catch {
    // Expected: explorer.exe reports a non-zero exit even on success.
  }
};

/** Force-terminates every process with the given name. Safe to call when none exist. */
export const stopProcess = async (processName: string): Promise<void> => {
  try {
    await runPowerShell(
      `Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Stop-Process -Force`
    );
  } catch {
    // Nothing to stop, or it exited between the query and the kill.
  }
};
