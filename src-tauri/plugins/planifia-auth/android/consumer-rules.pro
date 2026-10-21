# Tauri ya conserva las clases @TauriPlugin, sus @Command y las clases @InvokeArg.
# Credential Manager carga por reflexión su proveedor de Google Play Services en Android 13 y
# anteriores. Regla de la guía oficial de Credential Manager para compilaciones con R8: sin ella la
# versión release no encuentra el proveedor y responde "no hay proveedor" aunque Play esté instalado.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
