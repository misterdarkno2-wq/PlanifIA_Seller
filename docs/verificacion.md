# Verificación y activación

## Comprobación real de esta instalación — 3 de octubre de 2026

- Proyecto Supabase `hlnzxgpdxgadbdcqavcd` inicialmente vacío: tres migraciones aplicadas, con historial de migraciones, URLs de Auth configuradas y confirmación de correo habilitada.
- Función `goal-plan` desplegada y conectada mediante HTTPS al adaptador autenticado de Ollama. Sin Bearer, el adaptador devuelve 401; no expone las rutas de administración de modelos.
- `PLANIFIA_RUN_LIVE=1 npm run test:live` pasó contra Supabase y Ollama reales: login/logout, dos usuarios aislados por RLS, rechazo de escritura directa de XP, ganancia/revocación/reintento, hábitos, propuesta sin guardado automático y aprobación que conserva completadas y retira pendientes.
- Generación de la propuesta de validación: 79 segundos. El modelo de 27B se cargó en GPU según `/api/ps` (12,22 GB reportados para el modelo cargado); este dato no representa todo el consumo del escritorio.
- Interfaz real comprobada en escritorio y móvil, recuperando los mismos datos desde dos contextos de navegador. Capturas en `dist/qa-live/`; sus cuentas temporales se eliminaron al terminar.
- El envío de confirmaciones y recuperación de contraseña no queda validado por esta prueba: usa cuentas temporales confirmadas por la API administrativa. Falta configurar/verificar SMTP para personas ajenas al equipo de Supabase.

## Pruebas automatizadas locales

`npm test`: ejecuta las migraciones completas en un PostgreSQL embebido de prueba. Las cuentas sintéticas A y B verifican privacidad y relaciones. Incluye estados de tareas, recompensas, reintentos antiguos, hábitos, propuestas e importación. La prueba de 20 niveles usa la curva de presentación, y la prueba SQL verifica la evolución final desde el saldo.

`npm run test:ui`: las respuestas de Supabase Auth y del proveedor son fixtures de prueba, no conexiones externas. Verifica registro con confirmación, login/logout, revisión antes de guardar, edición de acciones, ajuste de pendientes, confirmación de meta lograda, hábitos, importación, error de guardado, recuperación desde un contexto de navegador distinto y móvil con movimiento reducido. Las capturas se generan bajo `dist/qa/`, fuera de Git.

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
- [ ] Abrir GitHub Pages en móvil; comprobar teclado, diálogo, retorno de Auth, calendario y reducción de movimiento.

La lista necesita el proyecto real y no debe marcarse completada a partir de respuestas simuladas. Las instrucciones exactas están en el README.
