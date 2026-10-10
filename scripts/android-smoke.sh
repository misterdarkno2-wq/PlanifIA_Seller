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
RESULTS=""
DEVICE="API $(adb shell getprop ro.build.version.sdk | tr -d '\r'), páginas de $(adb shell getconf PAGE_SIZE | tr -d '\r') bytes"

# Los registros y artefactos de Actions piden iniciar sesión; las anotaciones son públicas.
annotate() {
  [ -n "${GITHUB_ACTIONS:-}" ] || return 0
  local text="${3//%/%25}"
  text="${text//$'\r'/}"
  echo "::$1 title=$2::${text//$'\n'/%0A}"
}
alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
report() {
  adb logcat -d -v threadtime > "$OUT/logcat.txt" 2>/dev/null
  echo "::group::Ciclo de vida de la actividad"
  adb logcat -b events -d | grep -E "wm_on_(create|destroy|resume|stop)_called|am_crash|am_proc_died|am_anr" | grep -i planifia | tail -n 40
  echo "::endgroup::"
  echo "::group::Registro filtrado (logcat)"
  grep -E "AndroidRuntime|FATAL|panicked|Fatal signal|backtrace|  #[0-9]+ pc|DEBUG   :|PlanifiaAds|PlanifiaBilling|PlanifiaWebView|aw_browser_terminator|Tauri|RustStdout|chromium.*Uncaught|Console|E/.*$PKG|W/Ads|I/Ads|E/Ads|BillingClient" "$OUT/logcat.txt" | tail -n 400
  echo "::endgroup::"
  annotate notice "Resultado ($DEVICE)" "$RESULTS"
  local errors
  errors=$( { adb logcat -b events -d | grep -E "am_crash|am_anr|am_proc_died" | grep -i planifia
    grep -E "ActivityManager: Killing .*planifia" "$OUT/logcat.txt"
    grep -E "AndroidRuntime|FATAL|Fatal signal|panicked|UnsatisfiedLink|dlopen failed|chromium.*Uncaught|aw_browser_terminator|PlanifiaWebView|Planifia(Ads|Billing).*(rror|xception)" "$OUT/logcat.txt"; } | cut -c1-300 | head -n 60)
  if [ -n "$errors" ]; then annotate warning "Errores en logcat ($DEVICE)" "$errors"; fi
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
note() { echo "RESULTADO: $1"; RESULTS+="$1"$'\n'; }
fail() { note "$1"; STATUS=1; }
check() {
  local label="$1"
  adb exec-out screencap -p > "$OUT/$2.png"
  if ! alive; then fail "LA APP SE CERRÓ ($label)."; report; exit 1; fi
  cdp render
  case $? in
    0) note "la app está abierta y dibujada ($label)." ;;
    3) note "WebView antiguo: se muestra el aviso para actualizarlo ($label)." ;;
    *) fail "LA APP ESTÁ ABIERTA PERO SIN INTERFAZ ($label)." ;;
  esac
}
open_app() {
  adb shell am start -W -n "$PKG/.MainActivity"
  sleep "${1:-15}"
}

echo "== Dispositivo"
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r')), ABI $(adb shell getprop ro.product.cpu.abi | tr -d '\r'), $DEVICE"
adb shell dumpsys webviewupdate | grep -E "Current WebView package|versionName" | head -n 3

# Recién encendido, el emulador actualiza Google Play Services y Android mata a las apps que usan
# sus servicios («depends on provider ... in dying proc com.google.android.gms.persistent»).
# Se espera a que el sistema se estabilice para no confundir eso con un fallo de la app.
sleep 60

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
if alive; then note "el proceso sigue vivo tras Atrás (se reutilizará)."; else note "el proceso terminó tras Atrás."; fi
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

# Android puede matar el proceso del WebView por falta de memoria. Sin onRenderProcessGone
# (scripts/android-webview-client.kt) eso cerraba la app entera.
echo "== Caída del proceso del WebView"
cdp crash || true
sleep 20
check "tras la caída del WebView" "6-webview-caido"

echo "== Comandos nativos (actividad nueva)"
cdp || true
sleep 10
check "después de repetir los comandos" "7-final"

report
exit $STATUS
