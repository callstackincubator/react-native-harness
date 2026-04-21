import XCTest

final class HarnessXCTestAgentTests: XCTestCase {
  private enum Constants {
    static let defaultSessionDuration: TimeInterval = 60 * 60
    static let tickInterval: TimeInterval = 1
  }

  private var capabilities: [AgentCapability] = []

  override func setUpWithError() throws {
    continueAfterFailure = false
    capabilities = [
      PermissionPromptCapability.fromEnvironment()
    ].compactMap { $0 }

    for capability in capabilities {
      try capability.setUp()
    }
  }

  func testAgentSession() {
    let app = XCUIApplication()
    app.launch()

    let sessionDeadline = Date().addingTimeInterval(Constants.defaultSessionDuration)

    while Date() < sessionDeadline {
      for capability in capabilities {
        try? capability.tick()
      }

      RunLoop.current.run(
        until: Date().addingTimeInterval(Constants.tickInterval)
      )
    }
  }
}
