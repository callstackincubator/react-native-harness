---
__default__: patch
---

On CI hosts with 3 cores or less than 8 GB of memory, Harness now keeps the iOS simulator's unused background services from starting when it boots the simulator, instead of stopping them after the boot has already paid for them. It also turns off more of them, including wallpapers, Spotlight and on-device intelligence. Push notifications, StoreKit, in-app purchases and universal links keep working, and services the simulator needs to boot or to launch apps under XCTest are left on. A simulator that is already booted when Harness starts is now left as it is.
