package cl.planifia.billing

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "PlanifiaBilling"

@InvokeArg
class ProductsArgs {
  var subscriptions: Array<String>? = null
  var products: Array<String>? = null
}

@InvokeArg
class PurchaseArgs {
  var productId: String? = null
  var type: String? = null
  var basePlanId: String? = null
  var offerId: String? = null
  var accountId: String? = null
  var oldPurchaseToken: String? = null
  var oldProductId: String? = null
  var replacement: String? = null
}

@InvokeArg
class FinishArgs {
  var purchaseToken: String? = null
  var consumable: Boolean = false
}

@InvokeArg
class ManageArgs {
  var productId: String? = null
}

@InvokeArg
class ExternalArgs {
  var url: String? = null
}

@TauriPlugin
class BillingPlugin(private val activity: Activity) : Plugin(activity), PurchasesUpdatedListener {
  private val details = ConcurrentHashMap<String, ProductDetails>()
  private val waiters = mutableListOf<(BillingResult?) -> Unit>()
  private var connecting = false
  private var pendingPurchase: Invoke? = null
  private var current: BillingClient? = null

  // La reconexión automática de Billing 8+ reintenta sola cuando el servicio de Play se cae.
  // Tauri crea el plugin una vez por proceso y avisa onDestroy de cada actividad; un cliente
  // cerrado con endConnection() no se puede reutilizar, así que se crea otro cuando haga falta.
  private val client: BillingClient
    get() = synchronized(this) {
      current ?: BillingClient.newBuilder(activity.applicationContext)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()
        .also { current = it }
    }

  private fun ok(result: BillingResult?) = result == null || result.responseCode == BillingResponseCode.OK

  private fun result(vararg pairs: Pair<String, Any?>) = JSObject().apply {
    for ((key, value) in pairs) put(key, value)
  }

  private fun failure(result: BillingResult?) = result(
    "available" to (result?.responseCode != BillingResponseCode.BILLING_UNAVAILABLE),
    "status" to "error",
    "code" to (result?.responseCode ?: BillingResponseCode.ERROR),
    "message" to (result?.debugMessage ?: ""),
  )

  /** Ejecuta la acción con el cliente conectado; varias llamadas simultáneas comparten una conexión. */
  private fun withClient(action: (BillingResult?) -> Unit) {
    if (client.isReady) {
      action(null)
      return
    }
    synchronized(waiters) {
      waiters.add(action)
      if (connecting) return
      connecting = true
    }
    client.startConnection(object : BillingClientStateListener {
      override fun onBillingSetupFinished(billingResult: BillingResult) {
        val list = synchronized(waiters) {
          connecting = false
          waiters.toList().also { waiters.clear() }
        }
        list.forEach { it(if (ok(billingResult)) null else billingResult) }
      }

      override fun onBillingServiceDisconnected() {
        synchronized(waiters) { connecting = false }
        Log.w(TAG, "Servicio de Google Play desconectado; se reconectará en la próxima operación.")
      }
    })
  }

  private fun queryDetails(ids: List<String>, type: String, done: (BillingResult?, List<ProductDetails>, List<String>) -> Unit) {
    if (ids.isEmpty()) {
      done(null, emptyList(), emptyList())
      return
    }
    val params = QueryProductDetailsParams.newBuilder()
      .setProductList(ids.map { QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(type).build() })
      .build()
    client.queryProductDetailsAsync(params) { billingResult, queryResult ->
      val found = queryResult.productDetailsList
      found.forEach { details[it.productId] = it }
      done(
        if (ok(billingResult)) null else billingResult,
        found,
        queryResult.unfetchedProductList.map { it.productId },
      )
    }
  }

  private fun productJson(d: ProductDetails) = JSObject().apply {
    put("productId", d.productId)
    put("type", d.productType)
    put("title", d.title)
    put("name", d.name)
    put("description", d.description)
    d.subscriptionOfferDetails?.let { offers ->
      put("offers", JSArray().apply {
        offers.forEach { offer ->
          put(JSObject().apply {
            put("basePlanId", offer.basePlanId)
            put("offerId", offer.offerId)
            put("offerToken", offer.offerToken)
            put("tags", JSArray(offer.offerTags))
            put("phases", JSArray().apply {
              offer.pricingPhases.pricingPhaseList.forEach { phase ->
                put(JSObject().apply {
                  put("formattedPrice", phase.formattedPrice)
                  put("priceMicros", phase.priceAmountMicros)
                  put("currency", phase.priceCurrencyCode)
                  put("billingPeriod", phase.billingPeriod)
                  put("cycles", phase.billingCycleCount)
                  put("recurrence", phase.recurrenceMode)
                })
              }
            })
          })
        }
      })
    }
    d.oneTimePurchaseOfferDetails?.let { offer ->
      put("oneTime", JSObject().apply {
        put("formattedPrice", offer.formattedPrice)
        put("priceMicros", offer.priceAmountMicros)
        put("currency", offer.priceCurrencyCode)
      })
    }
  }

