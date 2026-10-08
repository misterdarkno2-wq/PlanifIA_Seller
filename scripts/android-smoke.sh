#!/usr/bin/env bash
# Prueba de humo en un emulador: instala el APK release, comprueba que la app siga abierta,
# ejecuta los comandos nativos de anuncios y compras, sale y vuelve a la app (Android destruye la
# actividad) y repite los comandos. Al final muestra el registro de fallos.
# Uso (con un emulador encendido): bash scripts/android-smoke.sh ruta/al.apk
set -u
APK="$1"
PKG="cl.planifia.app"
OUT="artifacts/android-smoke"
mkdir -p "$OUT"

alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
report() {
  adb logcat -d -v threadtime > "$OUT/logcat.txt" 2>/dev/null
  echo "::group::Ciclo de vida de la actividad"
  adb logcat -b events -d | grep -E "wm_on_(create|destroy|resume|stop)_called|am_crash|am_proc_died" | grep -i planifia | tail -n 40
  echo "::endgroup::"
  echo "::group::Registro filtrado (logcat)"
  grep -E "AndroidRuntime|FATAL|panicked|Fatal signal|backtrace|  #[0-9]+ pc|DEBUG   :|PlanifiaAds|PlanifiaBilling|chromium.*Uncaught|BillingClient" "$OUT/logcat.txt" | tail -n 400
  echo "::endgroup::"
}
commands() {
  local pid socket
  pid=$(adb shell pidof "$PKG" | tr -d '\r')
  socket=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$pid" | head -n 1)
  if [ -z "$socket" ]; then
    echo "Sin depuración del WebView: no se ejecutan los comandos nativos."
    return
  fi
  adb forward --remove-all
  adb forward tcp:9222 "localabstract:$socket"
  node scripts/android-cdp.mjs 9222 || true
  sleep 10
}
check() {
  if alive; then echo "RESULTADO: la app sigue abierta $1."; else echo "RESULTADO: LA APP SE CERRÓ $2."; report; exit 1; fi
}

adb install -r "$APK" || { echo "No se pudo instalar el APK"; exit 1; }
adb logcat -c
adb logcat -b events -c
adb shell am start -W -n "$PKG/.MainActivity"
sleep 30
adb exec-out screencap -p > "$OUT/inicio.png"
check "30 s después de iniciar" "AL INICIAR"

echo "== Comandos nativos (primera actividad)"
commands
check "después de los comandos nativos" "DURANTE LOS COMANDOS NATIVOS"

echo "== Salir y volver: Android destruye la actividad y crea otra en el mismo proceso"
adb shell settings put global always_finish_activities 1
adb shell input keyevent KEYCODE_HOME
sleep 5
adb shell am start -W -n "$PKG/.MainActivity"
sleep 15
adb shell settings put global always_finish_activities 0
check "al volver a la app" "AL VOLVER A LA APP"

echo "== Comandos nativos (segunda actividad)"
commands
adb exec-out screencap -p > "$OUT/final.png"
check "después de volver y repetir los comandos" "AL REPETIR LOS COMANDOS TRAS VOLVER"
report
