export type XCTestAgentTransportRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: string;
};

export type XCTestAgentTransportResponse = {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
};

export type XCTestAgentTransport = {
  dispose: () => Promise<void>;
  request: (
    request: XCTestAgentTransportRequest,
  ) => Promise<XCTestAgentTransportResponse>;
};
