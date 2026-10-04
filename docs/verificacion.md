# Verificación y activación

## Web con contratación desde Google Play — 4 de octubre de 2026

- Aviso permanente en Planes y Mi suscripción. Plus y Pro llevan al aviso, sin crear cotizaciones, pagos ni inscripciones de tarjetas. La interfaz indica que la app está en preparación y no inventa un enlace de tienda.
- Precios de referencia y beneficios del catálogo conservados; la campaña anterior de Transbank no se presenta como una oferta de Play. Los enlaces guardados de contratación tampoco abren pagos.
- Conservadas la entrada al plan Gratis, consulta de plan y consumo, historial y verificación de órdenes anteriores. Se permite cancelar una autorización anterior, sin reanudarla ni cambiar su tarjeta.
- `npm.cmd test`: 51 pruebas correctas; compilación correcta. Las pruebas de interfaz cubren capacidades de servidor en integración, producción y deshabilitadas, autenticación, retornos antiguos, errores, desmontaje y ausencia de llamadas de compra. Las capturas de escritorio y móvil se guardan fuera de Git en `dist/qa/google-play-*.png`.
- Este cambio sólo actualiza la web y su documentación: Google Play Billing y la sincronización con Supabase todavía no están implementados. Las funciones y registros del backend anterior permanecen disponibles.

## Oferta de bienvenida — 4 de octubre de 2026

- Campaña de siete días exactos, con cierre fijo del servidor; la cuenta atrás no se reinicia al recargar ni al modificar la hora del dispositivo. Banner, descuentos, precios regulares y ahorros revisados en escritorio y móvil.
- `npm.cmd test`: 51 pruebas correctas. Seis escenarios nuevos de campaña cubren permisos, fechas, primer pago a precio regular, reservas antes del cierre, Oneclick congelado, duplicados y conservación de la elegibilidad tras rechazo. La integración con handlers reales y PostgreSQL prueba catálogo anónimo y rechazos de cotizaciones caducadas antes de llamar a Transbank.
- `npm.cmd run test:edge`: 29 pruebas correctas; comprobación de tipos y compilación correctas. Contratar exige el importe revisado; valores ausentes o malformados se rechazan antes de reservar o inscribir.
- `test:billing-ui` correcto: 64%/60% y ahorro calculados desde precios editables, oferta usada/futura/cerrada, reloj incorrecto del dispositivo, cierre con el resumen abierto sin borrar el consentimiento y rechazo del importe anterior sin abrir el proveedor. Nueve capturas en escritorio y móvil, sin errores JavaScript ni desbordamiento.
- Migración `202610040003_welcome_campaign.sql` aplicada y función `billing` actualizada en Supabase. Catálogo real 200 con origen autorizado y campaña del 4 de octubre de 2026 a las 21:39 UTC al 11 de octubre a las 21:39 UTC (18:39 de Chile). Contratación sin sesión rechazada con 401. La sesión local recuperó la campaña y los precios desde la nube.
- El ambiente permanece en integración. Las pruebas de pagos usan fixtures y no realizan cargos reales. Configuración editable y límites descritos en [suscripciones y Transbank](billing.md).

## Suscripciones Transbank — 4 de octubre de 2026

