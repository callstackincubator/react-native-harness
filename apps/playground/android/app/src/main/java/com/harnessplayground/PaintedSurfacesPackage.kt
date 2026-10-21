package com.harnessplayground

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp

// Views whose pixels live on a surface of their own, as a GPU-rendered view's
// do. Each fills its surface from the CPU or a decoder and labels itself once
// that frame is what it shows.

class SolidColorTextureView(context: Context) :
  TextureView(context),
  TextureView.SurfaceTextureListener {
  init {
    surfaceTextureListener = this
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    val canvas = lockCanvas() ?: return
    canvas.drawColor(Color.RED)
    unlockCanvasAndPost(canvas)
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
    contentDescription = PAINTED_LABEL
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture) = true

  companion object {
    const val PAINTED_LABEL = "texture-view-painted"
  }
}

class SolidColorSurfaceView(context: Context) :
  SurfaceView(context),
  SurfaceHolder.Callback {
  init {
    holder.addCallback(this)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    val canvas = holder.lockCanvas() ?: return
    canvas.drawColor(Color.BLUE)
    holder.unlockCanvasAndPost(canvas)
    contentDescription = PAINTED_LABEL
  }

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceDestroyed(holder: SurfaceHolder) {}

  companion object {
    const val PAINTED_LABEL = "surface-view-painted"
  }
}

// Blue on its left half and yellow on its right, so a capture shows which part
// of the frame it copied and at what scale.
class SplitColorSurfaceView(context: Context) :
  SurfaceView(context),
  SurfaceHolder.Callback {
  init {
    holder.addCallback(this)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    val canvas = holder.lockCanvas() ?: return
    canvas.drawColor(Color.BLUE)
    canvas.drawRect(width / 2f, 0f, width.toFloat(), height.toFloat(), Paint().apply { color = Color.YELLOW })
    holder.unlockCanvasAndPost(canvas)
    contentDescription = PAINTED_LABEL
  }

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceDestroyed(holder: SurfaceHolder) {}

  companion object {
    const val PAINTED_LABEL = "split-surface-view-painted"
  }
}

// A video whose 320 x 180 frame, blue on its left half and yellow on its right,
// is larger than the view: the decoder queues buffers at the frame's size and
// the screen shows them scaled to the view, as a video player's do.
class SplitColorVideoView(context: Context) :
  SurfaceView(context),
  SurfaceHolder.Callback {
  private var player: MediaPlayer? = null

  init {
    holder.addCallback(this)
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    player =
      MediaPlayer.create(context, R.raw.split_color)?.apply {
        setDisplay(holder)
        setOnInfoListener { _, what, _ ->
          if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
            this@SplitColorVideoView.contentDescription = PAINTED_LABEL
          }
          false
        }
        start()
      }
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    player?.release()
    player = null
  }

  companion object {
    const val PAINTED_LABEL = "split-video-painted"
  }
}

// Moves the window's root view down while it is mounted, as an app's slide or
// shake effect does, and puts it back when it is unmounted.
class RootShiftView(context: Context) : View(context) {
  private var shiftedRoot: View? = null

  var rootTranslationY = 0f
    set(value) {
      field = value
      shiftedRoot?.translationY = value
    }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    shiftedRoot = rootView.also { root -> root.translationY = rootTranslationY }
  }

  override fun onDetachedFromWindow() {
    shiftedRoot?.translationY = 0f
    shiftedRoot = null
    super.onDetachedFromWindow()
  }
}

class SolidColorTextureViewManager : SimpleViewManager<SolidColorTextureView>() {
  override fun getName() = "SolidColorTextureView"

  override fun createViewInstance(context: ThemedReactContext) = SolidColorTextureView(context)
}

class SolidColorSurfaceViewManager : SimpleViewManager<SolidColorSurfaceView>() {
  override fun getName() = "SolidColorSurfaceView"

  override fun createViewInstance(context: ThemedReactContext) = SolidColorSurfaceView(context)
}

class SplitColorSurfaceViewManager : SimpleViewManager<SplitColorSurfaceView>() {
  override fun getName() = "SplitColorSurfaceView"

  override fun createViewInstance(context: ThemedReactContext) = SplitColorSurfaceView(context)
}

class SplitColorVideoViewManager : SimpleViewManager<SplitColorVideoView>() {
  override fun getName() = "SplitColorVideoView"

  override fun createViewInstance(context: ThemedReactContext) = SplitColorVideoView(context)
}

class RootShiftViewManager : SimpleViewManager<RootShiftView>() {
  override fun getName() = "RootShiftView"

  override fun createViewInstance(context: ThemedReactContext) = RootShiftView(context)

  @ReactProp(name = "rootTranslationY")
  fun setRootTranslationY(view: RootShiftView, value: Float) {
    view.rootTranslationY = PixelUtil.toPixelFromDIP(value)
  }
}

class PaintedSurfacesPackage : ReactPackage {
  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> =
    listOf(
      SolidColorTextureViewManager(),
      SolidColorSurfaceViewManager(),
      SplitColorSurfaceViewManager(),
      SplitColorVideoViewManager(),
      RootShiftViewManager(),
    )
}
