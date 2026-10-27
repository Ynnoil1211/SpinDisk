package com.spindisk.tablet

import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.media.session.MediaController
import android.media.session.PlaybackState
import android.util.Log
import java.io.ByteArrayOutputStream

/**
 * Estado compartido entre el servicio de notificaciones y la WebView.
 *
 * El servicio escribe aquí la instantánea de lo que suena; la actividad la
 * empuja al JavaScript. Los comandos van en el sentido contrario.
 */
object MediaHub {

    const val SPOTIFY = "com.spotify.music"
    const val YOUTUBE_MUSIC = "com.google.android.apps.youtube.music"
    const val YOUTUBE = "com.google.android.youtube"

    private const val TAG = "SpinDisk"

    /** Lado máximo de la portada que se codifica: de sobra para la galleta. */
    private const val ART_MAX_SIDE = 512

    /** El servicio está enganchado (el usuario concedió el acceso). */
    @Volatile
    var listening: Boolean = false

    /** Controlador de la sesión multimedia activa. */
    @Volatile
    var controller: MediaController? = null

    /** Última instantánea, para que una web recién cargada no espere medio segundo. */
    @Volatile
    var lastJson: String = ""

    /** Portada ya codificada, servida al WebView por `https://spindisk.local/art`. */
    @Volatile
    var artBytes: ByteArray? = null

    private var artKey: String = ""

    /** Lo pone la actividad: recibe cada instantánea nueva. */
    var sink: ((String) -> Unit)? = null

    fun isMediaPackage(pkg: String?): Boolean =
        pkg == SPOTIFY || pkg == YOUTUBE_MUSIC || pkg == YOUTUBE

    fun sourceOf(pkg: String?): String = when (pkg) {
        SPOTIFY -> "spotify"
        YOUTUBE_MUSIC -> "youtube-music"
        YOUTUBE -> "youtube"
        else -> "unknown"
    }

    /**
     * Codifica la portada una sola vez por pista y devuelve la URL que la
     * WebView intercepta. Se evita el base64: la imagen va en binario y el
     * lienzo puede leer sus colores porque la respuesta lleva CORS abierto.
     */
    fun artUrl(bitmap: Bitmap?, key: String): String? {
        if (bitmap == null || bitmap.isRecycled) return null
        // El token va en la URL: nada de títulos con espacios, «|» o acentos, que
        // el WebView acabaría escapando y rompiendo la comparación.
        val token = "${key.hashCode().toString(16)}x${bitmap.generationId}x${bitmap.width}x${bitmap.height}"
        if (token != artKey || artBytes == null) {
            // Algunas apps mandan portadas de 1500 px o más. Codificarlas tal
            // cual en PNG puede agotar la memoria de un móvil modesto —y el
            // servicio vive en el mismo proceso: se lleva la app por delante—.
            // Con 512 px de lado sobra para una galleta de 86 px y para el
            // fondo extraído por el lienzo.
            val bytes = runCatching {
                val side = maxOf(bitmap.width, bitmap.height)
                val scaled = if (side > ART_MAX_SIDE) {
                    val ratio = ART_MAX_SIDE.toFloat() / side
                    Bitmap.createScaledBitmap(
                        bitmap,
                        (bitmap.width * ratio).toInt().coerceAtLeast(1),
                        (bitmap.height * ratio).toInt().coerceAtLeast(1),
                        true,
                    )
                } else {
                    bitmap
                }
                val out = ByteArrayOutputStream()
                if (!scaled.compress(Bitmap.CompressFormat.JPEG, 88, out)) return null
                out.toByteArray()
            }.getOrElse { error ->
                Log.w(TAG, "No se pudo preparar la portada: ${error.message}")
                null
            } ?: return null
            artBytes = bytes
            artKey = token
        }
        return "https://spindisk.local/art?t=$token"
    }

    fun publish(json: String) {
        if (json == lastJson) return
        lastJson = json
        sink?.invoke(json)
    }

    /** Empuja de nuevo la última instantánea (al cargar la web o volver a ella). */
    fun requestPublish() {
        val json = lastJson
        if (json.isNotEmpty()) sink?.invoke(json)
    }

    fun play(): Boolean = transport { it.play() }

    fun pause(): Boolean = transport { it.pause() }

    fun next(): Boolean = transport { it.skipToNext() }

    fun previous(): Boolean = transport { it.skipToPrevious() }

    private inline fun transport(action: (MediaController.TransportControls) -> Unit): Boolean {
        val controls = controller?.transportControls ?: return false
        return runCatching {
            action(controls)
            true
        }.getOrDefault(false)
    }

    /**
     * Adelanta o atrasa. Si el reproductor no declara `ACTION_SEEK_TO`
     * (Spotify Gratuita no lo hace), devuelve `false` sin tocar nada: de eso se
     * encarga la física del brazo, que rebota al punto real.
     */
    fun seek(seconds: Double): Boolean {
        val session = controller ?: return false
        val state: PlaybackState = session.playbackState ?: return false
        if (state.actions and PlaybackState.ACTION_SEEK_TO == 0L) return false
        return runCatching {
            session.transportControls.seekTo((seconds * 1000.0).toLong())
            true
        }.getOrDefault(false)
    }

    /**
     * Abre la app que está sonando. Con `floating` intenta una ventana
     * pequeña (Android freeform / multiventana); si el fabricante no lo
     * permite, cae sin ruido a la apertura normal.
     */
    fun openSource(context: Context, floating: Boolean) {
        val target = controller?.packageName
        val launcher = sequenceOf(target, SPOTIFY, YOUTUBE_MUSIC, YOUTUBE)
            .filterNotNull()
            .mapNotNull { pkg ->
                runCatching { context.packageManager.getLaunchIntentForPackage(pkg) }.getOrNull()
            }
            .firstOrNull() ?: return

        launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)

        if (floating) {
            launcher.addFlags(
                Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK,
            )
            val options = runCatching {
                ActivityOptions.makeBasic().apply { setLaunchBounds(Rect(0, 0, 980, 720)) }
            }.getOrNull()
            if (options != null) {
                val launched = runCatching { context.startActivity(launcher, options.toBundle()) }
                if (launched.isSuccess) return
            }
        }

        runCatching { context.startActivity(launcher) }
    }
}
