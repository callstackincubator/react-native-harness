package com.harnessplayground

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  private fun crashMode(): String? = intent?.getStringExtra("harness_crash_mode")

  private fun crashIfRequestedBeforeReact() {
    if (!BuildConfig.DEBUG) {
      return
    }

    if (crashMode() == "pre_rn") {
      error("Intentional pre-RN startup crash")
    }
  }

  private fun scheduleDelayedCrashIfRequested() {
    if (!BuildConfig.DEBUG) {
      return
    }

    if (crashMode() == "delayed_pre_ready") {
      Handler(Looper.getMainLooper()).postDelayed(
        { error("Intentional delayed startup crash") },
        1000,
      )
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    crashIfRequestedBeforeReact()
    super.onCreate(savedInstanceState)
    scheduleDelayedCrashIfRequested()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "HarnessPlayground"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
