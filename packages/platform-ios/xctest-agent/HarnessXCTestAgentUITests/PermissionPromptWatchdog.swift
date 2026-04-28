import XCTest

private enum PermissionPromptEnvironment {
  static let autoAcceptPermissions = "HARNESS_XCTEST_AGENT_AUTO_ACCEPT_PERMISSIONS"
}

struct PermissionPromptConfiguration: Codable {
  var autoAcceptPermissions: Bool

  static func fromEnvironment() -> PermissionPromptConfiguration {
    return PermissionPromptConfiguration(
      autoAcceptPermissions: ProcessInfo.processInfo.environment[PermissionPromptEnvironment.autoAcceptPermissions] == "1"
    )
  }
}

final class PermissionPromptWatchdog: AgentCapability {
  private enum Constants {
    static let knownPositiveButtonLabels = [
      "Allow",
      "OK",
      "Continue",
      "Next",
      "While Using App",
      "While Using the App",
      "Always Allow",
      "Allow Once",
      "Join",
      "Pair",
      "Allow Full Access"
    ]
  }

  private let springboard: XCUIApplication
  private let state: HarnessXCTestAgentState

  private func log(_ message: String) {
    NSLog("[HarnessXCTestAgent][PermissionPromptWatchdog] %@", message)
  }

  init(state: HarnessXCTestAgentState, springboard: XCUIApplication) {
    self.state = state
    self.springboard = springboard
  }

  func setUp() throws {
    if state.permissions.autoAcceptPermissions {
      log("permission prompt watchdog enabled")
    }
  }

  func tick() throws {
    guard state.permissions.autoAcceptPermissions else {
      return
    }

    for label in Constants.knownPositiveButtonLabels {
      let button = springboard.buttons[label].firstMatch

      if button.exists && button.isHittable {
        log("tapping button: \(label)")
        button.tap()
        return
      }
    }
  }
}
