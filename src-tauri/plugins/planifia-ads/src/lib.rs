//! Anuncios de Google AdMob para PlanifIA.
//!
//! En Android los comandos los atiende `AdsPlugin.kt`. En escritorio (e iOS) cada comando
//! responde `{ "available": false }`, así la misma interfaz funciona sin errores.
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
  pub fn init_ads() -> Value {
    off()
  }
  #[tauri::command]
  pub fn get_ads_state() -> Value {
    off()
  }
  #[tauri::command]
  pub fn show_banner() -> Value {
    off()
  }
  #[tauri::command]
  pub fn hide_banner() -> Value {
    off()
  }
  #[tauri::command]
  pub fn load_interstitial() -> Value {
    off()
  }
  #[tauri::command]
  pub fn show_interstitial() -> Value {
    off()
  }
  #[tauri::command]
  pub fn load_rewarded() -> Value {
    off()
  }
  #[tauri::command]
  pub fn show_rewarded() -> Value {
    off()
  }
  #[tauri::command]
  pub fn show_privacy_options() -> Value {
    off()
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  let builder = Builder::new("planifia-ads");
  #[cfg(not(target_os = "android"))]
  let builder = builder.invoke_handler(tauri::generate_handler![
    unavailable::init_ads,
    unavailable::get_ads_state,
    unavailable::show_banner,
    unavailable::hide_banner,
    unavailable::load_interstitial,
    unavailable::show_interstitial,
    unavailable::load_rewarded,
    unavailable::show_rewarded,
    unavailable::show_privacy_options,
  ]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("cl.planifia.ads", "AdsPlugin")?;
      Ok(())
    })
    .build()
}
