# Anuncios, planes y créditos en Android

Esta guía explica cómo funciona la monetización de PlanifIA en la app de Google Play y qué debes configurar tú en AdMob, Play Console, Google Cloud y Supabase. Las secciones 3 a 8 son pasos que solo puedes hacer tú, con tus cuentas.

## 1. Cómo funciona (resumen simple)

| Plan | Precio en Google Play | Créditos de IA | Metas activas | Anuncios |
| --- | --- | --- | --- | --- |
| Gratis | $0 | 60 de bienvenida + los que ganes | 3 | Video al usar la IA (máx. 1 cada 5 min, nunca en el primer plan) + recompensados voluntarios. Sin banner. La compra única "Quitar anuncios" ($2.900) quita los videos |
| Plus | Primer mes $900, luego $2.700/mes | 1.000 cada mes pagado | 15 | No |
| Pro | Primer mes $1.900, luego $4.900/mes | 2.500 cada mes pagado | 50 | No |

- **Cada uso de IA** (crear o ajustar un plan) cuesta **20 créditos**. Si la IA falla o cancelas antes de que empiece, se devuelven.
- Los créditos del plan **se renuevan cada mes pagado y no se acumulan**. Cambiar entre Plus y Pro no reinicia el mes, para que nadie pueda regalarse créditos cambiando de plan.
- Los créditos **extra no vencen** y se gastan después de los del plan:
  - **Anuncio recompensado:** +10 créditos, hasta 5 por día (hora de Chile). Solo en el plan Gratis.
  - **Invitaciones:** +40 para quien invita y +20 para quien llega, cuando la persona invitada confirma su correo y usa la IA por primera vez. Máximo 10 invitaciones premiadas al mes.
  - **Paquetes de créditos:** 100, 300 o 1.000 créditos. Cuestan $900, $2.400 y $6.900, y se definen en Play Console.
- **Plus y Pro no muestran ningún anuncio**, ni siquiera recompensados.
- El **servidor (Supabase) decide todo**: el teléfono nunca suma créditos ni activa planes por su cuenta.
  - Las compras se validan con la Google Play Developer API.
  - Los anuncios recompensados, con la verificación firmada de AdMob (SSV).
- En la web (planifia.cl) también se ven los créditos y las invitaciones. Allí no hay anuncios ni compras.

Todos los valores se pueden cambiar sin publicar una versión nueva de la app:
- Créditos, recompensas y límites: tabla `private.credit_settings`.
- Créditos de cada plan: `public.plan_catalog.monthly_credits`.
- IDs de productos: `private.play_products`.

## 2. Qué se agregó al proyecto

| Parte | Archivos |
| --- | --- |
| Base de datos | `supabase/migrations/202610070001_play_credits.sql` |
| Verificar compras | `supabase/functions/play-billing/` |
| Avisos de Google (renovación, cancelación, reembolso) | `supabase/functions/play-rtdn/` |
| Recompensas de AdMob | `supabase/functions/admob-ssv/` |
| Código compartido con Google Play | `supabase/functions/_shared/google-play.ts`, `play-sync.ts` |
| Plugin de anuncios (Rust + Kotlin) | `src-tauri/plugins/planifia-ads/` |
| Plugin de pagos (Rust + Kotlin) | `src-tauri/plugins/planifia-billing/` |
| Registro de plugins | `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` |
| Android | `AndroidManifest.xml` (App ID de AdMob), `res/values/admob.xml` (tus IDs) y `src/debug/res/values/admob.xml` (IDs de prueba) |
| Frontend | `src/native-ads.js`, `src/native-billing.js`, `src/monetization-config.js`, `src/billing.js`, `src/billing-cloud.js`, `src/main.js` y los CSS |
| Web | `public/terminos.html` (nueva) y `public/privacidad.html` (actualizada) |

Versiones usadas, las estables más recientes al 7 de octubre de 2026:
- **Google Mobile Ads, SDK Next-Gen 1.5.0.** Google dejó el SDK clásico `play-services-ads` en mantenimiento.
- **User Messaging Platform (UMP) 4.0.0.**
- **Play Billing Library 9.1.0.**

En escritorio (`npm run desktop:dev`) los plugins responden "no disponible" y la app funciona igual, sin anuncios ni compras.

## 3. AdMob: cuenta, app y bloques de anuncios

**Estado al 7-oct-2026 (cuenta misterdarkno2@gmail.com, editor `pub-7813096396596933`):**

