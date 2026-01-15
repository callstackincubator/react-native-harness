package com.harnessui

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * TurboModule for HarnessUI - provides UI testing capabilities.
 * Includes touch simulation and view querying.
 */
@ReactModule(name = HarnessUIModule.NAME)
class HarnessUIModule(reactContext: ReactApplicationContext) :
    NativeHarnessUISpec(reactContext) {

    companion object {
        const val NAME = "HarnessUI"
    }

    private val helper = UIHelperImpl(reactContext)

    override fun getName(): String = NAME

    override fun simulatePress(x: Double, y: Double, promise: Promise) {
        helper.simulatePress(x, y, promise)
    }

    override fun queryByTestId(testId: String): WritableMap? =
        helper.queryByTestId(testId)

    override fun queryByAccessibilityLabel(label: String): WritableMap? =
        helper.queryByAccessibilityLabel(label)

    override fun queryAllByTestId(testId: String): WritableArray =
        helper.queryAllByTestId(testId)

    override fun queryAllByAccessibilityLabel(label: String): WritableArray =
        helper.queryAllByAccessibilityLabel(label)

    override fun captureScreenshot(bounds: ReadableMap?, promise: Promise) {
        helper.captureScreenshot(bounds, promise)
    }

    override fun typeChar(character: String, promise: Promise) {
        helper.typeChar(character, promise)
    }

    override fun blur(options: ReadableMap, promise: Promise) {
        helper.blur(options, promise)
    }
}
