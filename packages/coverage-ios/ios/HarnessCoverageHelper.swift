#if HARNESS_COVERAGE
import Foundation
import UIKit

@_silgen_name("__llvm_profile_write_file")
func __llvm_profile_write_file() -> Int32

@_silgen_name("__llvm_profile_set_filename")
func __llvm_profile_set_filename(_ filename: UnsafePointer<CChar>)

@objc(HarnessCoverageHelper) public class HarnessCoverageHelper: NSObject {
  private static let profrawDir = "/tmp/harness-coverage"
  private static var isSetUp = false
  private static var flushThread: Thread?

  @objc public static func setup() {
    guard !isSetUp else { return }
    isSetUp = true

    try? FileManager.default.createDirectory(atPath: profrawDir, withIntermediateDirectories: true)
    let profrawPath = "\(profrawDir)/harness-\(ProcessInfo.processInfo.processIdentifier).profraw"
    __llvm_profile_set_filename(profrawPath)

    startFlushTimer()

    NotificationCenter.default.addObserver(
      forName: UIApplication.willTerminateNotification,
      object: nil, queue: nil
    ) { _ in
      _ = __llvm_profile_write_file()
    }

    NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification,
      object: nil, queue: nil
    ) { _ in
      _ = __llvm_profile_write_file()
    }

    signal(SIGTERM) { _ in
      _ = __llvm_profile_write_file()
      exit(0)
    }
  }

  private static func startFlushTimer() {
    let thread = Thread {
      let timer = Timer(timeInterval: 1.0, repeats: true) { _ in
        _ = __llvm_profile_write_file()
      }
      RunLoop.current.add(timer, forMode: .default)
      RunLoop.current.run()
    }
    thread.name = "HarnessCoverageFlush"
    thread.qualityOfService = .background
    thread.start()
    flushThread = thread
  }
}
#endif