| Elemento | ID |
| --- | --- |
| App "PlanifIA" (Android) | `ca-app-pub-7813096396596933~5887633291` |
| Banner "Banner inferior" (sin uso desde la 2.2.3) | `ca-app-pub-7813096396596933/7123684189` |
| Intersticial "Pausa natural" (video al usar la IA) | `ca-app-pub-7813096396596933/4497520843` |
| Recompensado "Créditos de IA" (10 `creditos`) | `ca-app-pub-7813096396596933/3062904262` |

Ya están en `admob.xml` y en `supabase/functions/.env.local` (`ADMOB_REWARDED_AD_UNIT`). El perfil de pagos está completo y el mensaje de consentimiento europeo "PlanifIA - Consentimiento Europa" está publicado (botones Consentir, No consentir y Gestionar opciones; política `https://planifia.cl/privacidad.html`).

Pendiente en AdMob:
- **Vincular la app a Google Play** (Apps → PlanifIA → Configuración de la app → Agregar tienda) cuando esté publicada en producción. Mientras tanto queda en "Publicación limitada".
- **Verificación del lado del servidor** del bloque "Créditos de IA", después de desplegar `admob-ssv` (sección 7). Ve a Apps → PlanifIA → Unidades de anuncios → Créditos de IA → Configuración avanzada → Verificación por parte del servidor y pega `https://hlnzxgpdxgadbdcqavcd.supabase.co/functions/v1/admob-ssv`.

Pasos originales, por si necesitas repetirlos:


1. Entra a https://admob.google.com con la cuenta de Google del negocio y completa el perfil y los **datos de pago** (Chile, CLP).
2. **Apps → Agregar app → Android → Sí, está publicada en Google Play.** Busca `cl.planifia.app`.
   - Si la app aún no aparece porque solo está en prueba cerrada, elige "No" y vincúlala a la tienda cuando esté en producción.
3. Copia el **ID de la app** (`ca-app-pub-XXXXXXXXXXXXXXXX~NNNNNNNNNN`).
4. Crea tres **bloques de anuncios** y copia el ID de cada uno (`ca-app-pub-…/NNNNNNNNNN`):
   - **Banner**, nombre "Banner inferior".
   - **Intersticial**, nombre "Pausa natural".
   - **Recompensado**, nombre "Créditos de IA", con recompensa **10** y artículo **creditos**.
     - En **Verificación del lado del servidor** pega `https://hlnzxgpdxgadbdcqavcd.supabase.co/functions/v1/admob-ssv` y pulsa **Verificar URL**. Primero despliega la función (sección 7).
5. Abre `src-tauri/gen/android/app/src/main/res/values/admob.xml` y reemplaza los cuatro IDs de prueba por los tuyos.
   - Las compilaciones de depuración siguen usando los de prueba automáticamente.
6. **Privacidad y mensajes → GDPR (Europa) y regulaciones de EE. UU.:** crea los mensajes de consentimiento para la app. Sin ellos, la app no muestra el formulario donde la ley lo exige.
   - En Chile no se muestra formulario: la app carga anuncios directamente.
7. **Configuración de la app → Contenido:** clasificación máxima de anuncios **T (adolescentes)**, la misma que fija el código.
8. Nunca hagas clic en tus propios anuncios reales. Para probar, usa la compilación de depuración.

## 4. Play Console: perfil de pagos y productos

**Estado al 7-oct-2026:** las dos suscripciones (plan base `mensual` y oferta `primer-mes`, ambos activos) y los tres paquetes de créditos (opción de compra `compra`, retrocompatible) están creados y activos para todos los países, con los precios de las tablas. Play redondea los precios en CLP a la centena, por eso son $2.700, $4.900, $900, $2.400 y $6.900. La oferta usa una fase **Pago único** de 1 mes, porque una fase "Pago recurrente con descuento" exige al menos 2 períodos. En el perfil de pagos ya hay una cuenta BancoEstado (verificación con cartola en curso) y el umbral de pago está en USD 100, para pagar menos comisiones bancarias. La lista "Testers de licencias" (misterdarkno2@gmail.com) compra sin cargo. La 2.2.0 se aprobó en la prueba cerrada. El 8-oct-2026 la 2.2.1 (ícono de Lumi y botones más grandes) se publicó en la prueba interna, que tenía la 2.1.0 sin el permiso AD_ID y bloqueaba la prueba cerrada, y se envió a revisión para la prueba cerrada.

Pasos originales, por si necesitas repetirlos:

