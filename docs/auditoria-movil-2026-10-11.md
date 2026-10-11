# Revisión crítica móvil — 11 de octubre de 2026

Se añadieron 19 tests y se amplió uno existente, sin modificar código de producción. Los tests conservan las expectativas correctas: la suite queda roja por defectos reproducidos. No se descartaron los cambios previos del usuario en Android, permisos generados, `.claude/` ni la presentación. No se usaron cuentas reales, compras, anuncios, GPU ni servicios de producción.

## Alcance y contratos

Stack: JavaScript ES modules, Vite, Supabase JS, PostgreSQL/Edge Functions Deno y Tauri 2 con Rust/Kotlin. Android tiene plugins propios de Google Play Billing, AdMob/UMP e In-App Updates. No hay proyecto iOS generado ni pruebas nativas de iOS en este repositorio. Las pruebas disponibles son Node, PGlite con migraciones reales, Deno y Playwright; también existen scripts de humo Android y verificadores de servicios reales, estos últimos no ejecutados.

Se leyeron README, guía de continuidad, arquitectura, auditoría anterior, Android y monetización. No se encontró `AGENTS.md` aplicable en el repositorio ni sus antecesores. La revisión abarcó autenticación, creación/ajuste/aprobación de metas, calendario, hábitos, cola de planes, chat, créditos, anuncios, compras, actualización y sus consumidores. Las suites existentes cubren también acciones, XP, importación, preferencias y animación de Lumi. Los commits recientes revisados incluyen recuperación de WebView, esqueleto de arranque, compatibilidad/emuladores y actualización en Play (`6ac539d`, versión 2.3.3); `850d04d` modifica la política de lint del AAB.

