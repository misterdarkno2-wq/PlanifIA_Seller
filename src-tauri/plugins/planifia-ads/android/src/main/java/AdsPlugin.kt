package cl.planifia.ads

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.PluginManager
import com.google.android.libraries.ads.mobile.sdk.MobileAds
import com.google.android.libraries.ads.mobile.sdk.banner.AdSize
import com.google.android.libraries.ads.mobile.sdk.banner.AdView
import com.google.android.libraries.ads.mobile.sdk.banner.BannerAd
import com.google.android.libraries.ads.mobile.sdk.banner.BannerAdRequest
import com.google.android.libraries.ads.mobile.sdk.common.AdLoadCallback
import com.google.android.libraries.ads.mobile.sdk.common.AdRequest
import com.google.android.libraries.ads.mobile.sdk.common.FullScreenContentError
import com.google.android.libraries.ads.mobile.sdk.common.LoadAdError
import com.google.android.libraries.ads.mobile.sdk.common.RequestConfiguration
import com.google.android.libraries.ads.mobile.sdk.initialization.InitializationConfig
import com.google.android.libraries.ads.mobile.sdk.interstitial.InterstitialAd
import com.google.android.libraries.ads.mobile.sdk.interstitial.InterstitialAdEventCallback
import com.google.android.libraries.ads.mobile.sdk.rewarded.OnUserEarnedRewardListener
import com.google.android.libraries.ads.mobile.sdk.rewarded.RewardItem
import com.google.android.libraries.ads.mobile.sdk.rewarded.RewardedAd
import com.google.android.libraries.ads.mobile.sdk.rewarded.RewardedAdEventCallback
import com.google.android.libraries.ads.mobile.sdk.rewarded.ServerSideVerificationOptions
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "PlanifiaAds"

@InvokeArg
class BannerArgs {
  var position: String? = null
}

@InvokeArg
class RewardedArgs {
  var userId: String? = null
  var customData: String? = null
}

/**
 * IDs de AdMob. Se leen de res/values/admob.xml de la app. Las compilaciones de depuración
 * usan siempre los bloques de prueba oficiales de Google, para no generar tráfico inválido.
 */
