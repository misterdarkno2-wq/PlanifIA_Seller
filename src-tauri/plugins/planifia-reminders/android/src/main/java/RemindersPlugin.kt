package cl.planifia.reminders

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.PluginManager

private const val TAG = "PlanifiaReminders"
private const val ALIAS = "notifications"

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = ALIAS)])
class RemindersPlugin(private val created: Activity) : Plugin(created) {
  // Tauri crea el plugin una vez por proceso; PluginManager apunta a la actividad vigente.
  private val activity: Activity
    get() = PluginManager.activity ?: created

  /**
   * granted: el teléfono deja mostrar avisos. prompt: Android 13+ aún no pregunta. denied: la persona
   * lo negó (o apagó las notificaciones de la app en los ajustes del teléfono).
   */
  private fun permission(): String = when {
    NotificationManagerCompat.from(activity).areNotificationsEnabled() -> "granted"
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> "denied"
    getPermissionState(ALIAS) == PermissionState.DENIED -> "denied"
    else -> "prompt"
  }

  private fun status() = JSObject().apply {
    put("available", true)
    put("permission", permission())
    put("scheduled", ReminderScheduler.pending(activity))
  }

  /** Nunca cierra la app: cualquier error vuelve como { available: true, error } y el aviso no se programa. */
  private fun guard(invoke: Invoke, what: String, block: () -> Unit) {
    try {
      block()
    } catch (error: Throwable) {
      Log.w(TAG, "$what falló", error)
      invoke.resolve(JSObject().apply {
        put("available", true)
        put("error", error.javaClass.simpleName)
      })
    }
  }

  @Command
  fun getStatus(invoke: Invoke) = guard(invoke, "getStatus") { invoke.resolve(status()) }

  /** Pide POST_NOTIFICATIONS sólo en Android 13+ y sólo cuando la persona enciende los recordatorios. */
  @Command
  fun requestPermission(invoke: Invoke) = guard(invoke, "requestPermission") {
    if (permission() == "prompt") requestPermissionForAlias(ALIAS, invoke, "permissionAnswered")
    else invoke.resolve(status())
  }

  @PermissionCallback
  fun permissionAnswered(invoke: Invoke) = guard(invoke, "permissionAnswered") { invoke.resolve(status()) }

  /**
   * Reemplaza todos los avisos programados por { items: [{ id, at, title, body }] } (at en milisegundos
   * desde 1970). Se leen con org.json y no con Jackson para no depender de reglas de R8.
   */
  @Command
  fun schedule(invoke: Invoke) = guard(invoke, "schedule") {
    val list = invoke.getArgs().optJSONArray("items")
    val items = mutableListOf<Reminder>()
    for (i in 0 until minOf(list?.length() ?: 0, ReminderScheduler.MAX_ITEMS)) {
      val item = list!!.optJSONObject(i) ?: continue
      val reminder = Reminder(
        item.optInt("id", 0),
        item.optLong("at", 0L),
        item.optString("title", "").take(80),
        item.optString("body", "").take(200),
      )
      if (reminder.id > 0 && reminder.at > 0 && reminder.title.isNotBlank()) items.add(reminder)
    }
    ReminderScheduler.replace(activity, items)
    invoke.resolve(status())
  }

  @Command
  fun cancelAll(invoke: Invoke) = guard(invoke, "cancelAll") {
    ReminderScheduler.replace(activity, emptyList())
    invoke.resolve(status())
  }

  /** Ajustes de notificaciones de PlanifIA en el teléfono, para volver a permitirlas si se negaron. */
  @Command
  fun openSettings(invoke: Invoke) = guard(invoke, "openSettings") {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
      .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
    activity.startActivity(intent)
    invoke.resolve(status())
  }
}