- Implementación en `codex/suscripciones-transbank`, exclusivamente en `PlanifIA_Seller`. Catálogo editable: Gratis $0; Plus $990 inicial/$2.750 regular; Pro $1.990 inicial/$4.990 regular. Cuotas de metas y consumo de IA validadas en servidor.
- `npm.cmd test`: 45 pruebas correctas. Incluyen 10 escenarios SQL de pagos y una integración que conecta las Edge Functions reales con las migraciones en PostgreSQL embebido; Transbank y Auth son sintéticos en esos escenarios.
- `npm.cmd run test:edge`: 28 pruebas correctas; `check:edge` y compilación estática correctos. Se comprueban sesión, CORS, importe/orden, consentimiento, inscripciones sin activación, estados inciertos, reintentos y preservación de datos.
- `test:ui` de la aplicación existente pasó. `test:billing-ui` pasó en escritorio y móvil, con formularios de Transbank interceptados: precio promocional y regular, consentimiento no premarcado, pagos manuales, cancelación, cambio de plan, cinco resultados, caducidad y limpieza. El montaje real también comprueba elección antes de login y retorno después de perder sesión. Capturas en `supabase/.temp/billing-qa/`, fuera de Git.
- La API real de integración de Transbank respondió a creación y consulta de órdenes por $990 y $1.990, con estado `INITIALIZED` y validación TLS normal. No se enviaron tarjetas, no se confirmó ningún pago y no se realizaron cobros. Los pagos aprobados/rechazados y renovaciones se verifican con respuestas sintéticas; queda pendiente la certificación del comercio.
- Las migraciones de pagos son `202610040001_billing.sql` y `202610040002_closed_renewals.sql`. La segunda cancela futuras renovaciones del ciclo al agotar rechazos confirmados o cancelar una orden antes de iniciar su cargo, habilitando la renovación manual y conservando el acceso ya pagado.
- Ambas migraciones aplicadas en Supabase `hlnzxgpdxgadbdcqavcd`; `billing`, `billing-return`, `billing-renew` y `goal-plan` desplegadas. El ambiente está fijado en integración, con Webpay y Oneclick de prueba. Vault guarda el secreto y el cron está activo cada 15 minutos, independiente de los servicios del PC.
- Verificación HTTPS contra las funciones desplegadas: catálogo 200 con precios exactos y CORS; gestión sin sesión 401; cron sin secreto 401 y autorizado 200 sin órdenes que procesar; retorno `approved=true` redirige a verificación pendiente sin activar nada. Roles del navegador sin permiso para ejecutar el RPC financiero. La sesión existente consultó Gratis y su consumo mensual real desde la nueva vista sin crear pagos.
- Producción requiere contrato/códigos y claves Transbank por producto, habilitación Oneclick si se desea, certificación y cambio explícito de ambiente. Instrucciones en [suscripciones y Transbank](billing.md).

## Dominio principal — 4 de octubre de 2026

- GitHub Pages asigna `planifia.cl` a `PlanifIA_Seller`, con certificado aprobado y HTTPS obligatorio. El repositorio anterior ya no tiene ese dominio. El DNS existente de Cloudflare apuntaba correctamente a GitHub y no necesitó cambios.
- `https://planifia.cl/` sirve la nueva interfaz y sus assets desde `/assets/`; `www.planifia.cl`, HTTP y la URL anterior de Seller redirigen al dominio principal. Despliegue `bbca677` y pruebas de CI correctos.
- Site URL y retornos de Auth aplicados a Supabase, conservando localhost y la URL anterior. Los orígenes principal y `www` de `goal-plan` responden OPTIONS 204; una solicitud sin sesión devuelve 401 con CORS correcto.
- Login real, recuperación de sesión y datos tras recargar, y logout persistente comprobados en escritorio de 1440 × 1050 y móvil de 390 × 844. La cuenta y su perfil temporales se eliminaron; no se enviaron correos ni se generó un plan de IA en esta comprobación.
- Landing, formulario de acceso y recuperación revisados sin errores JavaScript, overflow ni solicitudes a la API anterior. Capturas privadas de validación en `supabase/.temp/domain-qa/`, fuera de Git.

## Comprobación real de esta instalación — 3 de octubre de 2026

- Proyecto Supabase `hlnzxgpdxgadbdcqavcd` inicialmente vacío: tres migraciones aplicadas, con historial de migraciones, URLs de Auth configuradas y confirmación de correo habilitada.
- Función `goal-plan` desplegada y conectada mediante HTTPS al adaptador autenticado de Ollama. Sin Bearer, el adaptador devuelve 401; no expone las rutas de administración de modelos.
- `PLANIFIA_RUN_LIVE=1 npm run test:live` pasó contra Supabase y Ollama reales: login/logout, dos usuarios aislados por RLS, rechazo de escritura directa de XP, ganancia/revocación/reintento, hábitos, propuesta sin guardado automático y aprobación que conserva completadas y retira pendientes.
- Generación de la propuesta de validación: 79 segundos. El modelo de 27B se cargó en GPU según `/api/ps` (12,22 GB reportados para el modelo cargado); este dato no representa todo el consumo del escritorio.
- Interfaz real comprobada en escritorio y móvil, recuperando los mismos datos desde dos contextos de navegador. Capturas en `dist/qa-live/`; sus cuentas temporales se eliminaron al terminar.
- Publicación en GitHub Pages verificada por HTTPS, con archivos y configuración de Supabase correctos. CI y despliegue del commit `a864ccc` terminaron correctamente. Una segunda prueba real sobre la URL publicada pasó también, incluyendo login/logout en escritorio y móvil y una propuesta generada en 108 segundos.
- Pruebas locales: 13 tests de Node, 8 de Edge Functions y comprobación de tipos correctos.
- El envío de confirmaciones y recuperación de contraseña no queda validado por esta prueba: usa cuentas temporales confirmadas por la API administrativa. Falta configurar/verificar SMTP para personas ajenas al equipo de Supabase.

