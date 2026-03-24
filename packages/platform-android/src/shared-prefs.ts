import { spawn, SubprocessError } from '@react-native-harness/tools';

const DEBUG_HTTP_HOST_BLOCK_START =
  '<!-- react-native-harness:debug_http_host:start -->';
const DEBUG_HTTP_HOST_BLOCK_END =
  '<!-- react-native-harness:debug_http_host:end -->';
const DEBUG_HTTP_HOST_BACKUP_KEY = 'harness_debug_http_host_backup';

const getSharedPrefsPath = (bundleId: string) =>
  `shared_prefs/${bundleId}_preferences.xml`;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const unescapeXml = (value: string): string =>
  value
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');

const getStringPreferenceRegex = (key: string) =>
  new RegExp(
    `<string\\s+name="${escapeRegExp(key)}">([\\s\\S]*?)<\\/string>`,
    'g'
  );

const getStringPreferenceValue = (
  content: string,
  key: string
): string | null => {
  const matches = [...content.matchAll(getStringPreferenceRegex(key))];
  const value = matches.at(-1)?.[1];

  return value == null ? null : unescapeXml(value);
};

const renameStringPreference = (
  content: string,
  fromKey: string,
  toKey: string
): string =>
  content.replace(
    new RegExp(
      `(<string\\s+name=")${escapeRegExp(fromKey)}(">[\\s\\S]*?<\\/string>)`,
      'g'
    ),
    `$1${toKey}$2`
  );

const stripStringPreference = (content: string, key: string): string =>
  content.replace(
    new RegExp(
      `\\s*<string\\s+name="${escapeRegExp(key)}">[\\s\\S]*?<\\/string>\\s*`,
      'g'
    ),
    '\n'
  );

const normalizeEmptyMap = (content: string): string =>
  content.replace(/<map\s*\/>/g, '<map>\n</map>');

const getHarnessDebugHttpHostBlock = (host: string) =>
  [
    DEBUG_HTTP_HOST_BLOCK_START,
    `<string name="debug_http_host">${escapeXml(host)}</string>`,
    DEBUG_HTTP_HOST_BLOCK_END,
  ].join('\n');

const stripHarnessDebugHttpHostBlock = (content: string): string =>
  content.replace(
    new RegExp(
      `\\s*${escapeRegExp(
        DEBUG_HTTP_HOST_BLOCK_START
      )}\\s*\\n[\\s\\S]*?\\n\\s*${escapeRegExp(DEBUG_HTTP_HOST_BLOCK_END)}\\s*`,
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

  return normalizeEmptyMap(stripHarnessDebugHttpHostBlock(content)).trim();
};

const insertBeforeClosingMap = (content: string, block: string): string => {
  if (!content.includes('</map>')) {
    throw new Error('Android shared preferences file is missing </map>.');
  }

  return content.replace(
    /<\/map>\s*$/,
    `  ${block.replace(/\n/g, '\n  ')}\n</map>`
  );
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
      `run-as ${bundleId} sh -c 'mkdir -p shared_prefs && cat > ${getSharedPrefsPath(
        bundleId
      )}'`,
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
  const existingHost = getStringPreferenceValue(
    normalizedContent,
    'debug_http_host'
  );
  const contentWithBackup =
    existingHost == null
      ? normalizedContent
      : renameStringPreference(
          stripStringPreference(normalizedContent, DEBUG_HTTP_HOST_BACKUP_KEY),
          'debug_http_host',
          DEBUG_HTTP_HOST_BACKUP_KEY
        );
  const nextContent = insertBeforeClosingMap(
    contentWithBackup,
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

  const nextContentWithoutHarnessBlock =
    stripHarnessDebugHttpHostBlock(existingContent).trim();

  if (nextContentWithoutHarnessBlock === existingContent.trim()) {
    return;
  }

  const restoredContent = renameStringPreference(
    nextContentWithoutHarnessBlock,
    DEBUG_HTTP_HOST_BACKUP_KEY,
    'debug_http_host'
  );

  await writeSharedPrefsFile(
    adbId,
    bundleId,
    normalizeEmptyMap(restoredContent).trim()
  );
};
