package cl.planifia.auth

import android.app.Activity
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.CancellationSignal
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.PluginManager
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "PlanifiaAuth"

// ID de cliente *Web* de Google (es público): número del proyecto, guion y sufijo de Google.
private val CLIENT_ID = Regex("^[0-9]{6,20}-[a-z0-9]{8,64}\\.apps\\.googleusercontent\\.com$")

// SHA-256 del nonce en hexadecimal. Google lo copia en el ID token y Supabase lo compara con el hash
// del nonce original, que nunca sale del JavaScript salvo hacia Supabase.
private val HASHED_NONCE = Regex("^[0-9a-f]{64}$")

@InvokeArg
class GoogleArgs {
  var serverClientId: String? = null
  var nonce: String? = null
}

@TauriPlugin
class AuthPlugin(private val created: Activity) : Plugin(created) {
  // Tauri crea el plugin una vez por proceso; PluginManager apunta a la actividad vigente.
  private val activity: Activity
    get() = PluginManager.activity ?: created

  private fun result(vararg pairs: Pair<String, Any?>) = JSObject().apply {
    put("available", true)
    for ((key, value) in pairs) put(key, value)
  }

  /** Sin red no se abre la ventana de Google. Si no se puede saber, decide Google. */
  private fun online(): Boolean = try {
    val manager = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
  } catch (error: Throwable) {
    true
  }

  private fun playServicesReady(): Boolean = try {
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) == ConnectionResult.SUCCESS
  } catch (error: Throwable) {
    false
  }

  /**
   * Abre la ventana «Iniciar sesión con Google» y devuelve el ID token de la cuenta elegida.
   * Nunca cierra la app: todo error vuelve como un estado que el JavaScript traduce al español
   * (cancelled, no_account, no_play_services, offline, interrupted, config, error).
   */
  @Command
  fun signInWithGoogle(invoke: Invoke) {
    // Tauri resuelve sólo la primera respuesta; esto evita además registrar dos veces.
    val answered = AtomicBoolean(false)
    fun answer(vararg pairs: Pair<String, Any?>) {
      if (answered.compareAndSet(false, true)) invoke.resolve(result(*pairs))
    }
    try {
      val args = invoke.parseArgs(GoogleArgs::class.java)
      val clientId = args.serverClientId?.takeIf { CLIENT_ID.matches(it) }
      val nonce = args.nonce?.takeIf { HASHED_NONCE.matches(it) }
      if (clientId == null || nonce == null) {
        answer("status" to "config")
        return
      }
      if (!playServicesReady()) {
        answer("status" to "no_play_services")
        return
      }
      if (!online()) {
        answer("status" to "offline")
        return
      }
      val option = GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build()
      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
      val screen = activity
      screen.runOnUiThread {
        try {
          CredentialManager.create(screen).getCredentialAsync(
            screen,
            request,
            CancellationSignal(),
            ContextCompat.getMainExecutor(screen),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
              override fun onResult(result: GetCredentialResponse) {
                try {
                  val credential = result.credential
                  val google = credential is CustomCredential && (
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ||
                      credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL
                    )
                  if (!google) {
                    Log.w(TAG, "Credencial inesperada: ${credential.type}")
                    answer("status" to "error", "code" to "unexpected_credential")
                    return
                  }
                  // El token no se registra: identifica a la persona.
                  answer("status" to "ok", "idToken" to GoogleIdTokenCredential.createFrom(credential.data).idToken)
                } catch (error: Throwable) {
                  Log.e(TAG, "No se pudo leer la credencial de Google", error)
                  answer("status" to "error", "code" to "parse")
                }
              }

              override fun onError(e: GetCredentialException) {
                val status = when (e) {
                  is GetCredentialCancellationException -> "cancelled"
                  is NoCredentialException -> "no_account"
                  is GetCredentialProviderConfigurationException, is GetCredentialUnsupportedException -> "no_play_services"
                  is GetCredentialInterruptedException -> "interrupted"
                  else -> if (online()) "error" else "offline"
                }
                // Sólo el tipo y el texto de Google (sin datos de la persona) para diagnosticar,
                // por ejemplo «[28444] Developer console is not set up correctly».
                if (status == "error") Log.w(TAG, "Inicio con Google falló: ${e.type}: ${e.errorMessage}")
                answer("status" to status, "code" to e.type)
              }
            },
          )
        } catch (error: Throwable) {
          Log.e(TAG, "No se pudo abrir el inicio con Google", error)
          answer("status" to "error", "code" to "launch")
        }
      }
    } catch (error: Throwable) {
      Log.e(TAG, "Falló signInWithGoogle", error)
      answer("status" to "error", "code" to "internal")
    }
  }
}
