#!/usr/bin/env bash
# Prueba de humo en un emulador: instala el APK release, comprueba que la app siga abierta y que
# la interfaz se dibuje, ejecuta los comandos nativos de anuncios y compras, la cierra con Atrás y
# la vuelve a abrir, sale con Inicio y vuelve, y recrea la actividad. Al final muestra el registro.
# Uso (con un emulador encendido): bash scripts/android-smoke.sh ruta/al.apk
set -u
APK="$1"
PKG="cl.planifia.app"
OUT="artifacts/android-smoke"
mkdir -p "$OUT"
STATUS=0

alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
report() {
  adb logcat -d -v threadtime > "$OUT/logcat.txt" 2>/dev/null
  echo "::group::Ciclo de vida de la actividad"
  adb logcat -b events -d | grep -E "wm_on_(create|destroy|resume|stop)_called|am_crash|am_proc_died|am_anr" | grep -i planifia | tail -n 40
  echo "::endgroup::"
  echo "::group::Registro filtrado (logcat)"
  grep -E "AndroidRuntime|FATAL|panicked|Fatal signal|backtrace|  #[0-9]+ pc|DEBUG   :|PlanifiaAds|PlanifiaBilling|Tauri|RustStdout|chromium.*Uncaught|Console|E/.*$PKG|W/Ads|I/Ads|E/Ads|BillingClient" "$OUT/logcat.txt" | tail -n 400
  echo "::endgroup::"
}
cdp() {
  local pid socket
  pid=$(adb shell pidof "$PKG" | tr -d '\r')
  socket=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$pid" | head -n 1)
  if [ -z "$socket" ]; then
    echo "Sin depuración del WebView (pid '$pid')."
    return 2
  fi
  adb forward --remove-all
  adb forward tcp:9222 "localabstract:$socket"
  node scripts/android-cdp.mjs 9222 "$@"
}
fail() { echo "RESULTADO: $1"; STATUS=1; }
check() {
  local label="$1"
  adb exec-out screencap -p > "$OUT/$2.png"
  if ! alive; then fail "LA APP SE CERRÓ ($label)."; report; exit 1; fi
  if cdp render; then echo "RESULTADO: la app está abierta y dibujada ($label)."
  else fail "LA APP ESTÁ ABIERTA PERO SIN INTERFAZ ($label)."; fi
}
open_app() {
  adb shell am start -W -n "$PKG/.MainActivity"
  sleep "${1:-15}"
}

echo "== Dispositivo"
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r')), ABI $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
adb shell dumpsys webviewupdate | grep -E "Current WebView package|versionName" | head -n 3

adb install -r "$APK" || { echo "No se pudo instalar el APK"; exit 1; }
adb logcat -c
adb logcat -b events -c

echo "== Primer inicio"
open_app 30
check "30 s después de iniciar" "1-inicio"

echo "== Comandos nativos (primera actividad)"
cdp || true
sleep 10
check "después de los comandos nativos" "2-comandos"

# Desde Hoy/inicio, Atrás llama a exit(): Tauri termina la actividad y Android puede conservar el
# proceso. Abrir de nuevo crea otra actividad con los mismos plugins.
echo "== Cerrar con Atrás y volver a abrir"
adb shell input keyevent KEYCODE_BACK
sleep 8
if alive; then echo "El proceso sigue vivo tras Atrás (se reutilizará)."; else echo "El proceso terminó tras Atrás."; fi
open_app 20
check "al reabrir tras Atrás" "3-reabrir-atras"

echo "== Salir con Inicio y volver"
adb shell input keyevent KEYCODE_HOME
sleep 5
open_app 10
check "al volver desde Inicio" "4-volver-inicio"

# Cambiar el tamaño de letra no está en configChanges: Android destruye la actividad y crea otra en
# el mismo proceso, como cuando el sistema la recrea.
echo "== Recrear la actividad (cambio de tamaño de letra)"
adb shell settings put system font_scale 1.15
sleep 15
adb shell settings put system font_scale 1.0
sleep 15
check "después de recrear la actividad" "5-recrear"

echo "== Comandos nativos (actividad nueva)"
cdp || true
sleep 10
check "después de repetir los comandos" "6-final"

report
exit $STATUS