  private fun purchaseJson(p: Purchase) = JSObject().apply {
    put("productId", p.products.firstOrNull())
    put("products", JSArray(p.products))
    put("purchaseToken", p.purchaseToken)
    put("orderId", p.orderId)
    put(
      "state",
      when (p.purchaseState) {
        Purchase.PurchaseState.PURCHASED -> "purchased"
        Purchase.PurchaseState.PENDING -> "pending"
        else -> "unspecified"
      },
    )
    put("acknowledged", p.isAcknowledged)
    put("autoRenewing", p.isAutoRenewing)
    put("purchaseTime", p.purchaseTime)
    put("quantity", p.quantity)
    put("accountId", p.accountIdentifiers?.obfuscatedAccountId)
  }

  /** Precios y ofertas tal como los entrega Google Play (moneda y formato local). */
  @Command
  fun getProducts(invoke: Invoke) {
    val args = invoke.parseArgs(ProductsArgs::class.java)
    withClient { connection ->
      if (!ok(connection)) {
        invoke.resolve(failure(connection))
        return@withClient
      }
      queryDetails(args.subscriptions?.toList() ?: emptyList(), ProductType.SUBS) { subsError, subs, subsMissing ->
        queryDetails(args.products?.toList() ?: emptyList(), ProductType.INAPP) { inappError, inapp, inappMissing ->
          val error = subsError ?: inappError
          invoke.resolve(JSObject().apply {
            put("available", true)
            put("products", JSArray().apply { (subs + inapp).forEach { put(productJson(it)) } })
            put("unfetched", JSArray(subsMissing + inappMissing))
            if (error != null) put("code", error.responseCode)
          })
        }
      }
    }
  }

  private fun chooseOffer(d: ProductDetails, basePlanId: String?, offerId: String?): ProductDetails.SubscriptionOfferDetails? {
    val offers = d.subscriptionOfferDetails ?: return null
    val plan = offers.filter { basePlanId == null || it.basePlanId == basePlanId }
    // Google sólo devuelve las ofertas para las que la persona es elegible (p. ej., primer mes).
    return plan.firstOrNull { offerId != null && it.offerId == offerId }
      ?: plan.firstOrNull { it.offerId == null }
      ?: plan.firstOrNull()
  }

