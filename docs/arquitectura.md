# Arquitectura y conservación

El repositorio destino solo tenía `LICENSE` en el commit `b1e3316`. El PlanifIA consultado usa FastAPI/PyMySQL, sesiones almacenadas en MySQL, frontend JavaScript, mascota SVG y un planificador Ollama. Se reutilizan la identidad y el arte original; el servidor anterior sigue siendo un origen de exportación, con una cuenta autenticada elegida por la persona.

La aplicación nueva se compila con Vite y `@supabase/supabase-js`. La persistencia principal está en PostgreSQL. El almacenamiento del navegador solo guarda la sesión de Supabase; nunca el saldo de XP o la única copia de las metas. Las vistas se recuperan al iniciar sesión o recargar. Una confirmación de escritura se muestra después de la respuesta del servidor. Si falla la carga siguiente, la vista indica que debe reintentarse.

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

RLS está activada en las diez tablas públicas. No se conceden INSERT, UPDATE ni DELETE al navegador: cada operación autorizada tiene una función con `SECURITY DEFINER`, `search_path` vacío y comprobación explícita de `auth.uid()`. Se revoca EXECUTE a `PUBLIC` y `anon`; solo se conceden los métodos concretos a `authenticated`. La función de cuota admite solo `service_role` y recibe el usuario validado por la Edge Function.

## Consistencia

Las operaciones que cambian datos bloquean la mascota del usuario antes de tocar otras filas, para mantener el mismo orden de bloqueo. No hay dependencias de XP en la interfaz. Los identificadores idempotentes se conservan en una solicitud que permite reintentar una confirmación. Las operaciones de estado y la aprobación/importación tienen un registro de comandos. Las recompensas únicas por tarea/cumplimiento aseguran que repetir el cambio con otro identificador no duplique XP.

Las tareas completadas de propuestas previas conservan sus hitos; los planes nuevos agregan hitos y retiran únicamente pendientes. La aprobación revisa la versión, fechas, relaciones y carga diaria/semanal en la base. Una validación fallida revierte toda la propuesta. El progreso visible se calcula desde tareas vigentes; el resultado de una meta se confirma aparte.

Para modificar XP, un administrador puede actualizar `private.game_rules` desde SQL Editor. Los importes de recompensas ya emitidas permanecen constantes. Cambiar la curva recalcula los niveles visibles desde el mismo total, sin alterar el saldo.

## Límites y decisiones

No se migran hashes de contraseñas ni sesiones de MySQL a Supabase Auth. Los planes académicos y la mascota anteriores se guardan íntegros en los originales importados y se pueden descargar; no se convierten silenciosamente en nuevos planes o XP. Los hábitos futuros no se pueden marcar como realizados. Las metas y tareas se archivan/retiran, conservando historial.

La aplicación no promete resultados garantizados. La IA ayuda a estructurar metas y puede equivocarse; las propuestas se revisan antes de confirmar. Las credenciales del proveedor y la clave administrativa viven en secretos de Edge Functions. Ningún componente está configurado con datos reales de Supabase en el repositorio.
