import XCTest

final class PermissionPromptCapability: AgentCapability {
  private enum Environment {
    static let autoAcceptPermissions = "HARNESS_XCTEST_AGENT_AUTO_ACCEPT_PERMISSIONS"
  }

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

  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private let hostApplication = XCUIApplication()

  static func fromEnvironment() -> PermissionPromptCapability? {
    guard ProcessInfo.processInfo.environment[Environment.autoAcceptPermissions] == "1" else {
      return nil
    }

    return PermissionPromptCapability()
  }

  func setUp() throws {
    addUIInterruptionMonitor(withDescription: "Harness permission prompt handler") { [weak self] alert in
      guard let self else {
        return false
      }

      return self.tapPositiveAction(in: alert)
    }
  }

  func tick() throws {
    _ = tapPositiveAction(in: springboard.alerts.firstMatch)
    _ = tapPositiveAction(in: springboard.sheets.firstMatch)
    hostApplication.activate()
  }

  private func tapPositiveAction(in element: XCUIElement) -> Bool {
    guard element.exists else {
      return false
    }

    for label in Constants.knownPositiveButtonLabels {
      let button = element.buttons[label]

      if button.exists {
        button.tap()
        return true
      }
    }

    return false
  }
}