## Pruebas automatizadas locales

### Lumi animada por defecto — 4 de octubre de 2026

- El modo inicial es Animadas incluso si el dispositivo reduce movimiento. No se muestran preguntas ni selectores en Hoy o durante la espera de IA; los modos opcionales permanecen únicamente en Ajustes y se conservan si el usuario los eligió.
- `npm test`: 33 pruebas correctas, incluidos el nuevo valor inicial, almacenamiento ausente o dañado y preferencias explícitas guardadas. El resto de la interfaz conserva la reducción de movimiento del dispositivo.
- `npm run test:ui`: correcto en escritorio y móvil. Se comprobó el primer inicio animado con reducir movimiento, autonomía sin clic, ausencia de selectores en Hoy y carga, y persistencia de los modos opcionales de Ajustes. Las celebraciones, límites y cinco evoluciones siguen pasando.
- En el navegador local se comprobó Lumi con respiración y desplazamiento autónomo, sin selector en Hoy y con reducir movimiento del dispositivo activado. Captura en `dist/qa/lumi-animada-por-defecto.jpg`, fuera de Git.

### Preferencia de animaciones de Lumi — 4 de octubre de 2026

- `npm test`: 33 pruebas correctas; siete nuevas comprueban los tres modos, persistencia, cambios del sistema, sincronización entre pestañas, almacenamiento bloqueado y limpieza.
- `npm run test:ui`: correcto en escritorio y móvil. Con reducir movimiento activado, Según dispositivo mantiene a Lumi tranquila y Animadas recupera respiración, parpadeo y acciones espontáneas. Recargar conserva la elección; Tranquilas detiene las animaciones incluso sin reducir movimiento. El selector de Ajustes y el de espera de IA se sincronizan sin reemplazar formularios.
- El resto de la pantalla de IA mantiene su movimiento reducido al elegir Animadas. Se conservan las 35 combinaciones de límites, ausencia de reacción al clic/cursor y celebraciones por XP, nivel y evolución.
- En el navegador local del usuario se activó Animadas con su autorización. Se comprobó que el dispositivo seguía indicando reducir movimiento, mientras Lumi respiraba y se desplazaba automáticamente. Captura de evidencia en `dist/qa/lumi-animadas-usuario.jpg`, fuera de Git.

### Lumi autónoma — 3 de octubre de 2026

- `npm test`: 26 pruebas correctas, incluidas 13 del controlador de Lumi y las regresiones de XP y evolución en SQL.
- `npm run test:ui`: correcto en Edge con vistas de escritorio y móvil de 390 × 844. Comprueba autonomía, ausencia de reacción al clic/cursor, continuidad, celebraciones, pausa de pestaña, limpieza y movimiento reducido.
- Los límites se comprueban en 35 combinaciones: cinco etapas por siete acciones, incluida la celebración, con respiración máxima y posición lateral límite. Las volteretas se pliegan antes de girar; la etapa final usa saltos y giros más suaves para conservar el margen de su corona.
- Capturas revisadas en `dist/qa/`, incluyendo `lumi-autonomous-mobile.png` y la pantalla de carga. Las pruebas de esta mejora utilizan respuestas simuladas de Auth, datos e IA; no generan planes reales ni modifican cuentas del servicio.

`npm test`: ejecuta las migraciones completas en un PostgreSQL embebido de prueba. Las cuentas sintéticas A y B verifican privacidad y relaciones. Incluye estados de tareas, recompensas, reintentos antiguos, hábitos, propuestas e importación. La prueba de 20 niveles usa la curva de presentación, y la prueba SQL verifica la evolución final desde el saldo.

