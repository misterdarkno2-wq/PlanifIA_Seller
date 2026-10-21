//! Inicio de sesión con Google para PlanifIA.
//!
//! Google bloquea el inicio de sesión OAuth dentro de un WebView (`disallowed_useragent`), así que en
//! Android lo atiende `AuthPlugin.kt` con Credential Manager y devuelve el ID token. En escritorio (e
//! iOS) el comando responde `{ "available": false }`; la web usa el flujo OAuth de Supabase.
use tauri::{
  Runtime,
  plugin::{Builder, TauriPlugin},
};

#[cfg(not(target_os = "android"))]
mod unavailable {
  use serde_json::{Value, json};

  #[tauri::command]
  pub fn sign_in_with_google() -> Value {
    json!({ "available": false })
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  let builder = Builder::new("planifia-auth");
  #[cfg(not(target_os = "android"))]
  let builder = builder.invoke_handler(tauri::generate_handler![unavailable::sign_in_with_google]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("cl.planifia.auth", "AuthPlugin")?;
      Ok(())
    })
    .build()
}
