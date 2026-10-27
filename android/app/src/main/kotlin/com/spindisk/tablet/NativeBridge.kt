package com.spindisk.tablet

import android.webkit.JavascriptInterface

/**
 * El contrato con el JavaScript: `window.SpinDiskNative`.
 *
 * Se mantiene deliberadamente plano (nombres simples, valores primitivos)
 * porque es la frontera entre dos mundos: lo que aquí se rompa, se rompe raro y
 * sin mensajes. `src/bridge/android.ts` es el espejo exacto de esta clase.
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun platform(): String = "android"

    /** Sirve para saber qué compilación corre el aparato cuando algo no encaja. */
    @JavascriptInterface
    fun version(): String = runCatching {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "?"
    }.getOrDefault("?")

    @JavascriptInterface
    fun start(): Boolean {
        MediaHub.requestPublish()
        return MediaHub.listening
    }

    /** Instantánea actual en JSON, para no esperar al siguiente latido. */
    @JavascriptInterface
    fun snapshot(): String = MediaHub.lastJson

    @JavascriptInterface
    fun listening(): Boolean = MediaHub.listening

    @JavascriptInterface
    fun play(): Boolean = MediaHub.play()

    @JavascriptInterface
    fun pause(): Boolean = MediaHub.pause()

    @JavascriptInterface
    fun next(): Boolean = MediaHub.next()

    @JavascriptInterface
    fun previous(): Boolean = MediaHub.previous()

    /** `false` cuando el reproductor no permite buscar (Spotify Gratuita). */
    @JavascriptInterface
    fun seek(seconds: Double): Boolean = MediaHub.seek(seconds)

    @JavascriptInterface
    fun openSource(floating: Boolean) {
        // Los métodos de esta clase corren en la hilatura del WebView, no en la
        // de interfaz: abrir una actividad hay que devolverlo al hilo bueno.
        activity.runOnUiThread { MediaHub.openSource(activity, floating) }
    }

    @JavascriptInterface
    fun notificationAccess(): Boolean = activity.hasNotificationAccess()

    @JavascriptInterface
    fun openNotificationSettings() {
        // Este ya se protege solo, pero se deja explícito por simetría.
        activity.openNotificationSettings()
    }
}
