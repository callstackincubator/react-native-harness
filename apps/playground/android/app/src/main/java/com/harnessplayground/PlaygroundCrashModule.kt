package com.harnessplayground

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = PlaygroundCrashModule.NAME)
class PlaygroundCrashModule(
    reactContext: ReactApplicationContext,
) : NativePlaygroundCrashSpec(reactContext) {
    override fun getName(): String = NAME

    override fun crash(message: String) {
        val exception = IllegalStateException(
            message.ifEmpty { "Intentional PlaygroundCrash crash" },
        )

        Thread(
            { throw exception },
            "PlaygroundCrash",
        ).start()

        Thread.sleep(10_000)
    }

    override fun crashHandled(message: String): Boolean {
        throw IllegalStateException(
            message.ifEmpty { "Intentional PlaygroundCrash handled error" },
        )
    }

    companion object {
        const val NAME = "PlaygroundCrash"
    }
}