1. **Configuración → Perfil de pagos:** crea o vincula el perfil de comerciante con los datos de tu negocio y una cuenta bancaria chilena. Es obligatorio para vender.
2. **Monetizar → Productos → Suscripciones → Crear suscripción** (los IDs deben ser **exactamente** estos):

   | ID del producto | Nombre | Plan base (ID) | Precio Chile | Oferta (ID) |
   | --- | --- | --- | --- | --- |
   | `planifia_plus` | PlanifIA Plus | `mensual`, renovación automática, 1 mes | $2.700 | `primer-mes` |
   | `planifia_pro` | PlanifIA Pro | `mensual`, renovación automática, 1 mes | $4.900 | `primer-mes` |

   Para cada suscripción:
   - Activa el plan base `mensual`.
   - Crea la oferta `primer-mes`:
     - Elegibilidad: **Adquisición de clientes nuevos**.
     - Fase: **Pago único** de $900 (Plus) o $1.900 (Pro) durante **1 mes**.
     - Activa la oferta.
   - Google mostrará la oferta solo a quien nunca tuvo esa suscripción; la app lo detecta sola.
   - En **Período de gracia**, deja el predeterminado (7 días). Durante ese período el usuario conserva el plan.
3. **Monetizar → Productos → Productos únicos → Crear un producto único** (opción de compra `compra`, tipo Comprar):

   | ID del producto | Nombre | Precio Chile |
   | --- | --- | --- |
   | `creditos_100` | 100 créditos de IA | $900 |
   | `creditos_300` | 300 créditos de IA | $2.400 |
   | `creditos_1000` | 1.000 créditos de IA | $6.900 |
   | `sin_anuncios` | Quitar anuncios | $2.900 (no se consume: es para siempre) |

   Actívalos. La app los consume tras acreditarlos, así se pueden comprar varias veces.
4. Los productos solo aparecen en la app cuando una versión que contiene Play Billing está publicada en algún canal (la prueba cerrada sirve) y la instalaste desde Play.

## 5. Google Cloud: verificación de compras y avisos (RTDN)

