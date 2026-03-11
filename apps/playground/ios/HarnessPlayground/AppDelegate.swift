import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  #if DEBUG
  private func startupCrashMode() -> String {
    let processInfo = ProcessInfo.processInfo

    if let mode = processInfo.environment["HARNESS_CRASH_MODE"], !mode.isEmpty {
      return mode
    }

    if let argument = processInfo.arguments.first(where: { $0.hasPrefix("--harness-crash-mode=") }) {
      return String(argument.dropFirst("--harness-crash-mode=".count))
    }

    return "none"
  }

  private func crashIfRequested() {
    switch startupCrashMode() {
    case "pre_rn":
      fatalError("Intentional pre-RN startup crash")
    case "delayed_pre_ready":
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        fatalError("Intentional delayed startup crash")
      }
    default:
      break
    }
  }
  #endif

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    #if DEBUG
    crashIfRequested()
    #endif

    factory.startReactNative(
      withModuleName: "HarnessPlayground",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
