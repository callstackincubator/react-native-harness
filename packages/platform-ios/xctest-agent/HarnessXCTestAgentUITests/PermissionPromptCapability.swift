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

final class PermissionPromptCapability: AgentCapability {
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

  private let application: XCUIApplication
  private let springboard: XCUIApplication
  private let state: HarnessXCTestAgentState

  private func log(_ message: String) {
    NSLog("[HarnessXCTestAgent][PermissionPromptCapability] %@", message)
  }

  init(
    state: HarnessXCTestAgentState,
    application: XCUIApplication,
    springboard: XCUIApplication
  ) {
    self.state = state
    self.application = application
    self.springboard = springboard
  }

  func setUp() throws {
    if state.permissions.autoAcceptPermissions {
      log("permission prompt capability enabled")
    }
  }

  func logInterruption(_ alertLabel: String) {
    log("interruption monitor received alert: \(alertLabel)")
  }

  func handleInterruption(_ alert: XCUIElement) -> Bool {
    guard state.permissions.autoAcceptPermissions else {
      return false
    }

    return tapPositiveAction(in: alert)
  }

  func tick() throws {
    guard state.permissions.autoAcceptPermissions else {
      return
    }

    let handledAppAlert = tapPositiveAction(in: application.alerts.firstMatch)
    let handledAppSheet = tapPositiveAction(in: application.sheets.firstMatch)
    let handledSpringboardAlert = tapPositiveAction(in: springboard.alerts.firstMatch)
    let handledSpringboardSheet = tapPositiveAction(in: springboard.sheets.firstMatch)

    if handledAppAlert || handledAppSheet || handledSpringboardAlert || handledSpringboardSheet {
      log("handled permission prompt during tick")
    }
  }

  private func tapPositiveAction(in element: XCUIElement) -> Bool {
    guard element.exists else {
      return false
    }

    for label in Constants.knownPositiveButtonLabels {
      let button = element.buttons[label]

      if button.exists {
        log("tapping button: \(label)")
        button.tap()
        return true
      }
    }

    let visibleButtons = element.buttons.allElementsBoundByIndex.map(\.label)
    log("prompt found but no matching positive action. buttons=\(visibleButtons)")

    return false
  }
}
