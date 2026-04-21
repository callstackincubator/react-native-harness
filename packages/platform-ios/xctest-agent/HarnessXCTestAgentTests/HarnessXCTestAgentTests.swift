import XCTest

final class HarnessXCTestAgentTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testAgentProjectBootstraps() {
    XCTAssertTrue(true)
  }
}
