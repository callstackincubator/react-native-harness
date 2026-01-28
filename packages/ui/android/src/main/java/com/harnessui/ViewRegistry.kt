package com.harnessui

import android.view.View
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A thread-safe registry that maps unique string IDs to View instances using WeakReferences.
 * This allows efficient O(1) lookup of Views for actions without keeping them alive (preventing leaks).
 */
object ViewRegistry {
    private val registry = ConcurrentHashMap<String, WeakReference<View>>()

    /**
     * Registers a view and returns a unique ID.
     * If the view is already registered (by object identity), it *could* return the existing ID,
     * but for simplicity and performance we can generate a new one or use hash-based key.
     *
     * Currently, we generate a new random ID for every query result to ensure freshness.
     */
    fun register(view: View): String {
        val id = UUID.randomUUID().toString()
        registry[id] = WeakReference(view)
        return id
    }

    /**
     * Retrieves a view by its ID.
     * Returns null if the ID doesn't exist or the View has been garbage collected.
     */
    fun get(id: String): View? {
        val ref = registry[id] ?: return null
        return ref.get()
    }

    /**
     * Optional: Clean up stale entries.
     * Since we use WeakReference, the objects are collected, but the keys remain.
     * For a test harness, this memory overhead is usually negligible, but a cleanup
     * could be triggered periodically if needed.
     */
    fun prune() {
        val iterator = registry.entries.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().value.get() == null) {
                iterator.remove()
            }
        }
    }
}
