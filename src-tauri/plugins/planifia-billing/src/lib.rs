//! Compras de Google Play para PlanifIA.
//!
//! En Android los comandos los atiende `BillingPlugin.kt`. En escritorio (e iOS) cada comando
//! responde `{ "available": false }`: allí no se venden suscripciones.
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
  pub fn get_products() -> Value {
    off()
  }
  #[tauri::command]
  pub fn purchase() -> Value {
    off()
  }
  #[tauri::command]
  pub fn restore_purchases() -> Value {
    off()
  }
  #[tauri::command]
  pub fn finish_purchase() -> Value {
    off()
  }
  #[tauri::command]
  pub fn manage_subscriptions() -> Value {
    off()
  }
  #[tauri::command]
  pub fn open_external() -> Value {
    off()
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  let builder = Builder::new("planifia-billing");
  #[cfg(not(target_os = "android"))]
  let builder = builder.invoke_handler(tauri::generate_handler![
    unavailable::get_products,
    unavailable::purchase,
    unavailable::restore_purchases,
    unavailable::finish_purchase,
    unavailable::manage_subscriptions,
    unavailable::open_external,
  ]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("cl.planifia.billing", "BillingPlugin")?;
      Ok(())
    })
    .build()
}
