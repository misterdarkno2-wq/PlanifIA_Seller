    // PlanifIA (scripts/tauri.mjs lo inserta en RustWebViewClient de wry al compilar Android).
    // Si el proceso del WebView muere (poca memoria o una actualización del WebView), sin este
    // método Android cierra la app entera. Se reabre la pantalla; si vuelve a morir en menos de
    // un minuto, se cierra la actividad en vez de repetir el ciclo.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        android.util.Log.e("PlanifiaWebView", "El proceso del WebView terminó (fallo: ${detail.didCrash()}).")
        val activity = view.context as? android.app.Activity
        (view.parent as? android.view.ViewGroup)?.removeView(view)
        view.destroy()
        val now = android.os.SystemClock.elapsedRealtime()
        val repeated = lastRenderProcessGone != 0L && now - lastRenderProcessGone < 60_000
        lastRenderProcessGone = now
        if (activity == null || activity.isFinishing) return true
        if (repeated) activity.finishAndRemoveTask() else activity.recreate()
        return true
    }

    companion object {
        private var lastRenderProcessGone = 0L
    }
