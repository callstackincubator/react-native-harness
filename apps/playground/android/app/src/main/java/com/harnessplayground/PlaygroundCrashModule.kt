package com.harnessplayground

import android.os.Handler
import android.os.Looper
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

@DoNotStrip
@ReactModule(name = NativePlaygroundCrashSpec.NAME)
class PlaygroundCrashModule(reactContext: ReactApplicationContext) :
  NativePlaygroundCrashSpec(reactContext) {

  override fun crashFromObjectiveCSync(message: String): Boolean {
    throw UnsupportedOperationException(
      "Objective-C crash is only available on iOS. Requested message: $message",
    )
  }

  override fun crashFromObjectiveCAsync(message: String) {
    throw UnsupportedOperationException(
      "Objective-C crash is only available on iOS. Requested message: $message",
    )
  }

  override fun crashFromSwiftSync(message: String): Boolean {
    throw UnsupportedOperationException(
      "Swift crash is only available on iOS. Requested message: $message",
    )
  }

  override fun crashFromSwiftAsync(message: String) {
    throw UnsupportedOperationException(
      "Swift crash is only available on iOS. Requested message: $message",
    )
  }

  override fun crashFromKotlinSync(message: String): Boolean {
    throw RuntimeException("Intentional synchronous Kotlin crash: $message")
  }

  override fun crashFromKotlinAsync(message: String) {
    Handler(Looper.getMainLooper()).post {
      throw RuntimeException("Intentional asynchronous Kotlin crash: $message")
    }
  }
}
