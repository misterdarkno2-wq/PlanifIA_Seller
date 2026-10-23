//! Recordatorios diarios de PlanifIA con notificaciones locales.
//!
//! En Android los comandos los atiende `RemindersPlugin.kt`, que programa alarmas inexactas del
//! sistema; el servidor no envía notificaciones. En escritorio (e iOS) cada comando responde
//! `{ "available": false }` y la app no muestra el interruptor.
use tauri::{
  Runtime,
  plugin::{Builder, TauriPlugin},
};

#[cfg(not(target_os = "android"))]
mod unavailable {
  use serde_json::{Value, json};

  fn off() -> Value {
    json!({ "available": false })
  }

  #[tauri::command]
  pub fn get_status() -> Value {
    off()
  }
  #[tauri::command]
  pub fn request_permission() -> Value {
    off()
  }
  #[tauri::command]
  pub fn schedule() -> Value {
    off()
  }
  #[tauri::command]
  pub fn cancel_all() -> Value {
    off()
  }
  #[tauri::command]
  pub fn open_settings() -> Value {
    off()
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  let builder = Builder::new("planifia-reminders");
  #[cfg(not(target_os = "android"))]
  let builder = builder.invoke_handler(tauri::generate_handler![
    unavailable::get_status,
    unavailable::request_permission,
    unavailable::schedule,
    unavailable::cancel_all,
    unavailable::open_settings
  ]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("cl.planifia.reminders", "RemindersPlugin")?;
      Ok(())
    })
    .build()
}
