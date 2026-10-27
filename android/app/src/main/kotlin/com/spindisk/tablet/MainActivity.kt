package com.spindisk.tablet

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.Gravity
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

/**
 * La ventana: una WebView a pantalla completa con el lienzo dentro.
 *
 * Todo el dibujo, la física y el sonido viven en `assets/www`; aquí sólo se
 * monta el motor del sistema, se intercepta la portada y se empuja lo que suena.
 */
class MainActivity : Activity() {

    private var web: WebView? = null
    private var askedForAccess = false
    private var pendingNotice: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Lo primero de todo: si algo revienta, que quede escrito y que se vea.
        // Un fallo antes de esto deja la app cerrándose sin decir nada, que es
        // justo lo que no se puede depurar en un teléfono ajeno.
        recordCrashes()

        try {
            // Una pantalla de papel con la versión antes de tocar la WebView.
            // Si el teléfono enseña esto y luego se cierra, el problema está en
            // el motor; si no llega a verse, ni siquiera se llegó a arrancar.
            showBoot("arrancando…")
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            goFullscreen()
            showLastCrashIfAny()
            window.decorView.post { mountWeb() }
        } catch (error: Throwable) {
            showFailure(error)
        }
    }

    /** La WebView, ya con la pantalla del sistema montada. */
    private fun mountWeb() {
        try {
            val view = buildWeb()
            web = view
            setContentView(view)
            MediaHub.sink = { json -> runOnUiThread { pushToWeb(json) } }
            view.loadUrl("file:///android_asset/www/index.html")
        } catch (error: Throwable) {
            // Si el motor del sistema falla en un aparato concreto, es mejor
            // contarlo en pantalla que desaparecer sin explicación.
            showFailure(error)
        }
    }

    /** Texto de papel con la versión, para saber qué APK está corriendo. */
    private fun showBoot(step: String) {
        val version = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull() ?: "?"

        val label = TextView(this).apply {
            text = "SpinDisk $version\n$step"
            setTextColor(Color.parseColor("#3A2C1E"))
            setBackgroundColor(Color.parseColor("#F2E8D5"))
            textSize = 17f
            gravity = Gravity.CENTER
            typeface = Typeface.create("serif", Typeface.NORMAL)
            setPadding(48, 48, 48, 48)
        }
        setContentView(label)
    }

    /** La WebView con su configuración y la portada interceptada. */
    private fun buildWeb(): WebView {
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
                pendingNotice?.let { notice ->
                    pendingNotice = null
                    pushNotice(notice)
                }
            }
        }

        view.addJavascriptInterface(NativeBridge(this), "SpinDiskNative")
        return view
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

    /**
     * Se avisa dentro de la app y se deja que el usuario pulse «Activar».
     *
     * Antes se abrían los ajustes del sistema de golpe, y eso se siente como
     * que la aplicación se cierra recién abierta: en la tablet y en el móvil
     * el usuario aterrizaba en una lista de aplicaciones sin entender por qué.
     */
    fun askForNotificationAccess() {
        val message = "Para leer lo que suena, activa el acceso a notificaciones de SpinDisk"
        pushNotice(message)
        if (web == null) {
            pendingNotice = message
        }
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

    // ------------------------------------------------------------- diagnóstico

    private fun crashFile() = File(filesDir, "ultimo-fallo.txt")

    /**
     * Guarda la traza del próximo fallo.
     *
     * En la tablet no hay `adb` ni logcat: la única forma de saber por qué se
     * cerró la app es que ella misma lo apunte y lo cuente al volver a abrir.
     */
    private fun recordCrashes() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                crashFile().writeText(
                    "${error.javaClass.name}: ${error.message}\n\n${error.stackTraceToString()}",
                )
            }
            // En un aparato ajeno nadie va a conectar un cable: un aviso del
            // sistema con el tipo de fallo ya permite tirar del hilo.
            runCatching {
                Toast.makeText(
                    applicationContext,
                    "SpinDisk falló: ${error.javaClass.simpleName}",
                    Toast.LENGTH_LONG,
                ).show()
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Pantalla mínima cuando ni siquiera se pudo montar la WebView. */
    private fun showFailure(error: Throwable) {
        runCatching { crashFile().writeText(error.stackTraceToString()) }

        val text = TextView(this).apply {
            setPadding(48, 48, 48, 48)
            setTextColor(Color.parseColor("#3A2C1E"))
            textSize = 14f
            typeface = Typeface.MONOSPACE
            setText(
                "SpinDisk no pudo arrancar en este aparato.\n\n" +
                    "${error.javaClass.simpleName}: ${error.message}\n\n" +
                    error.stackTraceToString(),
            )
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#F2E8D5"))
            addView(text)
        }
        web = null
        setContentView(scroll)
    }

    /** Traza del último fallo, encima de la escena y descartable con un toque. */
    private fun showLastCrashIfAny() {
        val file = crashFile()
        if (!file.exists()) return
        val trace = runCatching { file.readText() }.getOrNull().orEmpty()
        runCatching { file.delete() }
        if (trace.isBlank()) return
        if (web == null) return

        val text = TextView(this).apply {
            setPadding(32, 24, 32, 24)
            setTextColor(Color.parseColor("#F6EFE2"))
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setBackgroundColor(Color.parseColor("#CC2A211A"))
            setText("Último fallo:\n\n" + trace.take(4000) + "\n\n(toca para cerrar)")
        }
        val scroll = ScrollView(this).apply { addView(text) }
        scroll.setOnClickListener { (scroll.parent as? ViewGroup)?.removeView(scroll) }
        addContentView(
            scroll,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
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
