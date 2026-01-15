package com.harnessui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.EditText
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * UI helper implementation for HarnessUI.
 * Includes touch simulation and view querying capabilities.
 */
class UIHelperImpl(private val context: ReactApplicationContext) {

    companion object {
        private const val TAG = "HarnessUI"
        private const val TAP_DURATION_MS = 50L  // Duration between touch down and up
        private const val EVENT_PROCESSING_DELAY_MS = 10L  // Delay after touch up for React Native to process the event
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    // =========================================================================
    // Touch Simulation
    // =========================================================================

    fun simulatePress(x: Double, y: Double, promise: Promise) {
        Log.i(TAG, "simulatePress called with x:$x y:$y")

        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity ?: run {
                Log.w(TAG, "No current activity")
                promise.resolve(null)
                return@runOnUiThread
            }
            val root = activity.window.decorView

            // Convert DP to PX
            val density = root.resources.displayMetrics.density
            val pxX = (x * density).toFloat()
            val pxY = (y * density).toFloat()

            val downTime = SystemClock.uptimeMillis()

            // 1. ACTION_DOWN
            val downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, pxX, pxY, 0)
            try {
                root.dispatchTouchEvent(downEvent)
                Log.i(TAG, "Sent touch down at ($pxX, $pxY)")
            } finally {
                downEvent.recycle()
            }

            // 2. ACTION_UP after real delay to allow press feedback to render
            mainHandler.postDelayed({
                val upTime = SystemClock.uptimeMillis()
                val upEvent = MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, pxX, pxY, 0)
                try {
                    root.dispatchTouchEvent(upEvent)
                    Log.i(TAG, "Tap completed at ($pxX, $pxY)")
                } finally {
                    upEvent.recycle()
                }
                // Wait for React Native to process the touch event and trigger JS callbacks
                mainHandler.postDelayed({
                    promise.resolve(null)
                }, EVENT_PROCESSING_DELAY_MS)
            }, TAP_DURATION_MS)
        }
    }

    // =========================================================================
    // Query API
    // =========================================================================

    fun queryByTestId(testId: String): WritableMap? {
        Log.i(TAG, "queryByTestId called with: $testId")
        return executeQuery(ViewQueryType.TEST_ID, testId)
    }

    fun queryByAccessibilityLabel(label: String): WritableMap? {
        Log.i(TAG, "queryByAccessibilityLabel called with: $label")
        return executeQuery(ViewQueryType.ACCESSIBILITY_LABEL, label)
    }

    fun queryAllByTestId(testId: String): WritableArray {
        Log.i(TAG, "queryAllByTestId called with: $testId")
        return executeQueryAll(ViewQueryType.TEST_ID, testId)
    }

    fun queryAllByAccessibilityLabel(label: String): WritableArray {
        Log.i(TAG, "queryAllByAccessibilityLabel called with: $label")
        return executeQueryAll(ViewQueryType.ACCESSIBILITY_LABEL, label)
    }

    /**
     * Executes a query on the UI thread and returns the result.
     * Uses CountDownLatch to synchronize with the UI thread.
     */
    private fun executeQuery(queryType: ViewQueryType, value: String): WritableMap? {
        var result: WritableMap? = null

        // If already on UI thread, execute directly
        if (UiThreadUtil.isOnUiThread()) {
            val activity = context.currentActivity ?: return null
            result = ViewQueryHelper.query(activity, queryType, value)?.toWritableMap()
        } else {
            // Execute on UI thread and wait for result
            val latch = CountDownLatch(1)

            UiThreadUtil.runOnUiThread {
                try {
                    val activity = context.currentActivity
                    if (activity != null) {
                        result = ViewQueryHelper.query(activity, queryType, value)?.toWritableMap()
                    }
                } finally {
                    latch.countDown()
                }
            }

            // Wait for UI thread with timeout
            try {
                latch.await(5, TimeUnit.SECONDS)
            } catch (e: InterruptedException) {
                Log.e(TAG, "Query interrupted", e)
            }
        }

        Log.i(TAG, "Query result: $result")
        return result
    }

    /**
     * Executes a query for all matching views on the UI thread.
     * Uses CountDownLatch to synchronize with the UI thread.
     */
    private fun executeQueryAll(queryType: ViewQueryType, value: String): WritableArray {
        var result: WritableArray = Arguments.createArray()

        // If already on UI thread, execute directly
        if (UiThreadUtil.isOnUiThread()) {
            val activity = context.currentActivity ?: return result
            val queryResults = ViewQueryHelper.queryAll(activity, queryType, value)
            result = Arguments.createArray().apply {
                queryResults.forEach { pushMap(it.toWritableMap()) }
            }
        } else {
            // Execute on UI thread and wait for result
            val latch = CountDownLatch(1)

            UiThreadUtil.runOnUiThread {
                try {
                    val activity = context.currentActivity
                    if (activity != null) {
                        val queryResults = ViewQueryHelper.queryAll(activity, queryType, value)
                        result = Arguments.createArray().apply {
                            queryResults.forEach { pushMap(it.toWritableMap()) }
                        }
                    }
                } finally {
                    latch.countDown()
                }
            }

            // Wait for UI thread with timeout
            try {
                latch.await(5, TimeUnit.SECONDS)
            } catch (e: InterruptedException) {
                Log.e(TAG, "QueryAll interrupted", e)
            }
        }

        Log.i(TAG, "QueryAll result count: ${result.size()}")
        return result
    }

    // =========================================================================
    // Screenshot Capture
    // =========================================================================

    fun captureScreenshot(bounds: ReadableMap?, promise: Promise) {
        Log.i(TAG, "captureScreenshot called")

        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity ?: run {
                Log.w(TAG, "No current activity")
                promise.resolve(null)
                return@runOnUiThread
            }

            val root = activity.window.decorView.rootView
            val density = root.resources.displayMetrics.density

            try {
                // Determine capture dimensions
                val captureX: Int
                val captureY: Int
                val captureWidth: Int
                val captureHeight: Int

                // Check if bounds are provided and have non-zero dimensions
                val hasBounds = bounds != null && bounds.getDouble("width") > 0 && bounds.getDouble("height") > 0

                if (hasBounds) {
                    // Convert dp to px for bounds
                    captureX = (bounds!!.getDouble("x") * density).toInt()
                    captureY = (bounds.getDouble("y") * density).toInt()
                    captureWidth = (bounds.getDouble("width") * density).toInt()
                    captureHeight = (bounds.getDouble("height") * density).toInt()
                    Log.i(TAG, "Capturing region: x=$captureX y=$captureY w=$captureWidth h=$captureHeight")
                } else {
                    captureX = 0
                    captureY = 0
                    captureWidth = root.width
                    captureHeight = root.height
                    Log.i(TAG, "Capturing full window: w=$captureWidth h=$captureHeight")
                }

                // Create bitmap and canvas
                val bitmap = Bitmap.createBitmap(captureWidth, captureHeight, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)

                // Translate canvas if capturing a specific region
                canvas.translate(-captureX.toFloat(), -captureY.toFloat())

                // Draw the view hierarchy
                root.draw(canvas)

                // Convert to PNG bytes
                val outputStream = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
                val pngBytes = outputStream.toByteArray()

                // Clean up
                bitmap.recycle()

                // Return as Base64 string for efficiency
                val base64String = android.util.Base64.encodeToString(pngBytes, android.util.Base64.NO_WRAP)
                Log.i(TAG, "Screenshot captured successfully (${pngBytes.size} bytes)")
                promise.resolve(base64String)
            } catch (e: Exception) {
                Log.e(TAG, "Screenshot capture failed", e)
                promise.resolve(null)
            }
        }
    }

    // =========================================================================
    // Text Input
    // =========================================================================

    fun typeChar(character: String, promise: Promise) {
        Log.i(TAG, "typeChar called with: $character")

        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity ?: run {
                Log.w(TAG, "No current activity")
                promise.resolve(null)
                return@runOnUiThread
            }

            val focused = activity.currentFocus
            if (focused is EditText) {
                // Insert character at cursor position
                val start = focused.selectionStart
                val end = focused.selectionEnd
                focused.text.replace(start, end, character)
                Log.i(TAG, "Inserted character: $character")
            } else {
                Log.i(TAG, "No EditText is focused")
            }

            // Delay for React Native to process onChangeText
            mainHandler.postDelayed({
                promise.resolve(null)
            }, EVENT_PROCESSING_DELAY_MS)
        }
    }

    fun blur(options: ReadableMap, promise: Promise) {
        val submitEditing = options.getBoolean("submitEditing")
        Log.i(TAG, "blur called, submitEditing: $submitEditing")

        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity ?: run {
                Log.w(TAG, "No current activity")
                promise.resolve(null)
                return@runOnUiThread
            }

            val focused = activity.currentFocus

            if (submitEditing && focused is EditText) {
                Log.i(TAG, "Triggering submitEditing")
                // Trigger onSubmitEditing by simulating IME action
                focused.onEditorAction(EditorInfo.IME_ACTION_DONE)
            }

            if (focused != null) {
                // Clear focus (triggers onEndEditing and onBlur)
                Log.i(TAG, "Clearing focus")
                focused.clearFocus()

                // Hide keyboard
                val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(focused.windowToken, 0)
            } else {
                Log.i(TAG, "No view is focused")
            }

            mainHandler.postDelayed({
                promise.resolve(null)
            }, EVENT_PROCESSING_DELAY_MS)
        }
    }
}
