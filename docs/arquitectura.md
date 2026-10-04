# Arquitectura y conservación

El repositorio destino solo tenía `LICENSE` en el commit `b1e3316`. El PlanifIA consultado usa FastAPI/PyMySQL, sesiones almacenadas en MySQL, frontend JavaScript, mascota SVG y un planificador Ollama. Se reutilizan la identidad y el arte original; el servidor anterior sigue siendo un origen de exportación, con una cuenta autenticada elegida por la persona.

La aplicación nueva se compila con Vite y `@supabase/supabase-js`. La persistencia principal está en PostgreSQL. El almacenamiento del navegador solo guarda la sesión de Supabase; nunca el saldo de XP o la única copia de las metas. Las vistas se recuperan al iniciar sesión o recargar. Una confirmación de escritura se muestra después de la respuesta del servidor. Si falla la carga siguiente, la vista indica que debe reintentarse.

## Servicios conectados

La interfaz se publica en `https://planifia.cl/` desde GitHub Pages de `PlanifIA_Seller`, con base de assets `/` y dominio declarado en `public/CNAME`. La dirección anterior `https://misterdarkno2-wq.github.io/PlanifIA_Seller/` queda como retorno autorizado de Auth para conservar enlaces existentes. La configuración de Supabase permite también `www.planifia.cl` y el desarrollo local, incluida la recuperación con `#reset`.

La instalación usa Supabase `hlnzxgpdxgadbdcqavcd` y la Edge Function `goal-plan`. Para la IA, un túnel independiente sirve `https://ia-seller.planifia.cl/v1`, con autenticación Bearer y un adaptador local en `127.0.0.1:8012`. El adaptador llama exclusivamente al Ollama local en `127.0.0.1:11434` con el modelo de 27B fijado en la configuración privada. No se publican las rutas de administración de Ollama.

El generador centraliza el presupuesto efectivo de cada semana y día; valida la respuesta y permite una corrección dentro del mismo límite total de tiempo. La propuesta queda sin guardar hasta su aprobación. Las cuentas y datos están en la nube; generar con esta instalación de Ollama necesita el PC y sus servicios activos.

## Tablas

| Tabla                | Relación / finalidad                   | Acceso del navegador                  |
| -------------------- | -------------------------------------- | ------------------------------------- |
| profiles             | Un perfil por auth.users               | Lectura propia; escritura RPC         |
| goals                | Meta, resultado y versión              | Lectura propia; escritura RPC         |
| milestones           | Hito de una meta y mismo usuario       | Lectura propia; plan RPC              |
| tasks                | Acción independiente o vinculada       | Lectura propia; escritura RPC         |
| habits               | Repetición y días elegidos             | Lectura propia; escritura RPC         |
| habit_completions    | Una fecha por hábito                   | Lectura propia; estado RPC            |
| pets                 | Saldo auditado por usuario             | Lectura propia; sin escritura cliente |
| xp_rewards           | Primer importe y estado actual         | Lectura propia; sin escritura cliente |
| xp_events            | Auditoría de cada movimiento           | Lectura propia; sin escritura cliente |
| imports              | Versiones de los originales            | Lectura propia; importación RPC       |
| private.commands     | Respuestas de solicitudes idempotentes | Sin acceso cliente                    |
| private.import_items | Origen/ID de cada importación          | Sin acceso cliente                    |
| private.ai_usage     | Cuota diaria                           | Solo RPC del servidor                 |
| private.game_rules   | Reglas de recompensas y niveles        | Administración SQL                    |
| plan_catalog         | Precios, beneficios y límites          | Lectura pública de planes habilitados |
| subscriptions        | Suscripción y próxima renovación       | Lectura propia; gestión RPC limitada  |
| subscription_periods | Períodos realmente pagados             | Lectura propia; escritura servidor    |
| payment_orders       | Plan, monto y resultado por orden      | Lectura propia; escritura servidor    |
| private.billing_accounts | Promoción y revocación por ambiente | Sin acceso cliente                    |
| private.billing_methods | Referencias Oneclick y últimos cuatro dígitos | Sin acceso cliente           |
| private.billing_enrollments | Inscripción y token del formulario | Sin acceso cliente                 |
| private.payment_provider | Token, reserva y resultado normalizado | Sin acceso cliente                 |
| private.payment_attempts | Referencias e historial de intentos | Sin acceso cliente                    |
| private.billing_consent_events | Auditoría de autorización y cancelación | Sin acceso cliente          |
| private.billing_settings | Ambiente y política de reintentos | Administración SQL                      |
| private.plan_ai_usage | Consumo de generaciones y ajustes por mes UTC | Solo servidor                  |