**Estado al 7-oct-2026:**
- Proyecto `planifia-play` (cuenta misterdarkno2@gmail.com) creado.
- API Google Play Android Developer habilitada.
- Cuenta de servicio `planifia-play-verifier@planifia-play.iam.gserviceaccount.com` creada, sin roles de proyecto. Su clave JSON está en `supabase/functions/.env.local` (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`) y la copia original en `Descargas\planifia-play-0666c737a56c.json`. Guárdala en un gestor de contraseñas y borra la copia de Descargas.
- Esa cuenta está invitada en Play Console con acceso solo a PlanifIA: ver datos financieros y gestionar pedidos y suscripciones.
- Pub/Sub habilitado y tema `projects/planifia-play/topics/play-rtdn` creado. Google Play puede publicar en él (`google-play-developer-notifications@system.gserviceaccount.com`, rol Publicador de Pub/Sub).
- Notificaciones en tiempo real activadas en Play Console con ese tema, para suscripciones, compras anuladas y productos únicos.
- `PLAY_RTDN_SECRET` generado en `.env.local`.

Pendiente:
- **Crear la suscripción push** `play-rtdn-supabase`, de tipo push, sobre el tema `play-rtdn`. Su URL completa (con el secreto) está comentada al final de `supabase/functions/.env.local`. Hazlo después de desplegar `play-rtdn`; luego pulsa "Enviar notificación de prueba" en Play Console.

Pasos originales, por si necesitas repetirlos:


### Cuenta de servicio (para que Supabase consulte las compras)

1. En https://console.cloud.google.com crea un proyecto (por ejemplo, "PlanifIA Play").
2. **APIs y servicios → Biblioteca:** habilita **Google Play Android Developer API**.
3. **IAM → Cuentas de servicio → Crear**, con el nombre `planifia-play-verifier`. No le asignes roles del proyecto.
4. En la cuenta creada: **Claves → Agregar clave → JSON**. Se descarga un archivo.
   - **Guárdalo fuera del repositorio.** Es una contraseña.
5. En **Play Console → Usuarios y permisos → Invitar usuarios**, pega el correo de la cuenta de servicio (`…@….iam.gserviceaccount.com`).
   - Dale acceso a la app PlanifIA con los permisos **Ver información financiera** y **Gestionar pedidos y suscripciones**.
   - Los permisos pueden tardar hasta 24 h en activarse.

### Notificaciones en tiempo real (renovaciones, cancelaciones, reembolsos)

1. En Google Cloud, **Pub/Sub → Temas → Crear tema** `play-rtdn`.
2. En el tema, **Permisos → Agregar principal** `google-play-developer-notifications@system.gserviceaccount.com` con el rol **Publicador de Pub/Sub**.
3. **Suscripciones → Crear suscripción** `play-rtdn-supabase`:
   - Tipo **Push**.
   - URL: `https://hlnzxgpdxgadbdcqavcd.supabase.co/functions/v1/play-rtdn?token=TU_SECRETO`.
     - `TU_SECRETO` es el valor de `PLAY_RTDN_SECRET`: al menos 32 caracteres aleatorios.
4. En **Play Console → Monetizar → Configuración de la monetización → Notificaciones en tiempo real para desarrolladores**:
   - Pega el tema completo (`projects/TU_PROYECTO/topics/play-rtdn`).
   - Elige **Suscripciones, compras anuladas y todos los productos integrados**.
   - Pulsa **Enviar notificación de prueba**. En los registros de la función debe aparecer una respuesta 200.

## 6. Cuentas de prueba (comprar sin cobro real)

1. **Play Console → Configuración → Prueba de licencias:** agrega los correos de Google de quienes probarán y elige **RESPOND_NORMALLY**.
2. Esas cuentas también deben estar en la lista de verificadores de la prueba cerrada e instalar la app desde el enlace de participación.
3. En las compras de prueba, Google muestra "Tarjeta de prueba, siempre se aprueba".
   - Las suscripciones de prueba se renuevan cada 5 minutos y se cancelan solas tras 6 renovaciones.
   - Así puedes probar renovación y vencimiento en una hora.
4. Para probar un pago pendiente, elige "Tarjeta de prueba, se rechaza tras unos minutos" o "Instrumento lento".

## 7. Supabase: base de datos, secretos y funciones

Desde la carpeta del proyecto:

```powershell
npx.cmd supabase db push
```

Agrega a `supabase/functions/.env.local` (archivo privado, fuera de Git):

```dotenv
GOOGLE_PLAY_PACKAGE_NAME=cl.planifia.app
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON={"type":"service_account", ... todo el JSON en UNA línea ...}
PLAY_RTDN_SECRET=una-frase-aleatoria-de-al-menos-32-caracteres
ADMOB_REWARDED_AD_UNIT=ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN
```

Luego:

```powershell
npx.cmd supabase secrets set --env-file supabase/functions/.env.local
npx.cmd supabase functions deploy play-billing
npx.cmd supabase functions deploy play-rtdn
npx.cmd supabase functions deploy admob-ssv
```

`ALLOWED_ORIGINS` ya incluye `https://tauri.localhost`, que es el origen de la app Android.

## 8. Ficha de Play Console: anuncios, privacidad y seguridad de los datos

- **Contenido de la app → Anuncios:** cambia a **Sí, mi app contiene anuncios**. Play mostrará la etiqueta "Contiene anuncios".
- **Contenido de la app → ID de publicidad:** responde **Sí**, para **Publicidad o marketing**. El SDK de anuncios agrega el permiso `AD_ID`.
- **Política de privacidad:** la de `https://planifia.cl/privacidad.html` ya está actualizada. Publica la web (merge a `main`) para que el cambio y `terminos.html` queden en línea.
- **Seguridad de los datos.** Agrega, además de lo que ya declaraste en `docs/google-play.md`:
  - *Identificadores del dispositivo u otros → ID de dispositivo o de publicidad*:
    - Recopilado **y compartido** (con Google AdMob).
    - Propósitos: **Publicidad o marketing** y **Prevención de fraudes**.
    - Opcional: solo plan Gratis.
  - *Actividad en apps → Interacciones con la app*: también **compartido** con AdMob, para **Publicidad** y **Estadísticas**.
  - *Información de la app y rendimiento → Registros de fallas y Diagnóstico*: recopilados y compartidos por el SDK de anuncios, para **Estadísticas**.
  - *Información financiera → Historial de compras*: compras de Google Play, para **Funcionalidad de la app**.
  - Revisa la guía oficial "Google Mobile Ads SDK – Seguridad de los datos" antes de enviar.
- **app-ads.txt:** ya está creado en `public/app-ads.txt` con el ID de editor `pub-7813096396596933`. Publica la web (merge a `main`) para que quede en `https://planifia.cl/app-ads.txt`. En la ficha de Play, el "Sitio web" debe ser `https://planifia.cl/` (ya lo es). AdMob lo verifica en unas 24 h, en **Apps → Ver todas las apps → app-ads.txt**.

## 9. Compilar el AAB firmado y subir la versión

La versión ya quedó en **2.2.4 (versionCode 20204)** en `src-tauri/tauri.conf.json`. Play rechaza un versionCode repetido: súbelo en cada nueva subida, por ejemplo 20205.

Antes de compilar el AAB, el workflow **Android en emulador** (`.github/workflows/android-smoke.yml`) compila el APK release con R8, lo abre en un emulador y prueba anuncios y compras. Corre solo en `main` y en las ramas `claude/**`. La 2.2.1 se cerraba al abrir por R8 (constructores de WorkManager/Room); la regla está en `src-tauri/gen/android/app/proguard-rules.pro`.

```powershell
powershell -ExecutionPolicy RemoteSigned -File .\scripts\android-aab.ps1
```

El script pide las contraseñas ocultas y deja el archivo en `src-tauri\gen\android\app\build\outputs\bundle\universalRelease\app-universal-release.aab`. Para subirlo:
1. Ve a **Play Console → Prueba cerrada → Crear versión**.
2. Sube el AAB y escribe las notas de la versión, por ejemplo: "Planes Plus y Pro, créditos de IA, invitaciones y anuncios en el plan Gratis".
3. Envíalo a revisión.

## 10. Lista de verificación

Instala la app desde el enlace de prueba cerrada con una cuenta de prueba de licencias.

**Anuncios y consentimiento**
- [ ] Una compilación de depuración (`npm run android:apk`) muestra anuncios marcados **"Test Ad"**.
- [ ] Con una VPN o un emulador en un país del EEE aparece el formulario de consentimiento antes de cualquier anuncio.
- [ ] En **Ajustes → Anuncios y privacidad** se puede volver a abrir el formulario.
- [ ] Al rechazar el consentimiento no aparecen anuncios.
- [ ] No aparece ningún banner. En el plan Gratis, al crear o ajustar un plan con IA aparece un video, como máximo uno cada 5 minutos y nunca en el primer plan.
- [ ] Con **Quitar anuncios** comprado (Mi plan → Planes), la IA ya no muestra videos y el anuncio voluntario para ganar créditos sigue disponible. **Restaurar compras** lo recupera en otro teléfono.
  - [ ] Nunca más de uno cada 5 minutos.
- [ ] En **Mi plan → Ver anuncio**, al terminar el anuncio el saldo sube 10 créditos en unos segundos.
  - [ ] El sexto anuncio del día ya no está disponible.

**Compras**
- [ ] **Planes** muestra los precios que entrega Google Play, con "$900 el primer mes" para una cuenta nueva.
- [ ] Comprar **Plus** con la tarjeta de prueba:
  - [ ] Se ve "Tu plan actual" y desaparecen todos los anuncios.
  - [ ] Mi plan muestra 1.000 créditos del plan.
- [ ] Comprar un **paquete de 100 créditos**: el saldo sube 100 y se puede volver a comprar.
- [ ] Desinstalar, reinstalar e iniciar sesión, luego **Restaurar compras**: vuelve el plan Plus.
- [ ] **Cambiar a Pro**: Google muestra el cambio con prorrateo y Mi plan muestra Pro con 2.500 créditos y el mismo consumo del mes.
- [ ] **Gestionar o cancelar en Google Play → Cancelar**:
  - [ ] Mi plan muestra "Cancelada · conservas el acceso".
  - [ ] Al vencer (unos minutos en prueba), vuelve a Gratis y reaparecen los anuncios.
- [ ] Pago pendiente ("Instrumento lento"):
  - [ ] Aparece "Tu pago quedó pendiente".
  - [ ] Al confirmarse se activa solo (aviso RTDN o al volver a abrir la app).
- [ ] Reembolso desde **Play Console → Gestión de pedidos**:
  - [ ] El plan o los créditos se retiran (aviso de compra anulada).

**Créditos e invitaciones**
- [ ] Una cuenta nueva tiene 60 créditos. Tres planes con IA la dejan en 0, y el cuarto muestra "No tienes créditos suficientes" con el enlace "Conseguir créditos".
- [ ] Si la IA falla o cancelas antes de que empiece, el saldo vuelve.
- [ ] Una cuenta nueva usa el código de otra en **Mi plan → ¿Te invitaron?**.
  - [ ] Al usar la IA por primera vez, la persona invitada recibe +20 y quien invitó +40.
- [ ] En el escritorio (`npm run desktop:dev`) la app abre sin errores, sin anuncios ni compras.

## 11. Opción mínima sin servidor (no implementada)

Se descartó verificar las compras solo en el teléfono, por tres razones:
- Una app modificada podría marcarse como premium.
- Supabase no se enteraría de la compra, así que no subiría los créditos ni las metas activas.
- Las renovaciones, cancelaciones y reembolsos no llegarían si la app está cerrada.

La verificación con Supabase y la Google Play Developer API evita las tres cosas.
