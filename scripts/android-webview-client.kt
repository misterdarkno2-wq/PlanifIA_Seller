    // PlanifIA (scripts/tauri.mjs lo inserta en RustWebViewClient de wry al compilar Android).
    // Si el proceso del WebView muere (poca memoria o una actualización del WebView), sin este
    // método Android cierra la app entera. Se reabre la pantalla; si vuelve a morir en menos de
    // un minuto, se cierra la actividad en vez de repetir el ciclo. Los avisos de una misma caída
    // pueden llegar más de una vez y sólo se actúa en el primero.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        val now = android.os.SystemClock.elapsedRealtime()
        val since = if (lastRenderProcessGone == 0L) Long.MAX_VALUE else now - lastRenderProcessGone
        val activity = view.context as? android.app.Activity
        android.util.Log.e(
            "PlanifiaWebView",
            "El proceso del WebView terminó (fallo: ${detail.didCrash()}, ms desde la anterior: $since, actividad: $activity)."
        )
        (view.parent as? android.view.ViewGroup)?.removeView(view)
        view.destroy()
        if (since < 5_000) return true
        lastRenderProcessGone = now
        if (activity == null || activity.isFinishing) return true
        if (since < 60_000) activity.finishAndRemoveTask() else activity.recreate()
        return true
    }

    companion object {
        private var lastRenderProcessGone = 0L
    }
