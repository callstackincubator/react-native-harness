import XCTest

protocol AgentCapability {
  func setUp() throws
  func tick() throws
}

extension AgentCapability {
  func setUp() throws {}
  func tick() throws {}
}
