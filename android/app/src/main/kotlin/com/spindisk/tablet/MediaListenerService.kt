package com.spindisk.tablet

import android.app.Notification
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * El oído de la app.
 *
 * Android no deja consultar «qué suena» sin más: el camino honesto es escuchar
 * las notificaciones multimedia (lo mismo que hace `auto-lyrics`) y quedarse
 * con el token de la `MediaSession` que traen. De ahí salen título, artista,
 * portada, posición, duración y —lo importante— si el reproductor acepta
 * `ACTION_SEEK_TO`, que es lo que distingue Spotify Premium de Spotify Free.
 *
 * Late cada 500 ms: la posición no llega por eventos, hay que preguntarla.
 * La música no se toca, no se descarga nada: sólo se lee metadata.
 */
class MediaListenerService : NotificationListenerService() {

    private val handler = Handler(Looper.getMainLooper())
    private val artExecutor = Executors.newSingleThreadExecutor()
    private var polling = false
    private var sessionToken: MediaSession.Token? = null
    private var lastArtKey: String = ""
    private var lastCoverUrl: String? = null
    private var artResolvedForKey: Boolean = false
    private var resolvingArtKey: String = ""

    private val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) {
            // Al recibir nueva metadata explícita (por ejemplo cuando la portada llega
            // un instante después del título), permitimos re-evaluar la carátula.
            if (lastCoverUrl == null) {
                artResolvedForKey = false
            }
            publish()
        }

        override fun onPlaybackStateChanged(state: PlaybackState?) {
            publish()
        }

        override fun onSessionDestroyed() {
            MediaHub.controller = null
            sessionToken = null
            lastArtKey = ""
            lastCoverUrl = null
            artResolvedForKey = false
            resolvingArtKey = ""
            MediaHub.publish("")
        }
    }

    private val poll = object : Runnable {
        override fun run() {
            if (!polling) return
            publish()
            handler.postDelayed(this, POLL_MS)
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        MediaHub.listening = true
        polling = true
        handler.removeCallbacks(poll)
        handler.post(poll)
    }

    override fun onListenerDisconnected() {
        MediaHub.listening = false
        polling = false
        handler.removeCallbacks(poll)
        MediaHub.controller = null
        sessionToken = null
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        polling = false
        handler.removeCallbacks(poll)
        artExecutor.shutdownNow()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || !MediaHub.isMediaPackage(sbn.packageName)) return
        attach(sbn)
        publish()
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (sbn == null) return
        if (sbn.packageName == MediaHub.controller?.packageName) {
            MediaHub.controller = null
            sessionToken = null
            MediaHub.publish("")
        }
    }

    // ------------------------------------------------------------- sesión activa

    private fun attachIfNeeded(): MediaController? {
        MediaHub.controller?.let { return it }
        val posted = runCatching { activeNotifications }.getOrNull() ?: return null
        val media = posted.firstOrNull { MediaHub.isMediaPackage(it.packageName) } ?: return null
        return attach(media)
    }

    private fun attach(sbn: StatusBarNotification): MediaController? {
        val extras = sbn.notification?.extras ?: return null
        @Suppress("DEPRECATION")
        val token = extras.getParcelable(Notification.EXTRA_MEDIA_SESSION) as? MediaSession.Token
            ?: return null

        if (token == sessionToken) {
            MediaHub.controller?.let { return it }
        }

        sessionToken = token
        val controller = runCatching { MediaController(this, token) }.getOrNull() ?: return null
        controller.registerCallback(callback)
        MediaHub.controller = controller
        return controller
    }

    // ---------------------------------------------------------------- instantánea

    private fun publish() {
        val controller = attachIfNeeded()
        if (controller == null) {
            MediaHub.publish("")
            return
        }

        val metadata = controller.metadata ?: return
        val state = controller.playbackState
        val title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE)?.trim().orEmpty()
        if (title.isEmpty()) return

        val artist = metadata.getString(MediaMetadata.METADATA_KEY_ARTIST)?.trim().orEmpty()
        val album = metadata.getString(MediaMetadata.METADATA_KEY_ALBUM)?.trim().orEmpty()
        val durationMs = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION)
        val duration = if (durationMs > 1_000L) durationMs / 1000.0 else 0.0

        val playing = state?.state == PlaybackState.STATE_PLAYING
        val base = (state?.position ?: 0L) / 1000.0
        val elapsed = if (playing && state != null) {
            (SystemClock.elapsedRealtime() - state.lastPositionUpdateTime) / 1000.0
        } else {
            0.0
        }
        var position = (base + elapsed).coerceAtLeast(0.0)
        if (duration > 0.0) position = position.coerceAtMost(duration)

        // Esta es la detección de capacidades que pide la especificación.
        val canSeek = state != null && (state.actions and PlaybackState.ACTION_SEEK_TO) != 0L

        val key = "$title|$artist|$album"
        if (key != lastArtKey) {
            lastArtKey = key
            lastCoverUrl = null
            artResolvedForKey = false
        }

        if (!artResolvedForKey && resolvingArtKey != key) {
            val artwork = artworkOf(metadata)
            if (artwork == null) {
                lastCoverUrl = null
                artResolvedForKey = true
            } else {
                resolvingArtKey = key
                artExecutor.execute {
                    val url = MediaHub.artUrl(artwork, key)
                    handler.post {
                        if (lastArtKey == key) {
                            lastCoverUrl = url
                            artResolvedForKey = true
                            resolvingArtKey = ""
                            publish()
                        }
                    }
                }
            }
        }

        val coverUrl = lastCoverUrl

        val json = JSONObject().apply {
            put("id", key)
            put("title", title)
            put("artist", artist.ifEmpty { album })
            put("album", album)
            put("coverUrl", coverUrl ?: JSONObject.NULL)
            put("currentTime", position)
            put("duration", duration)
            put("isPlaying", playing)
            put("canSeek", canSeek)
            put("source", MediaHub.sourceOf(controller.packageName))
        }.toString()

        MediaHub.publish(json)
    }

    private fun artworkOf(metadata: MediaMetadata) = runCatching {
        metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
    }.getOrNull()

    private companion object {
        const val POLL_MS = 500L
    }
}
