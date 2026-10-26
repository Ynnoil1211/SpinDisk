package com.spindisk.tablet

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * La ventana: una WebView a pantalla completa con el lienzo dentro.
 *
 * Todo el dibujo, la física y el sonido viven en `assets/www`; aquí sólo se
 * monta el motor del sistema, se intercepta la portada y se empuja lo que suena.
 */
class MainActivity : Activity() {

    private var web: WebView? = null
    private var askedForAccess = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        goFullscreen()

        val view = WebView(this)
        view.setBackgroundColor(Color.parseColor("#0B0908"))
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            // El audio del motor Foley necesita arrancar dentro de un gesto;
            // la app ya pide el primer toque, así que no hace falta más.
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                if (url.host != "spindisk.local" || url.path != "/art") return null

                val bytes = MediaHub.artBytes
                val headers = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store",
                )
                return if (bytes == null || bytes.isEmpty()) {
                    WebResourceResponse(
                        "image/png",
                        null,
                        404,
                        "Sin portada",
                        headers,
                        ByteArrayInputStream(ByteArray(0)),
                    )
                } else {
                    WebResourceResponse(
                        "image/png",
                        null,
                        200,
                        "OK",
                        headers,
                        ByteArrayInputStream(bytes),
                    )
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // La web acaba de nacer: que reciba lo que ya estaba sonando.
                pushToWeb(MediaHub.lastJson)
            }
        }

        view.addJavascriptInterface(NativeBridge(this), "SpinDiskNative")
        web = view
        setContentView(view)

        MediaHub.sink = { json -> runOnUiThread { pushToWeb(json) } }

        view.loadUrl("file:///android_asset/www/index.html")
    }

    // ------------------------------------------------------------------ ciclo

    override fun onResume() {
        super.onResume()
        web?.onResume()
        goFullscreen()
        MediaHub.requestPublish()
        if (!hasNotificationAccess() && !askedForAccess) {
            askedForAccess = true
            askForNotificationAccess()
        }
    }

    override fun onPause() {
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        MediaHub.sink = null
        web?.let { view ->
            view.removeJavascriptInterface("SpinDiskNative")
            view.destroy()
        }
        web = null
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // Es un objeto de escritorio: atrás lo manda a segundo plano, no lo cierra.
        moveTaskToBack(true)
    }

    // ------------------------------------------------------------- integración

    fun hasNotificationAccess(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?: return false
        val me = ComponentName(this, MediaListenerService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    fun askForNotificationAccess() {
        pushNotice(
            "Para leer lo que suena, activa el acceso a notificaciones de SpinDisk",
        )
        openNotificationSettings()
    }

    fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Puede llegar desde el JavaScript (hilatura propia del WebView), y
        // abrir una actividad fuera del hilo de interfaz es pedir problemas.
        runOnUiThread { runCatching { startActivity(intent) } }
    }

    private fun pushNotice(message: String) {
        val payload = JSONObject.quote(message)
        runOnUiThread {
            web?.evaluateJavascript(
                "window.__spindisk&&window.__spindisk.onNotice($payload)",
                null,
            )
        }
    }

    private fun pushToWeb(json: String) {
        val view = web ?: return
        val payload = if (json.isEmpty()) "''" else JSONObject.quote(json)
        view.evaluateJavascript(
            "window.__spindisk&&window.__spindisk.onSnapshot($payload)",
            null,
        )
    }

    private fun goFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.systemBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        }
    }
}
