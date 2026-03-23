import { spawn, SubprocessError } from '@react-native-harness/tools';

const DEBUG_HTTP_HOST_BLOCK_START =
  '<!-- react-native-harness:debug_http_host:start -->';
const DEBUG_HTTP_HOST_BLOCK_END =
  '<!-- react-native-harness:debug_http_host:end -->';

const getSharedPrefsPath = (bundleId: string) =>
  `shared_prefs/${bundleId}_preferences.xml`;

const getHarnessDebugHttpHostBlock = (host: string) =>
  [
    DEBUG_HTTP_HOST_BLOCK_START,
    `<string name="debug_http_host">${host}</string>`,
    DEBUG_HTTP_HOST_BLOCK_END,
  ].join('\n');

const stripHarnessDebugHttpHostBlock = (content: string): string =>
  content.replace(
    new RegExp(
      `\\s*${DEBUG_HTTP_HOST_BLOCK_START}\\n[\\s\\S]*?\\n${DEBUG_HTTP_HOST_BLOCK_END}\\s*`,
      'g'
    ),
    '\n'
  );

const normalizeSharedPrefsContent = (content: string | null): string => {
  if (!content?.trim()) {
    return ['<?xml version="1.0" encoding="utf-8"?>', '<map>', '</map>'].join(
      '\n'
    );
  }

  return stripHarnessDebugHttpHostBlock(content).trim();
};

const insertBeforeClosingMap = (content: string, block: string): string => {
  if (!content.includes('</map>')) {
    throw new Error('Android shared preferences file is missing </map>.');
  }

  return content.replace(/<\/map>\s*$/, `  ${block.replace(/\n/g, '\n  ')}\n</map>`);
};

const readSharedPrefsFile = async (
  adbId: string,
  bundleId: string
): Promise<string | null> => {
  try {
    const { stdout } = await spawn('adb', [
      '-s',
      adbId,
      'shell',
      `run-as ${bundleId} cat ${getSharedPrefsPath(bundleId)}`,
    ]);
    return stdout;
  } catch (error) {
    if (error instanceof SubprocessError && error.exitCode === 1) {
      return null;
    }

    throw error;
  }
};

const writeSharedPrefsFile = async (
  adbId: string,
  bundleId: string,
  content: string
): Promise<void> => {
  await spawn(
    'adb',
    [
      '-s',
      adbId,
      'shell',
      `run-as ${bundleId} sh -c 'mkdir -p shared_prefs && cat > ${getSharedPrefsPath(bundleId)}'`,
    ],
    { stdin: { string: `${content.trim()}\n` } }
  );
};

export const applyHarnessDebugHttpHost = async (
  adbId: string,
  bundleId: string,
  host: string
): Promise<void> => {
  const existingContent = await readSharedPrefsFile(adbId, bundleId);
  const normalizedContent = normalizeSharedPrefsContent(existingContent);
  const nextContent = insertBeforeClosingMap(
    normalizedContent,
    getHarnessDebugHttpHostBlock(host)
  );
  await writeSharedPrefsFile(adbId, bundleId, nextContent);
};

export const clearHarnessDebugHttpHost = async (
  adbId: string,
  bundleId: string
): Promise<void> => {
  const existingContent = await readSharedPrefsFile(adbId, bundleId);

  if (!existingContent) {
    return;
  }

  const nextContent = stripHarnessDebugHttpHostBlock(existingContent).trim();

  if (nextContent === existingContent.trim()) {
    return;
  }

  await writeSharedPrefsFile(adbId, bundleId, nextContent);
};
