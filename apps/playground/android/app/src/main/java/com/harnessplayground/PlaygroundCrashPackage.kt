package com.harnessplayground

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class PlaygroundCrashPackage : BaseReactPackage() {
    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext,
    ): NativeModule? =
        if (name == PlaygroundCrashModule.NAME) {
            PlaygroundCrashModule(reactContext)
        } else {
            null
        }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
        ReactModuleInfoProvider {
            mapOf(
                PlaygroundCrashModule.NAME to
                    ReactModuleInfo(
                        PlaygroundCrashModule.NAME,
                        PlaygroundCrashModule.NAME,
                        false,
                        false,
                        false,
                        true,
                    ),
            )
        }
}
