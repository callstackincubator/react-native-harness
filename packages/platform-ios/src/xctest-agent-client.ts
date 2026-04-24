import type {
  XCTestAgentTransport,
  XCTestAgentTransportResponse,
} from './xctest-agent-transport.js';

export type XCTestAgentPermissionsConfiguration = {
  autoAcceptPermissions: boolean;
};

type XCTestAgentHealthResponse = {
  permissions: XCTestAgentPermissionsConfiguration;
  status: 'ok';
};

type XCTestAgentPermissionsResponse = {
  permissions: XCTestAgentPermissionsConfiguration;
};

export type XCTestAgentClient = {
  configurePermissions: (
    permissions: XCTestAgentPermissionsConfiguration,
  ) => Promise<XCTestAgentPermissionsConfiguration>;
  dispose: () => Promise<void>;
  getPermissionsConfig: () => Promise<XCTestAgentPermissionsConfiguration>;
  health: () => Promise<XCTestAgentHealthResponse>;
};

export const createXCTestAgentClient = (
  transport: XCTestAgentTransport,
): XCTestAgentClient => {
  const requestJson = async <T>(options: {
    body?: unknown;
    method: 'GET' | 'POST';
    path: string;
  }): Promise<T> => {
    const response = await transport.request({
      method: options.method,
      path: options.path,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    return parseJsonResponse<T>(response, `${options.method} ${options.path}`);
  };

  return {
    health: () => {
      return requestJson<XCTestAgentHealthResponse>({
        method: 'GET',
        path: '/health',
      });
    },
    configurePermissions: async (permissions) => {
      const response = await requestJson<XCTestAgentPermissionsResponse>({
        method: 'POST',
        path: '/permissions/configure',
        body: permissions,
      });

      return response.permissions;
    },
    getPermissionsConfig: async () => {
      const response = await requestJson<XCTestAgentPermissionsResponse>({
        method: 'GET',
        path: '/permissions',
      });

      return response.permissions;
    },
    dispose: async () => {
      await transport.dispose();
    },
  };
};

const parseJsonResponse = <T>(
  response: XCTestAgentTransportResponse,
  operation: string,
): T => {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `XCTest agent ${operation} failed with status ${response.statusCode}: ${response.body}`,
    );
  }

  try {
    return JSON.parse(response.body) as T;
  } catch (error) {
    throw new Error(
      `XCTest agent ${operation} returned invalid JSON: ${getErrorMessage(error)}`,
    );
  }
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