`npm run test:ui`: las respuestas de Supabase Auth y del proveedor son fixtures de prueba, no conexiones externas. Verifica registro con confirmación, login/logout, revisión antes de guardar, edición de acciones, ajuste de pendientes, confirmación de meta lograda, hábitos, importación, error de guardado, recuperación desde un contexto de navegador distinto y móvil con movimiento reducido. Las capturas se generan bajo `dist/qa/`, fuera de Git.

La prueba de interfaz también comprueba Lumi visible en la primera pantalla, movimientos autónomos sin interacción, clic y cursor sin reacción, continuidad de posición, límites del retrato y celebraciones por tarea, nivel y evolución. Comprueba la pausa al ocultar la pestaña y una presentación tranquila con movimiento reducido. Verifica la carga de IA con respuesta diferida, bloqueo de doble clic y envío simultáneo, recuperación del formulario tras error, reintento y cierre con respuesta tardía. Genera capturas de Lumi y de la carga en escritorio y móvil; estos escenarios utilizan fixtures y no envían solicitudes al modelo real.

`tests/pet-behavior.test.js` usa un reloj y animaciones controlados para verificar la elección variable de acciones, el descanso de las volteretas, los intervalos configurables, la continuidad de desplazamientos, la prioridad de celebraciones y la limpieza al desmontar. No depende de esperar minutos ni de una secuencia aleatoria concreta.

`deno check`: comprueba el código de la función. `npm run build`: produce los archivos estáticos con configuración pública y rechaza claves privadas VITE\_.

## Prueba real después de configurar Supabase

Usa dos cuentas de prueba que te pertenezcan, A y B. Conserva primero una exportación de tus datos anteriores.

- [ ] Registrar A, confirmar el correo, entrar y salir. Repetir recuperación de contraseña.
- [ ] Registrar B y comprobar que no ve metas, tareas, hábitos, mascotas, originales ni recompensas de A.
- [ ] Copiar un ID de una tarea de A e intentar leerlo/actualizarlo desde B: lista vacía o rechazo.
- [ ] Crear una meta con IA: comprobar proveedor y modelo reales, revisar la propuesta, editar una acción y guardar.
- [ ] Completar una tarea y reabrirla: el saldo vuelve al anterior. Repetir no produce XP acumulativa.
- [ ] Cambiar prioridad y fecha después de la primera recompensa: reabrir retira el importe original exacto.
- [ ] Reprogramar una acción y confirmar que su nueva fecha se recupera tras recargar.
- [ ] Pedir un ajuste, cambiar la meta desde otro dispositivo y confirmar la propuesta antigua: debe rechazarse por versión.
- [ ] Aprobar un ajuste válido: las completadas se conservan y las pendientes anteriores quedan retiradas.
- [ ] Confirmar meta alcanzada: el estado solo cambia tras confirmación del usuario.
- [ ] Registrar un hábito y deshacerlo: un registro por fecha y saldo coherente.
- [ ] Iniciar sesión desde otro dispositivo: recuperar metas, hábitos, acciones y XP.
- [ ] Importar un respaldo, volver a importarlo y verificar mismos IDs/fechas y ningún duplicado.
- [ ] Descargar el original desde Ajustes y compararlo con el archivo previo.
- [ ] Inspeccionar las tablas con RLS y permisos de roles; intentar escribir directamente en pets/xp_rewards: debe rechazarse.
- [ ] Confirmar que al agotar AI_DAILY_LIMIT la función devuelve 429 y sigue disponible la creación manual.
- [ ] Abrir `https://planifia.cl/` en móvil; comprobar teclado, diálogo, retorno de Auth, calendario y reducción de movimiento.
- [ ] Comprobar HTTPS del dominio principal y `www.planifia.cl`, carga de assets desde `/assets/` y redirección de la dirección anterior de GitHub Pages.
- [ ] Comprobar que Auth use `https://planifia.cl/` como Site URL y que `goal-plan` acepte los orígenes `https://planifia.cl` y `https://www.planifia.cl`.

La lista necesita el proyecto real y no debe marcarse completada a partir de respuestas simuladas. Las instrucciones exactas están en el README.
