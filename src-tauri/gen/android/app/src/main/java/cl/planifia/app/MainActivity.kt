package cl.planifia.app

import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  @Volatile private var insetsJson = """{"top":0,"right":0,"bottom":0,"left":0,"ime":0}"""

  override fun onCreate(savedInstanceState: Bundle?) {
    // La interfaz siempre es clara: íconos oscuros sobre las barras del sistema.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  /**
   * La app se dibuja bajo la barra de estado y la de gestos. La web lee estos márgenes
   * (en px CSS) desde PlanifiaInsets.get() y recibe el evento "planifia-insets" si cambian.
   * "ime" es el alto del teclado: la ventana no se achica al abrirlo, así que la web sube sus
   * campos (por ejemplo, el chat con Lumi) para que no queden tapados.
   */
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(InsetsBridge(), "PlanifiaInsets")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val density = resources.displayMetrics.density
      val next = """{"top":${bars.top / density},"right":${bars.right / density},"bottom":${bars.bottom / density},"left":${bars.left / density},"ime":${ime / density}}"""
      if (next != insetsJson) {
        insetsJson = next
        webView.evaluateJavascript("window.dispatchEvent(new Event('planifia-insets'))", null)
      }
      ViewCompat.onApplyWindowInsets(view, insets)
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = insetsJson
  }
}
