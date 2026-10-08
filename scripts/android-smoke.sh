#!/usr/bin/env bash
# Prueba de humo en un emulador: instala el APK release, comprueba que la app siga abierta,
# ejecuta los comandos nativos de anuncios y compras y muestra el registro de fallos.
# Uso (con un emulador encendido): bash scripts/android-smoke.sh ruta/al.apk
set -u
APK="$1"
PKG="cl.planifia.app"
OUT="artifacts/android-smoke"
mkdir -p "$OUT"

alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
report() {
  adb logcat -d -v threadtime > "$OUT/logcat.txt" 2>/dev/null
  echo "::group::Registro filtrado (logcat)"
  grep -E "AndroidRuntime|FATAL|panicked|Fatal signal|backtrace|  #[0-9]+ pc|DEBUG   :|PlanifiaAds|PlanifiaBilling|Tauri|RustStdout|chromium.*Uncaught|Console|E/.*$PKG|W/Ads|I/Ads|E/Ads|BillingClient" "$OUT/logcat.txt" | tail -n 400
  echo "::endgroup::"
}

adb install -r "$APK" || { echo "No se pudo instalar el APK"; exit 1; }
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
sleep 30
adb exec-out screencap -p > "$OUT/inicio.png"
if alive; then echo "RESULTADO: la app sigue abierta 30 s después de iniciar."; else echo "RESULTADO: LA APP SE CERRÓ AL INICIAR."; report; exit 1; fi

PID=$(adb shell pidof "$PKG" | tr -d '\r')
SOCKET=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$PID" | head -n 1)
if [ -n "$SOCKET" ]; then
  adb forward tcp:9222 "localabstract:$SOCKET"
  node scripts/android-cdp.mjs 9222 || true
  sleep 10
else
  echo "Sin depuración del WebView: no se ejecutan los comandos nativos."
fi

adb exec-out screencap -p > "$OUT/final.png"
if alive; then echo "RESULTADO: la app sigue abierta después de los comandos nativos."; STATUS=0; else echo "RESULTADO: LA APP SE CERRÓ DURANTE LOS COMANDOS NATIVOS."; STATUS=1; fi
report
exit $STATUS