RLS está activada en las tablas públicas: los datos personales se leen por `auth.uid()` y el catálogo permite consultar planes habilitados. No se conceden INSERT, UPDATE ni DELETE al navegador: cada operación autorizada tiene una función con `SECURITY DEFINER`, `search_path` vacío y comprobación explícita de `auth.uid()`. Se revoca EXECUTE a `PUBLIC` y `anon`; solo se conceden los métodos concretos a `authenticated`. Las funciones administrativas de pagos y cuotas admiten solo `service_role` y reciben el usuario validado por la Edge Function.

## Pagos y límites

`src/billing.js` monta las vistas de planes y suscripción; `src/billing-cloud.js` llama a `billing` con la sesión existente. `billing` valida Auth y delega los importes y cambios de estado en `billing_admin`. `billing-return` correlaciona el token y valida la respuesta de Transbank antes de activar un período. `billing-renew` exige un secreto independiente y se ejecuta desde pg_cron cada 15 minutos con el secreto guardado en Vault. Ninguno depende de que la aplicación o el PC estén abiertos.

El bloqueo por usuario, una sola contratación abierta, la identidad única del ciclo de renovación y las referencias persistentes de cada intento evitan duplicados. Una respuesta incierta se consulta antes de repetir operaciones financieras. La confirmación guarda período, promoción, orden y suscripción en una transacción. Inscribir una tarjeta no confirma un pago. Integración y producción tienen registros separados y deben coincidir entre la base y las funciones.

La cuota mensual se reserva antes de llamar al proveedor de IA. Un trigger protege también la creación y reactivación de metas desde cualquier RPC. La vigencia y los límites se calculan a partir de períodos pagados, con descenso a Gratis al vencer, conservando metas, tareas, hábitos y XP. Configuración y despliegue: [suscripciones y Transbank](billing.md).

## Consistencia

Las operaciones que cambian datos bloquean la mascota del usuario antes de tocar otras filas, para mantener el mismo orden de bloqueo. No hay dependencias de XP en la interfaz. Los identificadores idempotentes se conservan en una solicitud que permite reintentar una confirmación. Las operaciones de estado y la aprobación/importación tienen un registro de comandos. Las recompensas únicas por tarea/cumplimiento aseguran que repetir el cambio con otro identificador no duplique XP.

Las tareas completadas de propuestas previas conservan sus hitos; los planes nuevos agregan hitos y retiran únicamente pendientes. La aprobación revisa la versión, fechas, relaciones y carga diaria/semanal en la base. Una validación fallida revierte toda la propuesta. El progreso visible se calcula desde tareas vigentes; el resultado de una meta se confirma aparte.

Para modificar XP, un administrador puede actualizar `private.game_rules` desde SQL Editor. Los importes de recompensas ya emitidas permanecen constantes. Cambiar la curva recalcula los niveles visibles desde el mismo total, sin alterar el saldo.

## Comportamiento de Lumi

`src/pet-art.js` conserva las cinco etapas SVG. El fondo y la sombra están separados del personaje; la jerarquía de grupos distingue posición, acción y respiración. Las partes del cuerpo tienen animaciones CSS para parpadeo, pasos, brazos y alas. Las volteretas afectan al personaje, sin girar la tarjeta ni el fondo.

`src/pet-behavior.js` crea un controlador por retrato. Elige acciones por pesos sin repetir la anterior, con pausas aleatorias de 8–20 segundos y un descanso mínimo de 60 segundos entre volteretas. Usa Web Animations para terminar una acción antes de iniciar otra y conserva la posición horizontal, limitada a ±18 unidades del SVG. Una reacción real tiene prioridad sobre el siguiente movimiento espontáneo; cuando llegan varias, conserva la de mayor importancia: evolución, nivel o tarea completada.

`src/main.js` monta y dispone los controladores al cambiar la vista, conservando posición, pose y la celebración de mayor prioridad al refrescar el panel. `src/plan-loading.js` administra el retrato de la pantalla de espera y lo dispone al cerrar o terminar la solicitud. Cada controlador escucha visibilidad y movimiento reducido, pausa cuando la pestaña queda oculta y elimina sus animaciones, temporizadores y listeners al disponerlo. No registra eventos de clic, tacto ni cursor. Este comportamiento visual no escribe ni calcula XP: los eventos proceden de las respuestas existentes del servidor.

## Límites y decisiones

No se migran hashes de contraseñas ni sesiones de MySQL a Supabase Auth. Los planes académicos y la mascota anteriores se guardan íntegros en los originales importados y se pueden descargar; no se convierten silenciosamente en nuevos planes o XP. Los hábitos futuros no se pueden marcar como realizados. Las metas y tareas se archivan/retiran, conservando historial.

La aplicación no promete resultados garantizados. La IA ayuda a estructurar metas y puede equivocarse; las propuestas se revisan antes de confirmar. Las credenciales del proveedor y la clave administrativa viven en secretos de Edge Functions. Ningún componente está configurado con datos reales de Supabase en el repositorio.
