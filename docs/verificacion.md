# Verificación y activación

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
