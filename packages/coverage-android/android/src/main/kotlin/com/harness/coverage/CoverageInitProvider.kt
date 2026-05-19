package com.harness.coverage

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

class CoverageInitProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val ctx = context ?: return true
        CoverageHelper.setup(ctx)
        return true
    }

    override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0
}
