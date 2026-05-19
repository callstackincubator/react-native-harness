package com.harness.coverage

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.util.Log
import java.io.File

object CoverageHelper {
    private const val TAG = "HarnessCoverage"
    private var ecFile: File? = null
    private var timer: java.util.Timer? = null
    private var cachedAgent: Any? = null

    fun setup(context: Context) {
        val agent = try {
            Class.forName("org.jacoco.agent.rt.RT")
                .getMethod("getAgent")
                .invoke(null)
        } catch (e: Exception) {
            Log.w(TAG, "JaCoCo agent not available — was the app built with coverage?", e)
            return
        }
        cachedAgent = agent

        val pid = android.os.Process.myPid()
        ecFile = File(context.filesDir, "coverage-$pid.ec")

        val app = context.applicationContext as? Application
        app?.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStopped(activity: Activity) = flush()
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityResumed(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })

        timer = java.util.Timer("HarnessCoverageFlush", true).also {
            it.scheduleAtFixedRate(object : java.util.TimerTask() {
                override fun run() = flush()
            }, 1000L, 1000L)
        }

        Log.i(TAG, "pid=$pid, flushing to ${ecFile?.absolutePath}")
    }

    fun flush() {
        val file = ecFile ?: return
        val agent = cachedAgent ?: return
        try {
            val bytes = agent.javaClass
                .getMethod("getExecutionData", Boolean::class.javaPrimitiveType)
                .invoke(agent, false) as ByteArray
            file.writeBytes(bytes)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to flush coverage data", e)
        }
    }
}