Las expectativas proceden de los contratos del README y los documentos del proyecto: aislamiento de cuentas; devolución de mensajes sin respuesta; borrado de conversación; capacidad diaria/semanal; créditos por mes pagado; continuidad al regresar; anuncios según sesión/beneficios; orden de acciones. Se contrastaron permisos con la [documentación de Supabase](https://supabase.com/docs/guides/api/securing-your-api) y actualizaciones con [Google Play](https://developer.android.com/guide/playcore/in-app-updates/kotlin-java#handle_an_immediate_update).

## Fallos confirmados, por gravedad

No se confirmó un P0/P1 ni una evasión de RLS. P2 requiere corrección funcional; P3 tiene menor impacto. Dentro de P2 se priorizan privacidad, créditos y pérdida de acciones del usuario.

| ID | Gravedad y ubicación | Reproducción mínima y evidencia | Impacto y límite de la conclusión |
|---|---|---|---|
| F1 | P2 — `src/main.js:1496`, consumidor `1075` | Abrir borrador privado con A; emitir `SIGNED_OUT` mediante SDK real: queda un diálogo abierto. Cambiar A→B sin cerrar el diálogo y pulsar «Crear sin IA»: se transmite el borrador de A autenticado como B. | Exposición de borrador tras invalidar sesión y mezcla de datos entre cuentas en la interfaz. SQL usa correctamente la cuenta actual; no es bypass de autorización del servidor. Dos tests independientes. |
| F2 | P2 — `supabase/migrations/202610070001_play_credits.sql:131`, `350` | Restauración tardía del primer mes; consumir 1.000 créditos; confirmar nueva orden pagada del segundo mes: saldo de plan **0**, esperado **1.000**. La ventana depende de cuándo se restauró, no del período pagado. | Se demora el beneficio comprado. Otro test muestra 1.000 nuevos créditos en gracia sin nueva orden: contradice «cada mes pagado», pero no prueba fraude. La solución debe conservar los beneficios durante gracia que exige [Google Play](https://developer.android.com/google/play/billing/lifecycle/subscriptions#grace-period). |
| F3 | P2 — `supabase/migrations/202610090001_lumi_chat.sql:103` | Cobrar mensaje; simular interrupción de Edge dejando pendiente antiguo; intentar otro envío con cuota diaria agotada. El rechazo revierte la reconciliación: saldo **55**, esperado **60**. | Retención del cobro de una respuesta inexistente. Reproduce el problema transaccional de recuperación; no depende de caída de red real. |
| F4 | P2 — `supabase/migrations/202610090001_lumi_chat.sql:137`, `163` | Enviar en un dispositivo; borrar desde otro; entregar la respuesta pendiente después. Reaparecen **2 mensajes**, esperado **0**. | El borrado no coordina respuestas tardías del mismo usuario. Pendiente ya documentado en la auditoría anterior, ahora reproducido con SQL real. |
| F5 | P2 — `src/main.js:973`, estado calculado en `648` | Mostrar hábito completado el 11/10; avanzar reloj al 12/10 en Santiago y volver visible; pulsar botón. Envía fecha nueva con `completed:false` calculado ayer. | El primer toque de hoy no crea cumplimiento ni recompensa. La vista principal no refresca este estado al volver. |
| F6 | P2 — `supabase/migrations/202610030002_plans_import.sql:35` | Perfil con 10 min/día; aprobar ajuste de meta pausada con dos acciones de 10 min ese mismo día. RPC acepta; la misma propuesta activa y el validador compartido la rechazan. | El servidor omite capacidad acumulada de la propia propuesta pausada. El frontend actual bloquea este ejemplo; un consumidor directo del RPC alcanza el defecto. No implica acceso a datos ajenos. |
| F7 | P2 — `supabase/functions/_shared/plan.js:218`, consumidor `_shared/generate-plan.ts:249` | Preparación de 30 min en día 27; no queda tiempo posterior, sí en día 0; evaluación posterior de 30 min. `fitSchedule` devuelve offsets **[27,0]**, y `validateProposal` acepta. | Propone una evaluación antes de su preparación, incumpliendo el orden ya exigido por el test existente. Se amplió ese test, sin duplicarlo. |
| F8 | P2 — `src/ai-jobs.js:58`, `133` | Iniciar lectura que captura `queued`; confirmar cancelación por RPC; entregar la lectura vieja. Se publica **queued → cancelled → queued**. | Una respuesta fuera de orden revive visualmente un trabajo terminal. No revierte la cancelación en servidor ni demuestra regeneración/cobro duplicado. |
| F9 | P2 — `src/main.js:229`, `251` | Ofrecer actualización opcional; iniciar; SDK queda pendiente y pasa a `in_progress`; regresar dentro de seis horas. Hay **1** consulta total, esperadas **2**. | El frontend no consulta ni solicita retomar la instalación interrumpida. El control de reanudación al arrancar pasa. Integración JS real; no instalación nativa. |
| F10 | P2 — `src/native-ads.js:105` | Tener anuncio cargado; iniciar `aiVideo`; cerrar sesión o activar Quitar anuncios antes de resolver el `await`. Se solicita `show_interstitial` pese al estado cambiado. | La coordinación JS ignora elegibilidad reciente. Dos tests; no se afirma haber visualizado un anuncio nativo. |
| F11 | P2 — `src/style.css:91`, `485` | Crear meta válida con 160 caracteres sin espacios en pantalla de 320 px. Documento de **2307 px**; viewport de diseño se infla a 1280 px. | Desbordamiento horizontal y controles desplazados. Captura revisada visualmente: [evidencia](../artifacts/mobile-audit-2026-10-11/mobile-long-title-320.png). Una pantalla normal de 320 px pasa. |
| F12 | P3 — `src/native-billing.js:76`, `107` | Evento de compra inicia verificación; después llega respuesta de `purchase` con el mismo token. Se invoca verificación **2** veces, esperada **1**. | Peticiones redundantes y coordinación de compra inconsistente con el contrato del módulo. No demuestra créditos ni cargos duplicados; el servidor mantiene su idempotencia. |

## Tests y resultados ejecutados

Todos los fallos nuevos terminaron en aserciones de comportamiento, no en errores de importación, servicios o preparación. Se controlan respuestas mediante promesas/barreras, fechas con reloj de Playwright y períodos con datos SQL. No se simula el módulo investigado: se ejecutan las funciones reales, el frontend y SDK Supabase reales, o las migraciones completas. Se sustituyen únicamente límites externos (HTTP, Google Play/Tauri/AdMob). PGlite no reproduce transacciones paralelas de PostgreSQL ni el despliegue remoto.

| Archivo cambiado/añadido | Nivel y defecto comprobado | Última ejecución |
|---|---|---|
| `tests/ai-jobs.test.js` | Integración del monitor; test nuevo F8 | 2 pasan / 1 falla |
| `tests/domain.test.js` | Unidad real de programación/validación; test de orden ampliado F7 | 5 pasan / 1 falla |
| `tests/mobile-server-regressions.test.js` | SQL real; F2 (dos casos), F3, F4, F6; controles de aislamiento y rollback activo | 2 pasan / 5 fallan |
| `tests/mobile-native-regressions.test.js` | Coordinación JS con límites SDK; F10 (dos casos), F12; control sesión ya cerrada | 1 pasa / 3 fallan |
| `tests/mobile-session-ui.mjs` | Integración navegador de app/SDK reales; F1 (dos casos), F5, F11; control 320 px/cuenta | 1 pasa / 4 fallan |
| `tests/mobile-update-ui.mjs` | Integración navegador de app real; F9 y control de arranque interrumpido | 1 pasa / 1 falla |

Base antes de editar: `npm test` **129/129**, `test:edge` **50/50**. Las cinco suites existentes (`test:ui`, `test:billing-ui`, `test:companion-ui`, `test:chat-ui`, `test:update-ui`) pasaron. `check:edge` pasó para las ocho entradas. `build` terminó correctamente, con avisos de Vite sobre los scripts clásicos de arranque.

Resultado final: `npm test` **141 tests, 131 pasan y 10 fallan**. El comando nuevo `npm run test:mobile-regressions` ejecuta **27 tests, 12 pasan y 15 fallan**; incluye siete tests de navegador que el comando habitual `npm test` no recoge. Ambos terminan con salida 1 deliberadamente. No hubo fallos previos de la suite detectados; los defectos de producto existían antes de añadir estas expectativas. Las 15 aserciones fallidas corresponden a los 12 grupos de hallazgos: algunos tienen dos reproducciones independientes.

```powershell
npm.cmd test
npm.cmd run test:mobile-regressions
npm.cmd run test:edge
npm.cmd run check:edge
```

Salidas de ejecución y captura conservadas en `artifacts/mobile-audit-2026-10-11/` (directorio excluido de Git). Las capturas no contienen cuentas reales. Se cambió `package.json` sólo para añadir el comando de testing; no se cambiaron dependencias ni lockfile.

## Hipótesis y verificación en dispositivo

`adb devices -l` no detectó dispositivos/emuladores. Ningún resultado aquí acredita E2E Android nativo, ARM, iOS, teclado real, TalkBack/VoiceOver, SDK reales, compras reales, recuperación del proceso o seguridad completa.

| Pendiente | Evidencia que falta y procedimiento concreto |
|---|---|
| Compra bloqueada tras recrear actividad | `BillingPlugin.kt` conserva `pendingPurchase` al destruirse. Con cuenta de licencia y pista de prueba Play: abrir compra, habilitar «No conservar actividades», pasar a Inicio y volver, cancelar, comprar nuevamente. Debe liberar el pendiente y permitir nueva compra sin «Ya hay una compra en curso». Falta ejecutar el SDK y ciclo de vida reales. |
| Segunda caída de WebView en menos de cinco segundos | `scripts/android-webview-client.kt` filtra otra muerte reciente como duplicada. En emulador de pruebas, provocar `Page.crash`, esperar primera recuperación y repetir antes de cinco segundos. Debe recuperar o cerrar de forma controlada, nunca dejar actividad vacía. Falta reproducción del renderer real. |
| Créditos/renovación reales | En Play Billing Lab/pista de prueba: agotar mes, provocar renovación fallida/gracia, cerrar proceso y restaurar; completar pago y verificar beneficio del período nuevo. Repetir restauraciones sin duplicarlo. Capturar órdenes/estado sin tokens ni datos sensibles. No se ejecutaron RTDN o compras reales. |
| Actualización interrumpida real | Instalar versión 2.3.3+ desde Play con una mayor disponible; iniciar «Actualizar ahora», pasar a Inicio/interrumpir conexión y regresar antes de seis horas. Verificar recuperación del flujo `in_progress` y reinicio sólo tras instalación. Repetir cancelación voluntaria y arranque en frío. |
| Offline e interrupción persistente | En dispositivo con cuenta de prueba: cortar red durante envío y aprobación de plan, volver, reintentar y cerrar proceso. Debe conservar formulario/trabajo y guardar/cobrar una sola vez. Repetir chat interrumpido y comprobar devolución. Los tests de fixtures controlan coordinación, no persistencia nativa ni una red real. |
| Teclado, áreas seguras y accesibilidad | Android: pantalla 320 px, fuente máxima, teclado abierto en meta/chat, barras de gestos, rotación; recorrer controles con TalkBack y permisos denegados. Comprobar guardar/enviar/cerrar visibles y enfocados. Repetir F5 dejando app en segundo plano a medianoche. No se ejecutó esta matriz. |
| Límite de invitaciones y respuestas Play simultáneas | Dos invitados concurrentes pueden leer el límite antes del bloqueo; respuestas Play viejas podrían sobrescribir estado nuevo. Faltan reproducción con conexiones PostgreSQL independientes y orden de consultas Google controlado. No son vulnerabilidades confirmadas. |
| Sesiones revocadas, enlaces y despliegue | Faltan pruebas de revocación/caducidad reales, recuperación vencida y navegación con enlaces externos en WebView. Probar en entorno de pruebas: cerrar sesión desde otro dispositivo, revocar token, abrir enlace de recuperación vencido y URL no autorizada. Revisar que se solicite autenticación y no permanezcan datos privados. No se modificaron políticas remotas. |

Para iOS, primero hace falta un proyecto Tauri/iOS, un host macOS y una instalación de pruebas. Después deben repetirse arranque/restauración, segundo plano, red interrumpida, navegación, teclado/áreas seguras y VoiceOver. Los plugins Android de pagos/anuncios/actualización no acreditan implementaciones equivalentes de iOS. No se puede afirmar cobertura nativa iOS con este repositorio y entorno.

## Correcciones (versión 2.3.4)

Los 12 hallazgos quedaron corregidos en la rama `release/2.3.4`, un commit por hallazgo; las 27 pruebas de `npm run test:mobile-regressions` pasan.

| ID | Corrección |
| --- | --- |
| F1 | Al terminar la sesión o cambiar de cuenta se cierra cualquier diálogo abierto (`src/main.js`). |
| F2 | Con plan sólo de Google Play, cada orden pagada nueva (`latestSuccessfulOrderId`) abre el mes de créditos; la gracia conserva el acceso sin entregar créditos (`202610110001_play_credit_orders.sql`). La prueba de créditos mensuales ahora renueva con una orden pagada. |
| F3 | Los mensajes a Lumi sin respuesta también se devuelven al leer el saldo, así que un envío rechazado ya no revierte la devolución (`202610110002_lumi_chat_recovery.sql`). |
| F4 | "Borrar conversación" cancela y devuelve los mensajes que esperan respuesta; `lumi-chat` avisa si la respuesta llega después. |
| F5 | El estado del hábito se calcula al tocar y la vista se redibuja al volver otro día. |
| F6 | `apply_goal_plan` cuenta las acciones de la meta que se planifica aunque esté pausada (`202610110003_paused_goal_capacity.sql`). |
| F7 | `fitSchedule` busca hacia atrás sólo hasta la acción anterior. |
| F8 | El monitor de IA no revierte un estado final con una lectura atrasada. |
| F9 | Iniciar la actualización marca una pendiente; al volver se consulta y se retoma. |
| F10 | `aiVideo` y `rewarded` revisan la elegibilidad justo antes de pedir el anuncio. |
| F11 | Tarjetas, paneles y diálogos cortan palabras largas (`overflow-wrap: anywhere`). |
| F12 | Una verificación de compra en curso se comparte entre la respuesta y el evento. |

Para que lleguen a producción: aplicar las tres migraciones `202610110001`–`202610110003` en Supabase, desplegar las funciones `lumi-chat` y `goal-plan` (usa `_shared/plan.js`) y publicar la app 2.3.4. Las verificaciones en dispositivo de la sección anterior siguen pendientes.
