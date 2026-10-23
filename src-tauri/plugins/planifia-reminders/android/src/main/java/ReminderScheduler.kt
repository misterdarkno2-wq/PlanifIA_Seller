package cl.planifia.reminders

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "PlanifiaReminders"
private const val PREFS = "planifia-reminders"
private const val KEY = "items"
private const val CHANNEL = "recordatorios"
private const val EXTRA_ID = "cl.planifia.reminders.ID"
private const val ACTION_SHOW = "cl.planifia.reminders.SHOW"

/** Un aviso ya redactado por la app: el texto no lleva títulos de metas ni de acciones. */
data class Reminder(val id: Int, val at: Long, val title: String, val body: String)

/**
 * Guarda los avisos en SharedPreferences y los programa con AlarmManager.setAndAllowWhileIdle: es una
 * alarma inexacta (Android puede atrasarla unos minutos para ahorrar batería), así que la app no
 * necesita SCHEDULE_EXACT_ALARM ni USE_EXACT_ALARM. Tras reiniciar el teléfono o actualizar la app,
 * ReminderReceiver vuelve a programar los que siguen pendientes.
 */
object ReminderScheduler {
  const val MAX_ITEMS = 14
  // Si el teléfono estuvo apagado o en reposo profundo y el aviso llega con más atraso, ya no sirve.
  private const val LATE_LIMIT_MS = 3L * 60 * 60 * 1000

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun read(context: Context): List<Reminder> = try {
    val array = JSONArray(prefs(context).getString(KEY, "[]"))
    (0 until array.length()).map {
      val o = array.getJSONObject(it)
      Reminder(o.getInt("id"), o.getLong("at"), o.getString("title"), o.getString("body"))
    }
  } catch (error: Throwable) {
    emptyList()
  }

  private fun write(context: Context, items: List<Reminder>) {
    val array = JSONArray()
    for (r in items) array.put(JSONObject().put("id", r.id).put("at", r.at).put("title", r.title).put("body", r.body))
    prefs(context).edit().putString(KEY, array.toString()).apply()
  }

  private fun intent(context: Context, id: Int): PendingIntent {
    val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_SHOW).putExtra(EXTRA_ID, id)
    return PendingIntent.getBroadcast(
      context,
      id,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun arm(context: Context, items: List<Reminder>) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val now = System.currentTimeMillis()
    for (r in items) if (r.at > now) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, intent(context, r.id))
  }

  fun pending(context: Context): Int {
    val now = System.currentTimeMillis()
    return read(context).count { it.at > now }
  }

  /** Cancela todo lo anterior y programa la lista nueva (vacía = apagar los recordatorios). */
  fun replace(context: Context, items: List<Reminder>) {
    val alarms = context.getSystemService(AlarmManager::class.java)
    for (r in read(context)) alarms?.cancel(intent(context, r.id))
    val kept = items.distinctBy { it.id }.take(MAX_ITEMS)
    write(context, kept)
    arm(context, kept)
  }

  fun restore(context: Context) = arm(context, read(context))

  fun show(context: Context, id: Int) {
    val all = read(context)
    val reminder = all.firstOrNull { it.id == id } ?: return
    write(context, all.filter { it.id != id })
    if (System.currentTimeMillis() - reminder.at > LATE_LIMIT_MS) return
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
        NotificationChannel(CHANNEL, "Recordatorios", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "El aviso diario a la hora que elegiste para avanzar en tus metas."
        },
      )
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.planifia_reminder)
      .setContentTitle(reminder.title)
      .setContentText(reminder.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(reminder.body))
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    try {
      manager.notify(id, notification)
    } catch (error: SecurityException) {
      Log.w(TAG, "Sin permiso para mostrar el recordatorio", error)
    }
  }
}

/** Muestra el aviso cuando llega la alarma y reprograma los pendientes al reiniciar o actualizar. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      when (intent.action) {
        ACTION_SHOW -> ReminderScheduler.show(context, intent.getIntExtra(EXTRA_ID, 0))
        Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> ReminderScheduler.restore(context)
      }
    } catch (error: Throwable) {
      Log.w(TAG, "No se pudo atender ${intent.action}", error)
    }
  }
}
