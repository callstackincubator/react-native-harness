import Foundation

@objcMembers
final class PlaygroundSwiftCrash: NSObject {
  func crashSync(message: String) {
    fatalError("Intentional Swift crash: \(message)")
  }

  func crashAsync(message: String) {
    DispatchQueue.main.async {
      fatalError("Intentional Swift crash: \(message)")
    }
  }
}
