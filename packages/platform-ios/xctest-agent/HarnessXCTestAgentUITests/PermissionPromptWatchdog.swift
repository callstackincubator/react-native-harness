import XCTest

private enum PermissionPromptEnvironment {
  static let permissionPromptPolicy = "HARNESS_XCTEST_AGENT_PERMISSION_PROMPT_POLICY"
}

struct PermissionPromptConfiguration: Codable {
  var permissionPromptPolicy: String

  static func fromEnvironment() -> PermissionPromptConfiguration {
    return PermissionPromptConfiguration(
      permissionPromptPolicy: ProcessInfo.processInfo.environment[PermissionPromptEnvironment.permissionPromptPolicy] ?? "disabled"
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
    static let knownNegativeButtonLabels = [
      "Don’t Allow",
      "Don't Allow",
      "Not Now",
      "Cancel",
      "Deny",
      "No",
      "Keep Only While Using",
      "Allow Once"
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
    if state.permissions.permissionPromptPolicy != "disabled" {
      log("permission prompt watchdog enabled")
    }
  }

  func tick() throws {
    let labels: [String]

    switch state.permissions.permissionPromptPolicy {
    case "grant-all":
      labels = Constants.knownPositiveButtonLabels
    case "deny-all":
      labels = Constants.knownNegativeButtonLabels
    default:
      return
    }

    for label in labels {
      let button = springboard.buttons[label].firstMatch

      if button.exists && button.isHittable {
        log("tapping button: \(label)")
        button.tap()
        return
      }
    }
  }
}
