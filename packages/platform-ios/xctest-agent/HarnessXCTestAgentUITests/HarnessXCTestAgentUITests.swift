import XCTest
import Network

final class HarnessXCTestAgentState {
  private let lock = NSLock()
  private var _permissions: PermissionPromptConfiguration

  init(permissions: PermissionPromptConfiguration) {
    _permissions = permissions
  }

  var permissions: PermissionPromptConfiguration {
    lock.lock()
    defer { lock.unlock() }
    return _permissions
  }

  func updatePermissions(_ permissions: PermissionPromptConfiguration) {
    lock.lock()
    _permissions = permissions
    lock.unlock()
  }
}

private struct XCTestAgentHealthResponse: Codable {
  let permissions: PermissionPromptConfiguration
  let status: String
}

private struct XCTestAgentPermissionsResponse: Codable {
  let permissions: PermissionPromptConfiguration
}


private struct XCTestAgentRequest {
  let body: Data
  let method: String
  let path: String
}

private struct XCTestAgentResponse {
  let body: Data
  let statusCode: Int
}

private final class XCTestAgentHTTPServer {
  private let encoder = JSONEncoder()
  private let handler: (XCTestAgentRequest) -> XCTestAgentResponse
  private let listener: NWListener
  private let queue = DispatchQueue(label: "dev.reactnativeharness.xctest-agent.http")

  init(port: UInt16, handler: @escaping (XCTestAgentRequest) -> XCTestAgentResponse) throws {
    guard let listenerPort = NWEndpoint.Port(rawValue: port) else {
      throw NSError(domain: "HarnessXCTestAgent", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Invalid XCTest agent port \(port)"
      ])
    }

    self.listener = try NWListener(using: .tcp, on: listenerPort)
    self.handler = handler
  }

  func start(log: @escaping (String) -> Void) {
    listener.newConnectionHandler = { [weak self] connection in
      self?.handle(connection: connection, log: log)
    }
    listener.stateUpdateHandler = { state in
      log("HTTP listener state: \(String(describing: state))")
    }
    listener.start(queue: queue)
  }

  func stop() {
    listener.cancel()
  }

  private func handle(connection: NWConnection, log: @escaping (String) -> Void) {
    connection.start(queue: queue)
    receive(on: connection, buffer: Data(), log: log)
  }

  private func receive(on connection: NWConnection, buffer: Data, log: @escaping (String) -> Void) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
      [weak self] data, _, isComplete, error in
      guard let self else {
        connection.cancel()
        return
      }

      if let error {
        log("HTTP receive failed: \(error.localizedDescription)")
        connection.cancel()
        return
      }

      var nextBuffer = buffer
      if let data {
        nextBuffer.append(data)
      }

      if let request = self.parseRequest(from: nextBuffer) {
        let response = self.handler(request)
        self.send(response: response, on: connection, log: log)
        return
      }

      if isComplete {
        connection.cancel()
        return
      }

      self.receive(on: connection, buffer: nextBuffer, log: log)
    }
  }

  private func parseRequest(from data: Data) -> XCTestAgentRequest? {
    guard let headerRange = data.range(of: Data("\r\n\r\n".utf8)) else {
      return nil
    }

    let headerData = data[..<headerRange.lowerBound]
    guard let headerText = String(data: headerData, encoding: .utf8) else {
      return nil
    }

    let headerLines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false)
    guard let requestLine = headerLines.first else {
      return nil
    }

    let requestLineParts = requestLine.split(separator: " ")
    guard requestLineParts.count >= 2 else {
      return nil
    }

    let contentLength = headerLines.dropFirst().reduce(0) { partialResult, line in
      let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
      guard parts.count == 2 else {
        return partialResult
      }

      return parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "content-length"
        ? (Int(parts[1].trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0)
        : partialResult
    }

    let bodyStart = headerRange.upperBound
    let bodyEnd = data.index(bodyStart, offsetBy: contentLength, limitedBy: data.endIndex)

    guard let bodyEnd else {
      return nil
    }

    return XCTestAgentRequest(
      body: data[bodyStart..<bodyEnd],
      method: String(requestLineParts[0]),
      path: String(requestLineParts[1])
    )
  }

  private func send(response: XCTestAgentResponse, on connection: NWConnection, log: @escaping (String) -> Void) {
    let statusText = response.statusCode == 200 ? "OK" : "Error"
    let header = "HTTP/1.1 \(response.statusCode) \(statusText)\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: \(response.body.count)\r\n\r\n"
    let payload = Data(header.utf8) + response.body

    connection.send(content: payload, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed { error in
      if let error {
        log("HTTP send failed: \(error.localizedDescription)")
      }

      connection.cancel()
    })
  }

  func encode<T: Encodable>(_ value: T) -> Data {
    return (try? encoder.encode(value)) ?? Data("{}".utf8)
  }
}

