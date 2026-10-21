package com.harnessui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
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
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * UI helper implementation for HarnessUI.
 * Includes touch simulation and view querying capabilities.
 */
class UIHelperImpl(
    private val context: ReactApplicationContext,
) {
    companion object {
        private const val TAG = "HarnessUI"
        private const val TAP_DURATION_MS = 50L // Duration between touch down and up
        private const val EVENT_PROCESSING_DELAY_MS = 10L // Delay after touch up for React Native to process the event
        private const val GEOMETRY_FUDGE_FACTOR = 0.0656f // How far the renderer widens a box it snaps to pixels
        private const val COPY_ATTEMPTS = 4 // Requests of a copy the renderer abandons at its 500 ms buffer fence wait
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    // =========================================================================
    // Touch Simulation
    // =========================================================================

    fun simulatePress(
        nativeId: String,
        x: Double,
        y: Double,
        promise: Promise,
    ) {
        Log.i(TAG, "simulatePress called with nativeId:$nativeId x:$x y:$y")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
                    Log.w(TAG, "No current activity")
                    promise.resolve(null)
                    return@runOnUiThread
                }
            val root = activity.window.decorView
            val density = root.resources.displayMetrics.density

            var targetX = x
            var targetY = y

            // If nativeId is provided, try to find the view and get its current position
            if (nativeId.isNotEmpty()) {
                val targetView = ViewRegistry.get(nativeId)
                if (targetView != null) {
                    val location = IntArray(2)
                    targetView.getLocationOnScreen(location)
                    // Calculate center in DP
                    val viewX = location[0] / density
                    val viewY = location[1] / density
                    val viewW = targetView.width / density
                    val viewH = targetView.height / density

                    targetX = (viewX + viewW / 2.0)
                    targetY = (viewY + viewH / 2.0)
                    Log.i(TAG, "Resolved view $nativeId to coordinates ($targetX, $targetY)")
                } else {
                    Log.w(TAG, "View with nativeId $nativeId not found or collected. Using provided coordinates.")
                }
            }

            // Convert DP to PX
            val pxX = (targetX * density).toFloat()
            val pxY = (targetY * density).toFloat()

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
    private fun executeQuery(
        queryType: ViewQueryType,
        value: String,
    ): WritableMap? {
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
    private fun executeQueryAll(
        queryType: ViewQueryType,
        value: String,
    ): WritableArray {
        var result: WritableArray = Arguments.createArray()

        // If already on UI thread, execute directly
        if (UiThreadUtil.isOnUiThread()) {
            val activity = context.currentActivity ?: return result
            val queryResults = ViewQueryHelper.queryAll(activity, queryType, value)
            result =
                Arguments.createArray().apply {
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
                        result =
                            Arguments.createArray().apply {
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

    fun captureScreenshot(
        bounds: ReadableMap?,
        promise: Promise,
    ) {
        Log.i(TAG, "captureScreenshot called")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
                    Log.w(TAG, "No current activity")
                    promise.resolve(null)
                    return@runOnUiThread
                }

            val window = activity.window
            val root = window.decorView.rootView
            val density = root.resources.displayMetrics.density

            try {
                // Check if we have a specific view to capture via nativeId
                val nativeId = if (bounds != null && bounds.hasKey("nativeId")) bounds.getString("nativeId") else null

                if (!nativeId.isNullOrEmpty()) {
                    val targetView = ViewRegistry.get(nativeId)
                    if (targetView != null) {
                        val width = targetView.width
                        val height = targetView.height

                        if (width > 0 && height > 0) {
                            val viewRect = rectInWindow(targetView)
                            val rootRect = Rect(0, 0, root.width, root.height)

                            if (targetView.isAttachedToWindow && !viewRect.isEmpty && rootRect.contains(viewRect)) {
                                Log.i(TAG, "View $nativeId is fully on screen. Using screen-based screenshotting.")
                                captureWindowRegion(window, viewRect, promise)
                            } else {
                                Log.i(TAG, "View $nativeId is not fully on screen. Using direct view render.")
                                promise.resolve(encodePng(drawView(targetView)))
                            }
                            return@runOnUiThread
                        }
                    } else {
                        Log.w(TAG, "View with nativeId $nativeId not found for screenshot, falling back to window screenshot")
                    }
                }

                // Check if bounds are provided and have non-zero dimensions
                val region =
                    if (bounds != null && bounds.getDouble("width") > 0 && bounds.getDouble("height") > 0) {
                        // Convert dp to px for bounds
                        val captureX = (bounds.getDouble("x") * density).toInt()
                        val captureY = (bounds.getDouble("y") * density).toInt()
                        val captureWidth = (bounds.getDouble("width") * density).toInt()
                        val captureHeight = (bounds.getDouble("height") * density).toInt()
                        Log.i(TAG, "Capturing region: x=$captureX y=$captureY w=$captureWidth h=$captureHeight")
                        Rect(captureX, captureY, captureX + captureWidth, captureY + captureHeight)
                    } else {
                        Log.i(TAG, "Capturing full window: w=${root.width} h=${root.height}")
                        Rect(0, 0, root.width, root.height)
                    }

                captureWindowRegion(window, region, promise)
            } catch (e: Exception) {
                Log.e(TAG, "Screenshot capture failed", e)
                promise.resolve(null)
            }
        }
    }

    // A software draw of the view tree leaves out pixels a view keeps on a surface of its own: a TextureView draws
    // nothing into a software canvas, and a SurfaceView's content lives on a separate surface behind the window, which
    // leaves a transparent hole over it. PixelCopy reads the window's surface, which the TextureViews render into, and
    // each SurfaceView's surface, each at the latest frame it holds when its copy runs. A SurfaceView set above its
    // window with setZOrderOnTop punches no hole, so it stays hidden: before Android 16 only hidden API tells one
    // apart, and the SDK this module compiles against by default predates getCompositionOrder().
    private fun captureWindowRegion(
        window: Window,
        region: Rect,
        promise: Promise,
    ) {
        val decorView = window.decorView
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(encodePng(drawWindowRegion(decorView, region)))
            return
        }
        // A window that is not shown, as while the screen is off, has nothing on the screen to copy.
        if (!decorView.isShown) {
            Log.e(TAG, "Screenshot capture failed: the window is not shown")
            promise.resolve(null)
            return
        }

        // PixelCopy stretches a source rect that runs past the window over the whole bitmap, so only the part on the
        // window is copied, and placed at its offset in the region.
        val copiedRegion = Rect(0, 0, decorView.width, decorView.height)
        if (!copiedRegion.intersect(region)) {
            promise.resolve(encodePng(drawWindowRegion(decorView, region)))
            return
        }

        val surfaceViews =
            collectSurfaceViews(decorView).filter { surfaceView ->
                !surfaceView.rect.isEmpty && Rect.intersects(copiedRegion, surfaceView.rect)
            }
        val surfaceLayers = arrayOfNulls<SurfaceLayer>(surfaceViews.size)
        var windowSource: WindowSource = WindowSource.ViewTree
        var copyFailure: String? = null
        var pendingCopies = surfaceViews.size + 1

        fun failCopy(reason: String) {
            copyFailure = copyFailure ?: reason
        }

        fun onCopyFinished() {
            pendingCopies -= 1
            if (pendingCopies > 0) {
                return
            }
            val layers = surfaceLayers.filterNotNull()

            fun abandon() {
                when (val source = windowSource) {
                    is WindowSource.Copy -> source.pixels.recycle()
                    WindowSource.ViewTree -> Unit
                }
                layers.forEach { layer -> layer.pixels.recycle() }
                promise.resolve(null)
            }

            val failure = copyFailure
            if (failure != null) {
                Log.e(TAG, "Screenshot capture failed: $failure")
                abandon()
                return
            }
            var screenshot: Bitmap? = null
            try {
                screenshot =
                    when (val source = windowSource) {
                        is WindowSource.Copy -> placeInRegion(source.pixels, copiedRegion, region)
                        WindowSource.ViewTree -> drawWindowRegion(decorView, region)
                    }
                drawBehind(screenshot, layers, Rect(copiedRegion).apply { offset(-region.left, -region.top) })
                promise.resolve(encodePng(screenshot))
            } catch (e: Exception) {
                Log.e(TAG, "Screenshot capture failed", e)
                screenshot?.recycle()
                abandon()
            }
        }

        // Before Android 9, PixelCopy does not offset the rect it is given by the window's surface insets, which a
        // window with elevation has, so such a window's view tree is drawn instead.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P && decorView.z > 0f) {
            onCopyFinished()
        } else {
            val windowPixels = Bitmap.createBitmap(copiedRegion.width(), copiedRegion.height(), Bitmap.Config.ARGB_8888)
            val copyWindow = { listener: PixelCopy.OnPixelCopyFinishedListener ->
                PixelCopy.request(window, Rect(copiedRegion), windowPixels, listener, mainHandler)
            }
            requestCopy(copyWindow) { outcome ->
                when (outcome) {
                    is CopyOutcome.Finished ->
                        if (outcome.result == PixelCopy.SUCCESS) {
                            windowSource = WindowSource.Copy(windowPixels)
                        } else {
                            windowPixels.recycle()
                            failCopy("PixelCopy of the window failed with result ${outcome.result}")
                        }
                    is CopyOutcome.SourceGone -> {
                        windowPixels.recycle()
                        failCopy("PixelCopy cannot read the window, which has no surface: ${outcome.error.message}")
                    }
                }
                onCopyFinished()
            }
        }

        // A SurfaceView's buffer can differ in size from its view, as a video decoder's does, and the screen shows it
        // scaled to the view's box, so the whole buffer is copied, at no more than the view's own size, and drawn into
        // the box.
        surfaceViews.forEachIndexed { index, surfaceView ->
            val pixels =
                Bitmap.createBitmap(
                    min(surfaceView.rect.width(), surfaceView.view.width),
                    min(surfaceView.rect.height(), surfaceView.view.height),
                    Bitmap.Config.ARGB_8888,
                )
            val box = Rect(surfaceView.rect).apply { offset(-region.left, -region.top) }
            val copySurface = { listener: PixelCopy.OnPixelCopyFinishedListener ->
                PixelCopy.request(surfaceView.view, pixels, listener, mainHandler)
            }
            requestCopy(copySurface) { outcome ->
                when (outcome) {
                    is CopyOutcome.Finished ->
                        when (val result = outcome.result) {
                            PixelCopy.SUCCESS -> surfaceLayers[index] = SurfaceLayer(pixels, box)
                            // A surface with no frame yet, one that is gone and a protected one hold nothing a copy can
                            // read, so they add no layer.
                            PixelCopy.ERROR_SOURCE_NO_DATA, PixelCopy.ERROR_SOURCE_INVALID -> pixels.recycle()
                            else -> {
                                failCopy("PixelCopy of a SurfaceView failed with result $result")
                                pixels.recycle()
                            }
                        }
                    is CopyOutcome.SourceGone -> {
                        Log.w(TAG, "PixelCopy cannot read a SurfaceView, whose surface is gone", outcome.error)
                        pixels.recycle()
                    }
                }
                onCopyFinished()
            }
        }
    }

    private sealed interface WindowSource {
        class Copy(val pixels: Bitmap) : WindowSource

        object ViewTree : WindowSource
    }

    private sealed interface CopyOutcome {
        class Finished(val result: Int) : CopyOutcome

        class SourceGone(val error: IllegalArgumentException) : CopyOutcome
    }

    // The renderer abandons a copy whose source buffer is still being drawn when its fence wait ends (ERROR_TIMEOUT),
    // so a slow GPU gets the copy requested again, up to COPY_ATTEMPTS times, before it counts as failed.
    private fun requestCopy(
        request: (PixelCopy.OnPixelCopyFinishedListener) -> Unit,
        attempt: Int = 1,
        onOutcome: (CopyOutcome) -> Unit,
    ) {
        try {
            request(
                PixelCopy.OnPixelCopyFinishedListener { result ->
                    if (result == PixelCopy.ERROR_TIMEOUT && attempt < COPY_ATTEMPTS) {
                        requestCopy(request, attempt + 1, onOutcome)
                    } else {
                        onOutcome(CopyOutcome.Finished(result))
                    }
                },
            )
        } catch (e: IllegalArgumentException) {
            onOutcome(CopyOutcome.SourceGone(e))
        }
    }

    private fun drawView(view: View): Bitmap =
        drawRegion(Rect(0, 0, view.width, view.height)) { canvas -> drawScrolled(view, canvas) }

    // The window's view tree drawn in software where the window shows it, through the root view's transform and the
    // window's pan and cut at the window's edges, so the region and the SurfaceViews' boxes line up with it.
    private fun drawWindowRegion(
        rootView: View,
        region: Rect,
    ): Bitmap =
        drawRegion(region) { canvas ->
            canvas.clipRect(0, 0, rootView.width, rootView.height)
            canvas.concat(viewToWindow(rootView))
            drawScrolled(rootView, canvas)
        }

    // A view draws its content in its scrolled space, which the parent's draw otherwise translates it into.
    private fun drawScrolled(
        view: View,
        canvas: Canvas,
    ) {
        canvas.translate(-view.scrollX.toFloat(), -view.scrollY.toFloat())
        view.draw(canvas)
    }

    private fun drawRegion(
        region: Rect,
        draw: (Canvas) -> Unit,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
        try {
            val canvas = Canvas(bitmap)
            canvas.translate(-region.left.toFloat(), -region.top.toFloat())
            draw(canvas)
        } catch (e: Exception) {
            bitmap.recycle()
            throw e
        }
        return bitmap
    }

    private fun placeInRegion(
        pixels: Bitmap,
        pixelsRegion: Rect,
        region: Rect,
    ): Bitmap {
        if (pixelsRegion == region) {
            return pixels
        }
        val bitmap = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawBitmap(
            pixels,
            (pixelsRegion.left - region.left).toFloat(),
            (pixelsRegion.top - region.top).toFloat(),
            null,
        )
        pixels.recycle()
        return bitmap
    }

    // Each layer goes behind what is drawn already, so the layers are drawn last to first, stacking the SurfaceViews in
    // the order of the view tree. The screen stacks a media overlay above the others, which no public API reports
    // before Android 16, and the rest in the order their surfaces were created, which no API reports. Nothing is drawn
    // outside the window's part of the region.
    private fun drawBehind(
        screenshot: Bitmap,
        layers: List<SurfaceLayer>,
        windowPart: Rect,
    ) {
        val canvas = Canvas(screenshot)
        canvas.clipRect(windowPart)
        val behind = Paint(Paint.FILTER_BITMAP_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OVER) }
        layers.asReversed().forEach { layer ->
            canvas.drawBitmap(layer.pixels, null, layer.box, behind)
            layer.pixels.recycle()
        }
    }

    private class SurfaceLayer(
        val pixels: Bitmap,
        val box: Rect,
    )

    private class SurfaceViewInWindow(
        val view: SurfaceView,
        val rect: Rect,
    )

    private fun collectSurfaceViews(
        view: View,
        found: MutableList<SurfaceViewInWindow> = mutableListOf(),
    ): List<SurfaceViewInWindow> {
        when {
            view.visibility != View.VISIBLE -> Unit
            view is SurfaceView ->
                if (view.width > 0 && view.height > 0 && view.holder.surface.isValid) {
                    found.add(SurfaceViewInWindow(view, rectInWindow(view)))
                }
            view is ViewGroup ->
                for (index in 0 until view.childCount) {
                    collectSurfaceViews(view.getChildAt(index), found)
                }
        }
        return found
    }

    // A view's own space mapped into the window through its own and its ancestors' transforms, composed into one as
    // the renderer composes them, then the pan the window applies to all of its views.
    private fun viewToWindow(view: View): Matrix {
        val transform = Matrix()
        var current = view
        while (true) {
            transform.postConcat(current.matrix)
            transform.postTranslate(current.left.toFloat(), current.top.toFloat())
            val parent = current.parent as? View ?: break
            transform.postTranslate(-parent.scrollX.toFloat(), -parent.scrollY.toFloat())
            current = parent
        }
        // The root view's location in the window is its own corner, already composed above, rounded to whole pixels,
        // plus the pan.
        val rootLocation = IntArray(2)
        current.getLocationInWindow(rootLocation)
        val rootCorner = floatArrayOf(0f, 0f).also { corner -> current.matrix.mapPoints(corner) }
        transform.postTranslate(
            (rootLocation[0] - (rootCorner[0] + current.left).roundToInt()).toFloat(),
            (rootLocation[1] - (rootCorner[1] + current.top).roundToInt()).toFloat(),
        )
        return transform
    }

    // The box a view covers in the window, as UIKit's convertRect:toView: gives it, rounded as the renderer rounds the
    // box it shows a SurfaceView's surface in: snapped to pixel boundaries under translation alone, outward under any
    // other transform. A box with no area stays empty whatever its rounding would give.
    private fun rectInWindow(view: View): Rect {
        val transform = viewToWindow(view)
        val bounds = RectF(0f, 0f, view.width.toFloat(), view.height.toFloat()).also { rect -> transform.mapRect(rect) }
        return when {
            bounds.isEmpty -> Rect()
            isTranslation(transform) -> snapToPixelBoundaries(bounds)
            else -> Rect().also { rect -> bounds.roundOut(rect) }
        }
    }

    // As the renderer snaps a box under translation alone: to the nearest pixel, and from Android 10
    // (Rect::snapGeometryToPixelBoundaries) with an edge within GEOMETRY_FUDGE_FACTOR of a half pixel going outward.
    private fun snapToPixelBoundaries(bounds: RectF): Rect {
        val fudge = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) GEOMETRY_FUDGE_FACTOR else 0f
        return Rect(
            floor(bounds.left + 0.5f - fudge).toInt(),
            floor(bounds.top + 0.5f - fudge).toInt(),
            floor(bounds.right + 0.5f + fudge).toInt(),
            floor(bounds.bottom + 0.5f + fudge).toInt(),
        )
    }

    private fun isTranslation(matrix: Matrix): Boolean {
        val values = FloatArray(9).also { matrix.getValues(it) }
        return values[Matrix.MSCALE_X] == 1f &&
            values[Matrix.MSCALE_Y] == 1f &&
            values[Matrix.MSKEW_X] == 0f &&
            values[Matrix.MSKEW_Y] == 0f &&
            values[Matrix.MPERSP_0] == 0f &&
            values[Matrix.MPERSP_1] == 0f
    }

    private fun encodePng(bitmap: Bitmap): String {
        try {
            val outputStream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
            Log.i(TAG, "Screenshot captured successfully (${outputStream.size()} bytes)")
            return android.util.Base64.encodeToString(outputStream.toByteArray(), android.util.Base64.NO_WRAP)
        } finally {
            bitmap.recycle()
        }
    }

    // =========================================================================
    // Text Input
    // =========================================================================

    fun typeChar(
        character: String,
        promise: Promise,
    ) {
        Log.i(TAG, "typeChar called with: $character")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
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

    fun blur(
        options: ReadableMap,
        promise: Promise,
    ) {
        val submitEditing = options.getBoolean("submitEditing")
        Log.i(TAG, "blur called, submitEditing: $submitEditing")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
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
