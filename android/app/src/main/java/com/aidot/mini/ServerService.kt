package com.aidot.mini

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

/** User-visible local server. Android/OEM policies can still stop this process. */
class ServerService : Service() {
    companion object {
        const val PORT = 8901
        const val ACTION_STOP = "com.aidot.mini.STOP"
        private const val CHANNEL = "server"
        private const val NOTIFICATION = 1
        @Volatile var status = "Stopped"; private set
    }
    private val started = AtomicBoolean(false)
    @Volatile private var stopping = false
    @Volatile private var proc: Process? = null
    private var worker: Thread? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        if (!started.compareAndSet(false, true)) return START_STICKY
        stopping = false
        startForeground(NOTIFICATION, notification(getString(R.string.server_starting)))
        val robotConsole = (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0 && intent?.getBooleanExtra("robotConsole", false) == true
        worker = Thread({ runServer(robotConsole) }, "aidot-node").also { it.start() }
        return START_STICKY
    }
    private fun runServer(robotConsole: Boolean) {
        try {
            val appDir = File(filesDir, "server")
            extractAssets(appDir)
            val runtime = File(applicationInfo.nativeLibraryDir, "libnode_exec.so")
            require(runtime.isFile) { "Validated Android Node runtime is missing" }
            val data = File(filesDir, "data").apply { mkdirs() }
            val logs = File(filesDir, "log").apply { mkdirs() }
            var failures = 0
            while (!stopping && failures < 5) {
                val begin = System.currentTimeMillis()
                val entry = if (robotConsole) "modules/robot-client/main.mjs" else "start.js"
                val pb = ProcessBuilder(runtime.absolutePath, entry).directory(appDir).redirectErrorStream(true)
                pb.environment().apply {
                    put("NODE_ENV", "production")
                    put("TMPDIR", cacheDir.absolutePath)
                    put("LD_LIBRARY_PATH", applicationInfo.nativeLibraryDir)
                    put("HOST", "127.0.0.1")
                    put("PORT", PORT.toString())
                    put("HTTPS_ENABLED", "false")
                    put("MANAGED_ENDPOINT", "true")
                    put("DATA_DIR", data.absolutePath)
                    put("DB_FILE", File(data, "app.db").absolutePath)
                    put("LOG_DIR", logs.absolutePath)
                    put("LOG_TO_FILE", "true")
                }
                if (stopping) break
                val child = pb.start()
                proc = child
                if (stopping) child.destroy()
                status = "Starting"
                update(getString(R.string.server_starting))
                child.inputStream.bufferedReader().useLines { lines -> lines.forEach { line ->
                    Log.i("aidot-mini", line)
                    if (line.contains("listening on http://127.0.0.1:$PORT")) { status = "Ready"; update(getString(R.string.server_ready)) }
                } }
                val code = child.waitFor()
                proc = null
                if (stopping) break
                failures = if (System.currentTimeMillis() - begin > 60000) 1 else failures + 1
                status = "Restarting ($code)"
                update(getString(R.string.server_restarting))
                Thread.sleep((1000L shl failures.coerceAtMost(4)).coerceAtMost(15000L))
            }
            if (!stopping) { status = "Stopped after repeated failures"; Log.e("aidot-mini", status); stopSelf() }
        } catch (_: InterruptedException) {
            // Normal stop during restart delay.
        } catch (e: Exception) {
            if (!stopping) { status = "Error: ${e.message}"; Log.e("aidot-mini", "Server failed", e); stopSelf() }
        } finally {
            val child = proc
            if (child != null) {
                child.destroy()
                try { if (!child.waitFor(8, TimeUnit.SECONDS)) child.destroyForcibly() } catch (_: InterruptedException) { child.destroyForcibly(); Thread.currentThread().interrupt() }
            }
            proc = null; started.set(false)
        }
    }
    private fun extractAssets(dest: File) {
        val revision = assets.open("server.sha256").bufferedReader().use { it.readText().trim() }
        if (File(dest, ".version").takeIf { it.isFile }?.readText() == revision && File(dest, "start.js").isFile) return
        val stage = File(filesDir, "server-next")
        stage.deleteRecursively(); check(stage.mkdirs())
        val hash = java.security.MessageDigest.getInstance("SHA-256")
        assets.open("server.zip").use { input ->
            java.security.DigestInputStream(input, hash).use { digest ->
                ZipInputStream(digest).use { zip ->
                    var bytes = 0L; var count = 0
                    var entry = zip.nextEntry
                    while (entry != null) {
                        require(++count < 10000) { "Too many asset entries" }
                        val file = File(stage, entry.name)
                        require(file.canonicalPath.startsWith(stage.canonicalPath + File.separator)) { "Invalid asset path" }
                        if (entry.isDirectory) file.mkdirs() else {
                            file.parentFile?.mkdirs()
                            file.outputStream().use { out ->
                                val buffer = ByteArray(8192)
                                var n = zip.read(buffer)
                                while (n >= 0) { bytes += n; require(bytes <= 16L * 1024 * 1024) { "Server assets too large" }; out.write(buffer, 0, n); n = zip.read(buffer) }
                            }
                        }
                        zip.closeEntry(); entry = zip.nextEntry
                    }
                    // Drain the central directory as well so the hash covers the entire ZIP.
                    val buffer = ByteArray(8192); while (digest.read(buffer) >= 0) { }
                }
            }
        }
        check(hash.digest().joinToString("") { "%02x".format(it) } == revision) { "Server asset checksum mismatch" }
        check(File(stage, "start.js").isFile && File(stage, "package.json").isFile) { "Invalid server asset layout" }
        File(stage, ".version").writeText(revision)
        val old = File(filesDir, "server-previous"); old.deleteRecursively()
        if (dest.exists()) check(dest.renameTo(old))
        if (!stage.renameTo(dest)) { old.renameTo(dest); error("Cannot activate server assets") }
        old.deleteRecursively()
    }
    private fun notification(text: String): Notification {
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, ServerService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setContentTitle(getString(R.string.app_name)).setContentText(text).setContentIntent(open)
            .addAction(0, getString(R.string.stop_server), stop).setOngoing(true).build()
    }
    private fun update(text: String) { getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(text)) }
    override fun onDestroy() {
        stopping = true; status = "Stopped"
        // No sleeps on Android's main thread. Give SQLite time to close in a worker.
        val child = proc
        child?.destroy()
        worker?.interrupt()
        if (child != null) Thread {
            try { if (!child.waitFor(8, TimeUnit.SECONDS)) child.destroyForcibly() } catch (_: InterruptedException) { child.destroyForcibly() }
        }.start()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
