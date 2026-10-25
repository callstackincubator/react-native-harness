// swift-tools-version: 6.0

import PackageDescription

// React Native resolves these dependencies from
// build/generated/autolinking/libs/HarnessUI in the app's iOS directory.
let package = Package(
    name: "HarnessUI",
    platforms: [.iOS("15.1")],
    products: [
        .library(name: "HarnessUI", targets: ["HarnessUI"]),
    ],
    dependencies: [
        .package(name: "ReactNative", path: "../../../../xcframeworks"),
        .package(name: "React-GeneratedCode", path: "../../../ios"),
    ],
    targets: [
        .target(
            name: "HarnessUI",
            dependencies: [
                .product(name: "ReactHeaders", package: "ReactNative"),
                .product(name: "ReactNativeHeaders", package: "ReactNative"),
                .product(name: "ReactNativeDependenciesHeaders", package: "ReactNative"),
                .product(name: "ReactAppHeaders", package: "React-GeneratedCode"),
            ],
            path: "ios",
            publicHeadersPath: ".",
            cxxSettings: [
                .define("DEBUG", .when(configuration: .debug)),
                .define("NDEBUG", .when(configuration: .release)),
            ],
            linkerSettings: [
                .linkedFramework("UIKit"),
                .linkedFramework("Foundation"),
                .linkedFramework("CoreGraphics"),
            ]
        ),
    ],
    cxxLanguageStandard: .cxx20
)