private class AdIds(
  val appId: String,
  val banner: String,
  val interstitial: String,
  val rewarded: String,
  val test: Boolean,
) {
  companion object {
    const val TEST_APP = "ca-app-pub-3940256099942544~3347511713"
    const val TEST_BANNER = "ca-app-pub-3940256099942544/9214589741"
    const val TEST_INTERSTITIAL = "ca-app-pub-3940256099942544/1033173712"
    const val TEST_REWARDED = "ca-app-pub-3940256099942544/5224354917"

    fun from(activity: Activity): AdIds {
      fun text(name: String): String? {
        for (pkg in listOf(activity.packageName, activity.javaClass.`package`?.name)) {
          if (pkg == null) continue
          val id = activity.resources.getIdentifier(name, "string", pkg)
          if (id != 0) return activity.getString(id).trim().ifEmpty { null }
        }
        return null
      }
      val debuggable = (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
      val appId = text("admob_app_id") ?: TEST_APP
      val banner = text("admob_banner_id")
      val interstitial = text("admob_interstitial_id")
      val rewarded = text("admob_rewarded_id")
      if (debuggable || banner == null || interstitial == null || rewarded == null) {
        return AdIds(appId, TEST_BANNER, TEST_INTERSTITIAL, TEST_REWARDED, true)
      }
      return AdIds(appId, banner, interstitial, rewarded, banner == TEST_BANNER)
    }
  }
}

@TauriPlugin
class AdsPlugin(private val created: Activity) : Plugin(created) {
  // Tauri crea el plugin una vez, con la primera actividad. Si Android la destruye y crea otra (al
  // volver a la app o por un cambio de configuración), PluginManager apunta a la actividad vigente.
  private val activity: Activity
    get() = PluginManager.activity ?: created
  private val ids by lazy { AdIds.from(activity) }
  private val consent: ConsentInformation by lazy { UserMessagingPlatform.getConsentInformation(activity) }
  private val initWaiters = mutableListOf<Invoke>()
  private var initStarted = false
  @Volatile private var sdkReady = false

  private var container: FrameLayout? = null
  private var adView: AdView? = null
  private var bannerLoaded = false
  private var bannerPosition = "bottom"
  private var reportedHeight = -1

  @Volatile private var interstitial: InterstitialAd? = null
  @Volatile private var interstitialLoading = false
  @Volatile private var rewarded: RewardedAd? = null
  @Volatile private var rewardedLoading = false

  private fun ready() = sdkReady && consent.canRequestAds()

  private fun state() = JSObject().apply {
    put("available", true)
    put("initialized", sdkReady)
    put("canRequestAds", consent.canRequestAds())
    put(
      "privacyOptionsRequired",
      consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED,
    )
    put("testAds", ids.test)
    put("bannerHeight", if (reportedHeight > 0) reportedHeight else 0)
  }

  private fun result(vararg pairs: Pair<String, Any?>) = JSObject().apply {
    for ((key, value) in pairs) put(key, value)
  }

  /**
   * Ejecuta en el hilo principal. Una excepción del SDK de anuncios fuera del comando cerraría la
   * app; aquí se registra y, si se indica, se responde a la llamada pendiente.
   */
  private fun onUi(onError: ((Throwable) -> Unit)? = null, block: () -> Unit) {
    activity.runOnUiThread {
      try {
        block()
      } catch (error: Throwable) {
        Log.e(TAG, "Error de anuncios", error)
        try {
          onError?.invoke(error)
        } catch (cleanup: Throwable) {
          Log.e(TAG, "Error al recuperar el estado de anuncios", cleanup)
        }
      }
    }
  }

  /** Pide el consentimiento (UMP) y sólo después inicializa el SDK de anuncios. */
  @Command
  fun initAds(invoke: Invoke) {
    onUi({ invoke.resolve(state()) }) {
      val params = ConsentRequestParameters.Builder()
        .setAdMobAppId(ids.appId)
        .setTagForUnderAgeOfConsent(false)
        .build()
      consent.requestConsentInfoUpdate(
        activity,
        params,
        {
          UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
            if (error != null) Log.w(TAG, "Formulario de consentimiento: ${error.message}")
            startSdk(invoke)
          }
        },
        { error ->
          // Sin red se usa el consentimiento guardado de la sesión anterior.
          Log.w(TAG, "Consentimiento no actualizado: ${error.message}")
          startSdk(invoke)
        },
      )
    }
  }

  private fun startSdk(invoke: Invoke) {
    if (!consent.canRequestAds() || sdkReady) {
      invoke.resolve(state())
      return
    }
    synchronized(initWaiters) {
      initWaiters.add(invoke)
      if (initStarted) return
      initStarted = true
    }
    // El SDK exige inicializarse fuera del hilo principal para evitar ANR. Es un hilo propio y no
    // un executor: el plugin vive todo el proceso, mientras que onDestroy llega con cada actividad.
    Thread({
      try {
        val config = InitializationConfig.Builder(ids.appId)
          .setRequestConfiguration(
            RequestConfiguration.Builder()
              .setMaxAdContentRating(RequestConfiguration.MaxAdContentRating.MAX_AD_CONTENT_RATING_T)
              .build(),
          )
          .build()
        MobileAds.initialize(activity.applicationContext, config) {
          sdkReady = true
          flushInit()
        }
      } catch (error: Throwable) {
        Log.e(TAG, "No se pudo inicializar AdMob", error)
        synchronized(initWaiters) { initStarted = false }
        flushInit()
      }
    }, "planifia-ads-init").start()
  }

  private fun flushInit() {
    val waiting = synchronized(initWaiters) { initWaiters.toList().also { initWaiters.clear() } }
    val current = state()
    waiting.forEach { it.resolve(current) }
  }

  @Command
  fun getAdsState(invoke: Invoke) {
    invoke.resolve(state())
  }

  @Command
  fun showPrivacyOptions(invoke: Invoke) {
    onUi({ invoke.resolve(state()) }) {
      UserMessagingPlatform.showPrivacyOptionsForm(activity) { error ->
        if (error != null) Log.w(TAG, "Opciones de privacidad: ${error.message}")
        invoke.resolve(state())
      }
    }
  }

  // ---------- Banner: vista nativa sobre el WebView ----------

  @Command
  fun showBanner(invoke: Invoke) {
    val args = invoke.parseArgs(BannerArgs::class.java)
    if (!ready()) {
      invoke.resolve(result("shown" to false, "reason" to "not_ready"))
      return
    }
    onUi({
      removeBanner()
      invoke.resolve(result("shown" to false, "reason" to "error"))
    }) {
      val position = if (args.position == "top") "top" else "bottom"
      val existing = container
      if (existing != null && position == bannerPosition) {
        if (bannerLoaded) existing.visibility = View.VISIBLE
        invoke.resolve(result("shown" to bannerLoaded, "height" to currentHeight()))
        reportBanner()
        return@onUi
      }
      removeBanner()
      val root = activity.findViewById<ViewGroup>(android.R.id.content)
      val frame = FrameLayout(activity).apply {
        setBackgroundColor(Color.parseColor("#FBFDF9"))
        visibility = View.INVISIBLE
        elevation = 8f * activity.resources.displayMetrics.density
      }
      val view = AdView(activity)
      frame.addView(
        view,
        FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
          Gravity.CENTER_HORIZONTAL,
        ),
      )
      root.addView(
        frame,
        FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
          if (position == "top") Gravity.TOP else Gravity.BOTTOM,
        ),
      )
      ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
        applyInsets(v, insets)
        insets
      }
      frame.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reportBanner() }
      container = frame
      adView = view
      bannerPosition = position
      bannerLoaded = false
      ViewCompat.getRootWindowInsets(root)?.let { applyInsets(frame, it) }
      ViewCompat.requestApplyInsets(frame)

      val metrics = activity.resources.displayMetrics
      val widthDp = ((if (root.width > 0) root.width else metrics.widthPixels) / metrics.density).toInt()
      val size = AdSize.getLargeAnchoredAdaptiveBannerAdSize(activity, widthDp)
      view.loadAd(
        BannerAdRequest.Builder(ids.banner, size).build(),
        object : AdLoadCallback<BannerAd> {
          override fun onAdLoaded(ad: BannerAd) {
            onUi({ invoke.resolve(result("shown" to false, "reason" to "error")) }) {
              if (adView !== view) return@onUi
              bannerLoaded = true
              frame.visibility = View.VISIBLE
              ViewCompat.getRootWindowInsets(frame)?.let { applyInsets(frame, it) }
              frame.post {
                reportBanner()
                invoke.resolve(result("shown" to true, "height" to currentHeight()))
              }
            }
          }

          override fun onAdFailedToLoad(adError: LoadAdError) {
            onUi({ invoke.resolve(result("shown" to false, "reason" to adError.code.name)) }) {
              if (adView === view) removeBanner()
              invoke.resolve(result("shown" to false, "reason" to adError.code.name))
            }
          }
        },
      )
    }
  }

  /** Deja el banner sobre la barra de navegación y lo oculta mientras el teclado está abierto. */
  private fun applyInsets(view: View, insets: WindowInsetsCompat) {
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    if (bannerPosition == "top") view.setPadding(bars.left, bars.top, bars.right, 0)
    else view.setPadding(bars.left, 0, bars.right, bars.bottom)
    if (bannerLoaded) {
      view.visibility = if (insets.isVisible(WindowInsetsCompat.Type.ime())) View.INVISIBLE else View.VISIBLE
    }
    view.post { reportBanner() }
  }

  /** Alto ocupado por el banner en px CSS (dp), incluido el margen de la barra del sistema. */
  private fun currentHeight(): Int {
    val frame = container ?: return 0
    if (!bannerLoaded || frame.visibility != View.VISIBLE) return 0
    return Math.round(frame.height / activity.resources.displayMetrics.density)
  }

  private fun reportBanner() {
    val height = currentHeight()
    if (height == reportedHeight) return
    reportedHeight = height
    trigger("bannerChanged", result("height" to height, "position" to bannerPosition))
  }

  @Command
  fun hideBanner(invoke: Invoke) {
    onUi({ invoke.resolve(result("shown" to false, "height" to 0)) }) {
      removeBanner()
      invoke.resolve(result("shown" to false, "height" to 0))
    }
  }

  private fun removeBanner() {
    container?.let { (it.parent as? ViewGroup)?.removeView(it) }
    adView?.destroy()
    container = null
    adView = null
    bannerLoaded = false
    reportBanner()
  }

  // ---------- Intersticial ----------

  private fun preloadInterstitial(done: ((Boolean) -> Unit)? = null) {
    if (interstitial != null) {
      done?.invoke(true)
      return
    }
    if (interstitialLoading || !ready()) {
      done?.invoke(false)
      return
    }
    interstitialLoading = true
    InterstitialAd.load(
      AdRequest.Builder(ids.interstitial).build(),
      object : AdLoadCallback<InterstitialAd> {
        override fun onAdLoaded(ad: InterstitialAd) {
          interstitial = ad
          interstitialLoading = false
          done?.invoke(true)
        }

        override fun onAdFailedToLoad(adError: LoadAdError) {
          interstitialLoading = false
          Log.i(TAG, "Intersticial no disponible: ${adError.code}")
          done?.invoke(false)
        }
      },
    )
  }

  @Command
  fun loadInterstitial(invoke: Invoke) {
    preloadInterstitial { loaded -> invoke.resolve(result("loaded" to loaded)) }
  }

  @Command
  fun showInterstitial(invoke: Invoke) {
    val ad = interstitial
    if (ad == null || !ready()) {
      preloadInterstitial()
      invoke.resolve(result("shown" to false, "reason" to "not_loaded"))
      return
    }
    interstitial = null
    val finished = AtomicBoolean(false)
    ad.adEventCallback = object : InterstitialAdEventCallback {
      override fun onAdDismissedFullScreenContent() {
        if (finished.compareAndSet(false, true)) invoke.resolve(result("shown" to true))
        ad.destroy()
        preloadInterstitial()
      }

      override fun onAdFailedToShowFullScreenContent(fullScreenContentError: FullScreenContentError) {
        if (finished.compareAndSet(false, true)) {
          invoke.resolve(result("shown" to false, "reason" to fullScreenContentError.code.name))
        }
        ad.destroy()
        preloadInterstitial()
      }
    }
    onUi({
      if (finished.compareAndSet(false, true)) invoke.resolve(result("shown" to false, "reason" to "error"))
      ad.destroy()
    }) { ad.show(activity) }
  }

  // ---------- Recompensado (los créditos los acredita el servidor vía SSV) ----------

  private fun preloadRewarded(done: ((Boolean) -> Unit)? = null) {
    if (rewarded != null) {
      done?.invoke(true)
      return
    }
    if (rewardedLoading || !ready()) {
      done?.invoke(false)
      return
    }
    rewardedLoading = true
    RewardedAd.load(
      AdRequest.Builder(ids.rewarded).build(),
      object : AdLoadCallback<RewardedAd> {
        override fun onAdLoaded(ad: RewardedAd) {
          rewarded = ad
          rewardedLoading = false
          done?.invoke(true)
        }

        override fun onAdFailedToLoad(adError: LoadAdError) {
          rewardedLoading = false
          Log.i(TAG, "Recompensado no disponible: ${adError.code}")
          done?.invoke(false)
        }
      },
    )
  }

  @Command
  fun loadRewarded(invoke: Invoke) {
    preloadRewarded { loaded -> invoke.resolve(result("loaded" to loaded)) }
  }

  @Command
  fun showRewarded(invoke: Invoke) {
    val args = invoke.parseArgs(RewardedArgs::class.java)
    val userId = args.userId?.takeIf { it.length in 1..64 }
    if (userId == null) {
      invoke.reject("Falta la cuenta para acreditar la recompensa.")
      return
    }
    val ad = rewarded
    if (ad == null || !ready()) {
      preloadRewarded()
      invoke.resolve(result("shown" to false, "earned" to false, "reason" to "not_loaded"))
      return
    }
    rewarded = null
    val earned = AtomicBoolean(false)
    val finished = AtomicBoolean(false)
    // AdMob envía user_id y custom_data firmados a la función admob-ssv de Supabase.
    ad.setServerSideVerificationOptions(ServerSideVerificationOptions(userId, args.customData ?: ""))
    ad.adEventCallback = object : RewardedAdEventCallback {
      override fun onAdDismissedFullScreenContent() {
        if (finished.compareAndSet(false, true)) {
          invoke.resolve(result("shown" to true, "earned" to earned.get()))
        }
        ad.destroy()
        preloadRewarded()
      }

      override fun onAdFailedToShowFullScreenContent(fullScreenContentError: FullScreenContentError) {
        if (finished.compareAndSet(false, true)) {
          invoke.resolve(
            result("shown" to false, "earned" to false, "reason" to fullScreenContentError.code.name),
          )
        }
        ad.destroy()
        preloadRewarded()
      }
    }
    onUi({
      if (finished.compareAndSet(false, true)) {
        invoke.resolve(result("shown" to false, "earned" to false, "reason" to "error"))
      }
      ad.destroy()
    }) {
      ad.show(
        activity,
        object : OnUserEarnedRewardListener {
          override fun onUserEarnedReward(reward: RewardItem) {
            earned.set(true)
            trigger("rewardEarned", result("amount" to reward.amount, "type" to reward.type))
          }
        },
      )
    }
  }

  // Tauri crea el plugin una vez por proceso y avisa onDestroy de cada actividad: aquí sólo se
  // quita el banner de esa actividad y se liberan los anuncios cargados; el SDK y el consentimiento
  // siguen disponibles para la actividad que la reemplace.
  override fun onDestroy(activity: AppCompatActivity) {
    onUi { if (container?.context === activity) removeBanner() }
    interstitial?.destroy()
    rewarded?.destroy()
    interstitial = null
    rewarded = null
  }
}