  @Command
  fun purchase(invoke: Invoke) {
    val args = invoke.parseArgs(PurchaseArgs::class.java)
    val productId = args.productId
    val accountId = args.accountId
    if (productId.isNullOrBlank() || accountId.isNullOrBlank() || accountId.length > 64) {
      invoke.reject("Faltan datos para iniciar la compra.")
      return
    }
    val type = if (args.type == "inapp") ProductType.INAPP else ProductType.SUBS
    withClient { connection ->
      if (!ok(connection)) {
        invoke.resolve(failure(connection))
        return@withClient
      }
      val launch = launch@{ d: ProductDetails? ->
        if (d == null) {
          invoke.resolve(result("status" to "error", "code" to BillingResponseCode.ITEM_UNAVAILABLE, "message" to "Producto no disponible en Google Play."))
          return@launch
        }
        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d)
        if (type == ProductType.SUBS) {
          val offer = chooseOffer(d, args.basePlanId, args.offerId)
          if (offer == null) {
            invoke.resolve(result("status" to "error", "code" to BillingResponseCode.ITEM_UNAVAILABLE, "message" to "No hay un plan disponible."))
            return@launch
          }
          productParams.setOfferToken(offer.offerToken)
        }
        val flow = BillingFlowParams.newBuilder()
          // Liga la compra a la cuenta de Supabase; el servidor lo comprueba con Google.
          .setObfuscatedAccountId(accountId)
        val old = args.oldPurchaseToken
        val oldProduct = args.oldProductId
        if (type == ProductType.SUBS && !old.isNullOrBlank() && !oldProduct.isNullOrBlank()) {
          // Cambio Plus <-> Pro: subir cobra la diferencia ahora; bajar acredita el tiempo restante.
          productParams.setSubscriptionProductReplacementParams(
            BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams.newBuilder()
              .setOldProductId(oldProduct)
              .setReplacementMode(
                if (args.replacement == "upgrade") {
                  BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams.ReplacementMode.CHARGE_PRORATED_PRICE
                } else {
                  BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams.ReplacementMode.WITH_TIME_PRORATION
                },
              )
              .build(),
          )
          flow.setSubscriptionUpdateParams(
            BillingFlowParams.SubscriptionUpdateParams.newBuilder().setOldPurchaseToken(old).build(),
          )
        }
        flow.setProductDetailsParamsList(listOf(productParams.build()))
        activity.runOnUiThread {
          synchronized(this) {
            if (pendingPurchase != null) {
              invoke.resolve(result("status" to "error", "code" to BillingResponseCode.DEVELOPER_ERROR, "message" to "Ya hay una compra en curso."))
              return@runOnUiThread
            }
            pendingPurchase = invoke
          }
          val launched = client.launchBillingFlow(activity, flow.build())
          if (!ok(launched)) {
            synchronized(this) { pendingPurchase = null }
            invoke.resolve(statusPayload(launched, null))
          }
        }
      }
      val cached = details[productId]
      if (cached != null) launch(cached)
      else queryDetails(listOf(productId), type) { _, found, _ -> launch(found.firstOrNull()) }
    }
  }

  private fun statusPayload(billingResult: BillingResult, purchases: List<Purchase>?) = JSObject().apply {
    val list = purchases ?: emptyList()
    put(
      "status",
      when (billingResult.responseCode) {
        BillingResponseCode.OK ->
          if (list.any { it.purchaseState == Purchase.PurchaseState.PENDING }) "pending" else "purchased"
        BillingResponseCode.USER_CANCELED -> "cancelled"
        BillingResponseCode.ITEM_ALREADY_OWNED -> "already_owned"
        else -> "error"
      },
    )
    put("code", billingResult.responseCode)
    put("message", billingResult.debugMessage)
    put("purchases", JSArray().apply { list.forEach { put(purchaseJson(it)) } })
  }

  /** Google llama aquí al terminar la compra, y también cuando una compra pendiente se completa. */
  override fun onPurchasesUpdated(billingResult: BillingResult, purchases: MutableList<Purchase>?) {
    val payload = statusPayload(billingResult, purchases)
    val waiting = synchronized(this) { pendingPurchase.also { pendingPurchase = null } }
    waiting?.resolve(payload)
    trigger("purchasesUpdated", payload)
  }

  private fun queryOwned(type: String, done: (BillingResult?, List<Purchase>) -> Unit) {
    client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { billingResult, purchases ->
      done(if (ok(billingResult)) null else billingResult, purchases)
    }
  }

  /** Compras vigentes en esta cuenta de Google (suscripciones activas y paquetes sin consumir). */
  @Command
  fun restorePurchases(invoke: Invoke) {
    withClient { connection ->
      if (!ok(connection)) {
        invoke.resolve(failure(connection))
        return@withClient
      }
      queryOwned(ProductType.SUBS) { subsError, subs ->
        queryOwned(ProductType.INAPP) { inappError, inapp ->
          val error = subsError ?: inappError
          invoke.resolve(JSObject().apply {
            put("available", true)
            put("purchases", JSArray().apply { (subs + inapp).forEach { put(purchaseJson(it)) } })
            if (error != null) put("code", error.responseCode)
          })
        }
      }
    }
  }

  /** Respaldo del servidor: acknowledge de suscripciones o consumo de paquetes ya acreditados. */
  @Command
  fun finishPurchase(invoke: Invoke) {
    val args = invoke.parseArgs(FinishArgs::class.java)
    val token = args.purchaseToken
    if (token.isNullOrBlank()) {
      invoke.reject("Falta la compra.")
      return
    }
    withClient { connection ->
      if (!ok(connection)) {
        invoke.resolve(failure(connection))
        return@withClient
      }
      val done = { r: BillingResult ->
        invoke.resolve(result("ok" to (r.responseCode == BillingResponseCode.OK || r.responseCode == BillingResponseCode.ITEM_NOT_OWNED), "code" to r.responseCode))
      }
      if (args.consumable) {
        client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build()) { r, _ -> done(r) }
      } else {
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build()) { r -> done(r) }
      }
    }
  }

  private fun open(url: String, invoke: Invoke) {
    activity.runOnUiThread {
      try {
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        invoke.resolve(result("opened" to true))
      } catch (error: ActivityNotFoundException) {
        invoke.resolve(result("opened" to false))
      }
    }
  }

  /** Abre la página de Google Play para gestionar o cancelar la suscripción. */
  @Command
  fun manageSubscriptions(invoke: Invoke) {
    val args = invoke.parseArgs(ManageArgs::class.java)
    val product = args.productId?.takeIf { Regex("^[a-z0-9][a-z0-9_.]{0,39}$").matches(it) }
    val url = if (product == null) {
      "https://play.google.com/store/account/subscriptions"
    } else {
      "https://play.google.com/store/account/subscriptions?sku=${Uri.encode(product)}&package=${Uri.encode(activity.packageName)}"
    }
    open(url, invoke)
  }

  /** Abre en el navegador sólo páginas propias o de Google (términos, privacidad, ayuda de Play). */
  @Command
  fun openExternal(invoke: Invoke) {
    val url = invoke.parseArgs(ExternalArgs::class.java).url ?: ""
    val uri = Uri.parse(url)
    val allowed = setOf("planifia.cl", "www.planifia.cl", "play.google.com", "support.google.com", "policies.google.com")
    if (uri.scheme != "https" || uri.host !in allowed) {
      invoke.reject("Dirección no permitida.")
      return
    }
    open(url, invoke)
  }

  override fun onDestroy(activity: AppCompatActivity) {
    val closing = synchronized(this) { current.also { current = null } }
    synchronized(waiters) { connecting = false }
    closing?.endConnection()
  }
}
