import { HARNESS_BRIDGE_PATH } from '@react-native-harness/bridge';
import { getDevServerUrl } from '../utils/dev-server.js';

const ABSOLUTE_URL_PATTERN =
  /^(?<protocol>[A-Za-z][A-Za-z\d+.-]*):\/\/(?<authority>[^/?#\s]+)(?:[/?#]|$)/;

export const getWSServer = (): string => {
  const devServerUrl = parseAbsoluteUrl(getDevServerUrl());
  const protocol = devServerUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${devServerUrl.host}${HARNESS_BRIDGE_PATH}`;
};

const parseAbsoluteUrl = (
  value: string,
): {
  protocol: string;
  host: string;
} => {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(ABSOLUTE_URL_PATTERN);

  if (!match?.groups) {
    throw new TypeError(`Invalid URL: ${value}`);
  }

  const authority = stripUserInfo(match.groups.authority);

  if (!authority) {
    throw new TypeError(`Invalid URL: ${value}`);
  }

  return {
    protocol: `${match.groups.protocol.toLowerCase()}:`,
    host: normalizeHost(authority),
  };
};

const stripUserInfo = (authority: string): string => {
  const userInfoSeparatorIndex = authority.lastIndexOf('@');

  return userInfoSeparatorIndex === -1
    ? authority
    : authority.slice(userInfoSeparatorIndex + 1);
};

const normalizeHost = (host: string): string => {
  if (host.startsWith('[')) {
    const closingBracketIndex = host.indexOf(']');

    if (closingBracketIndex === -1) {
      throw new TypeError(`Invalid URL host: ${host}`);
    }

    return `${host.slice(0, closingBracketIndex + 1).toLowerCase()}${host.slice(
      closingBracketIndex + 1,
    )}`;
  }

  const portSeparatorIndex = host.lastIndexOf(':');

  if (portSeparatorIndex === -1) {
    return host.toLowerCase();
  }

  return `${host.slice(0, portSeparatorIndex).toLowerCase()}${host.slice(portSeparatorIndex)}`;
};
