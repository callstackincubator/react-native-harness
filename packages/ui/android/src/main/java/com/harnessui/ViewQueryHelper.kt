package com.harnessui

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * Enum defining the types of queries that can be performed on the view hierarchy.
 */
enum class ViewQueryType {
    TEST_ID,
    ACCESSIBILITY_LABEL
}

/**
 * Represents information about a found view.
 */
data class ViewQueryResult(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float
) {
    fun toWritableMap(): WritableMap {
        return Arguments.createMap().apply {
            putDouble("x", x.toDouble())
            putDouble("y", y.toDouble())
            putDouble("width", width.toDouble())
            putDouble("height", height.toDouble())
        }
    }
}

/**
 * Helper object for querying the view hierarchy.
 * Provides reusable query logic for finding views by various criteria.
 */
object ViewQueryHelper {

    /**
     * Finds the first view matching the query criteria.
     * @param activity The current activity.
     * @param queryType The type of query to perform.
     * @param value The value to match against.
     * @return ViewQueryResult if found, null otherwise.
     */
    fun query(activity: Activity, queryType: ViewQueryType, value: String): ViewQueryResult? {
        val root = activity.window.decorView
        val density = root.resources.displayMetrics.density
        val found = findViewInView(root, queryType, value) ?: return null
        return resultFromView(found, density)
    }

    /**
     * Finds all views matching the query criteria.
     * @param activity The current activity.
     * @param queryType The type of query to perform.
     * @param value The value to match against.
     * @return List of ViewQueryResult objects.
     */
    fun queryAll(activity: Activity, queryType: ViewQueryType, value: String): List<ViewQueryResult> {
        val root = activity.window.decorView
        val density = root.resources.displayMetrics.density
        val views = mutableListOf<View>()
        findAllViewsInView(root, queryType, value, views)
        return views.map { resultFromView(it, density) }
    }

    /**
     * Checks if a view matches the given query criteria.
     */
    private fun viewMatches(view: View, queryType: ViewQueryType, value: String): Boolean {
        return when (queryType) {
            ViewQueryType.TEST_ID -> view.tag == value
            ViewQueryType.ACCESSIBILITY_LABEL -> view.contentDescription?.toString() == value
        }
    }

    /**
     * Recursively finds the first view matching the query criteria.
     */
    private fun findViewInView(view: View, queryType: ViewQueryType, value: String): View? {
        if (viewMatches(view, queryType, value)) {
            return view
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findViewInView(view.getChildAt(i), queryType, value)
                if (found != null) {
                    return found
                }
            }
        }
        return null
    }

    /**
     * Recursively finds all views matching the query criteria.
     */
    private fun findAllViewsInView(
        view: View,
        queryType: ViewQueryType,
        value: String,
        results: MutableList<View>
    ) {
        if (viewMatches(view, queryType, value)) {
            results.add(view)
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findAllViewsInView(view.getChildAt(i), queryType, value, results)
            }
        }
    }

    /**
     * Converts a View to a ViewQueryResult with screen coordinates in dp.
     */
    private fun resultFromView(view: View, density: Float): ViewQueryResult {
        val location = IntArray(2)
        view.getLocationOnScreen(location)

        // Convert pixels to dp
        val x = location[0] / density
        val y = location[1] / density
        val width = view.width / density
        val height = view.height / density

        return ViewQueryResult(x, y, width, height)
    }
}
