package com.aidot.mini

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    class SessionCookies {
        // No cookie values or credentials cross this interface.
        @JavascriptInterface fun flushCookies() { CookieManager.getInstance().flush() }
    }
    private lateinit var web: WebView
    private lateinit var status: TextView
    private val main = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false
    private var pollGeneration = 0
    private var attempts = 0
    private val origin = "http://127.0.0.1:${ServerService.PORT}"
    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved); setContentView(R.layout.activity_main)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
        }
        web = findViewById(R.id.web); status = findViewById(R.id.status)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false; setSupportMultipleWindows(false); mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.addJavascriptInterface(SessionCookies(), "aidotMiniNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !local(request.url)
            @Suppress("DEPRECATION") override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = !local(Uri.parse(url))
        }
        findViewById<Button>(R.id.copyKey).setOnClickListener {
            val file = File(filesDir, "data/admin-token")
            if (file.isFile) {
                val clip = ClipData.newPlainText("aidot-mini admin key", file.readText().trim())
                if (Build.VERSION.SDK_INT >= 33) clip.description.extras = android.os.PersistableBundle().apply { putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true) }
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
                status.setText(R.string.key_copied)
            } else status.setText(R.string.server_starting)
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })
        findViewById<Button>(R.id.startServer).setOnClickListener { startServer() }
        startServer()
    }
    private fun startServer() {
        attempts = 0; pollGeneration++; main.removeCallbacksAndMessages(null); status.setText(R.string.server_starting)
        try {
            val service = Intent(this, ServerService::class.java)
            // Fixed debug-only QA entry; never accepts a script path or bypasses console authentication.
            if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                service.putExtra("robotConsole", intent.getBooleanExtra("robotConsole", false))
            ContextCompat.startForegroundService(this, service); poll(pollGeneration)
        }
        catch (e: Exception) { status.text = getString(R.string.server_error, e.message ?: "") }
    }
    private fun local(uri: Uri): Boolean = uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == ServerService.PORT && uri.userInfo == null
    private fun poll(generation: Int) {
        if (closed || generation != pollGeneration) return
        executor.execute {
            var connection: HttpURLConnection? = null
            val ready = try {
                connection = URL("$origin/health/ready").openConnection() as HttpURLConnection
                connection.connectTimeout = 1200; connection.readTimeout = 1200
                connection.responseCode == 200
            } catch (_: Exception) { false } finally { connection?.disconnect() }
            main.post {
                if (!closed && generation == pollGeneration) {
                    if (ready) { status.setText(R.string.server_ready); web.loadUrl("$origin/") }
                    else if (++attempts < 60) { status.text = getString(R.string.server_waiting, attempts); main.postDelayed({ poll(generation) }, 1000) }
                    else status.text = getString(R.string.server_error, ServerService.status)
                }
            }
        }
    }
    override fun onPause() { CookieManager.getInstance().flush(); super.onPause() }
    override fun onDestroy() { closed = true; main.removeCallbacksAndMessages(null); executor.shutdownNow(); web.stopLoading(); web.destroy(); super.onDestroy() }
}