final class HarnessXCTestAgentUITests: XCTestCase {
  private enum Environment {
    static let targetBundleIdentifier = "HARNESS_XCTEST_AGENT_TARGET_BUNDLE_ID"
  }

  private enum Constants {
    static let defaultSessionDuration: TimeInterval = 60 * 60
    static let tickInterval: TimeInterval = 1
  }

  private let state = HarnessXCTestAgentState(
    permissions: PermissionPromptConfiguration.fromEnvironment()
  )
  private var lastTargetApplicationState: XCUIApplication.State?
  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private var capabilities: [AgentCapability] = []
  private var httpServer: XCTestAgentHTTPServer?

  private func log(_ message: String) {
    NSLog("[HarnessXCTestAgent] %@", message)
  }

  private func makeTargetApplication() -> XCUIApplication? {
    if let bundleIdentifier = ProcessInfo.processInfo.environment[Environment.targetBundleIdentifier], !bundleIdentifier.isEmpty {
      return XCUIApplication(bundleIdentifier: bundleIdentifier)
    }

    return nil
  }

  private func observeTargetApplication() {
    guard let targetApplication = makeTargetApplication() else {
      return
    }

    let currentState = targetApplication.state
    if currentState == lastTargetApplicationState {
      return
    }

    lastTargetApplicationState = currentState
    log("target application state changed: \(String(describing: currentState))")
  }

  private func jsonResponse<T: Encodable>(_ value: T) -> XCTestAgentResponse {
    guard let httpServer else {
      return XCTestAgentResponse(body: Data("{}".utf8), statusCode: 500)
    }

    return XCTestAgentResponse(body: httpServer.encode(value), statusCode: 200)
  }

  private func handleRequest(_ request: XCTestAgentRequest) -> XCTestAgentResponse {
    switch (request.method, request.path) {
    case ("GET", "/health"):
      return jsonResponse(
        XCTestAgentHealthResponse(
          permissions: state.permissions,
          status: "ok"
        )
      )
    case ("POST", "/permissions/configure"):
      guard let configuration = try? JSONDecoder().decode(
        PermissionPromptConfiguration.self,
        from: request.body
      ) else {
        return XCTestAgentResponse(body: Data("{\"error\":\"invalid configuration\"}".utf8), statusCode: 400)
      }

      state.updatePermissions(configuration)
      return jsonResponse(XCTestAgentPermissionsResponse(permissions: state.permissions))
    case ("GET", "/permissions"):
      return jsonResponse(XCTestAgentPermissionsResponse(permissions: state.permissions))
    default:
      return XCTestAgentResponse(body: Data("{\"error\":\"not found\"}".utf8), statusCode: 404)
    }
  }

  private func startHTTPServer() throws {
    let port = UInt16(ProcessInfo.processInfo.environment["HARNESS_XCTEST_AGENT_PORT"] ?? "49200") ?? 49200
    httpServer = try XCTestAgentHTTPServer(port: port) { [weak self] request in
      guard let self else {
        return XCTestAgentResponse(body: Data("{}".utf8), statusCode: 500)
      }

      return handleRequest(request)
    }
    httpServer?.start(log: log)
    log("HTTP server started on port \(port)")
  }

  override func setUpWithError() throws {
    continueAfterFailure = false
    capabilities = [
      PermissionPromptWatchdog(
        state: state,
        springboard: springboard
      )
    ]

    log("setUpWithError started")
    log("enabled capabilities: \(capabilities.map { String(describing: type(of: $0)) }.joined(separator: ", "))")

    for capability in capabilities {
      try capability.setUp()
    }

    try startHTTPServer()

    log("setUpWithError completed")
  }

  override func tearDown() {
    httpServer?.stop()
    httpServer = nil
    super.tearDown()
  }

  @MainActor
  func testAgentSession() {
    log("testAgentSession started")

    let sessionDeadline = Date().addingTimeInterval(Constants.defaultSessionDuration)

    while Date() < sessionDeadline {
      observeTargetApplication()

      for capability in capabilities {
        try? capability.tick()
      }

      RunLoop.current.run(
        until: Date().addingTimeInterval(Constants.tickInterval)
      )
    }

    log("testAgentSession completed")
  }
}
