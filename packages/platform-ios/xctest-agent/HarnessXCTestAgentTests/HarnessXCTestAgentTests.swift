import XCTest

final class HarnessXCTestAgentTests: XCTestCase {
  private enum Constants {
    static let defaultSessionDuration: TimeInterval = 60 * 60
  }

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testAgentSession() {
    let app = XCUIApplication()
    app.launch()

    RunLoop.current.run(
      until: Date().addingTimeInterval(Constants.defaultSessionDuration)
    )
  }
}
