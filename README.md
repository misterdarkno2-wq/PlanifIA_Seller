# PlanifIA Seller

**Tus metas, un plan claro y un paso a la vez.** Planificador para metas personales, profesionales, aprendizaje, bienestar, creatividad y proyectos. La interfaz es estática y se publica en GitHub Pages; Supabase almacena las cuentas y datos, y una Edge Function llama al proveedor de IA.

## Repositorio y estado

Este proyecto corresponde exclusivamente a `misterdarkno2-wq/PlanifIA_Seller`. Se inició desde su rama `main`, cuyo contenido era la licencia. La implementación se desarrolla en `codex/metas-supabase`. Se reutilizan el logo, el símbolo y la ilustración original de Lumi de PlanifIA.

La configuración de Supabase está pendiente. Al ejecutar sin ella, la aplicación muestra los valores que faltan. El registro, la persistencia y la IA requieren un proyecto real, las migraciones y los secretos de la función. Los tests de interfaz usan respuestas de prueba identificadas como fixtures; no son una integración de IA real.

## Ejecutar en Windows

Necesitas Node.js 22.12 o posterior.

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
npm.cmd ci
Copy-Item .env.example .env.local
notepad .env.local
npm.cmd run dev
```

Abre la dirección que indica Vite, normalmente `http://127.0.0.1:5173`. Completa únicamente estas variables públicas en `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
```

Usa la clave **publishable** (`sb_publishable_…`) o la clave legacy **anon**. Una clave administrativa, `service_role`, `sb_secret_…` o una clave del proveedor de IA nunca debe llevar el prefijo `VITE_`. Reinicia Vite si cambias `.env.local`.

## Preparar Supabase

1. Crea un proyecto en Supabase y copia su URL y clave pública a `.env.local`.
2. En **Authentication → URL Configuration**, configura Site URL como `https://misterdarkno2-wq.github.io/PlanifIA_Seller/`. Añade esa URL exacta y `http://127.0.0.1:5173/` a Redirect URLs. Si usas un dominio propio, configura su URL exacta. Para recuperación de contraseña, autoriza también el retorno con `#reset` si tu configuración exige la URL completa.
3. Mantén la confirmación de correo habilitada y configura el envío de correo de producción según las indicaciones de Supabase. La interfaz indica cuándo falta confirmar una cuenta.
4. Ejecuta las migraciones y despliega la función:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref TU_PROJECT_REF
npx.cmd supabase db push
Copy-Item supabase\functions\.env.example supabase\functions\.env.local
notepad supabase\functions\.env.local
npx.cmd supabase secrets set --env-file supabase/functions/.env.local
npx.cmd supabase functions deploy goal-plan
```

Revisa `db push` antes de confirmar si utilizas un proyecto con tablas previas. Las migraciones crean tablas nuevas de esta aplicación y no importan ni borran la base MySQL del PlanifIA anterior. Se recomienda un proyecto de Supabase dedicado.

## IA en la nube

Completa en el archivo privado `supabase/functions/.env.local`:

```dotenv
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=CLAVE_DEL_PROVEEDOR
AI_MODEL=IDENTIFICADOR_DE_UN_MODELO_COMPATIBLE
AI_DAILY_LIMIT=8
ALLOWED_ORIGINS=https://misterdarkno2-wq.github.io,http://127.0.0.1:5173,http://localhost:5173
```

`AI_MODEL` debe admitir `response_format: json_schema` en su endpoint. La integración utiliza `/chat/completions`, JSON estructurado y validación adicional. Puedes usar otro proveedor con esa API y HTTPS. El consumo puede tener coste; el límite cuenta intentos, incluidos los que falla el proveedor, por usuario y día UTC. El límite se aplica de forma atómica en PostgreSQL.

Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` al entorno de funciones. La clave administrativa se usa únicamente para reservar la cuota del usuario cuya sesión se ha validado. Las lecturas del calendario usan su JWT y respetan RLS.

La función valida el JWT con `auth.getUser()` antes de consultar datos o llamar a la IA. `verify_jwt=false` en `config.toml` permite que esta comprobación soporte las claves actuales de Supabase; **no elimina la comprobación de sesión en el código**. Los orígenes permitidos deben ser orígenes completos, sin rutas. Si falta una credencial, la función devuelve exactamente qué secreto falta.

El Ollama que corre en `localhost` del PC no es accesible desde Supabase. Para reutilizarlo necesitarías una pasarela HTTPS autenticada que exponga una API compatible con JSON estructurado y gestione sus permisos. Este proyecto no publica automáticamente Ollama ni sus puertos.

## Publicar en GitHub Pages

1. En este repositorio, crea las variables de Actions `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, ambas públicas.
2. En **Settings → Pages → Source**, selecciona **GitHub Actions**.
3. Integra la rama de implementación en `main` cuando hayas revisado los cambios y configurado Supabase. El workflow publica únicamente `dist`.
4. Abre `https://misterdarkno2-wq.github.io/PlanifIA_Seller/`.

La navegación utiliza fragmentos (`#today`, `#goals`, etc.), por lo que recargar una vista funciona en alojamiento estático. Las rutas de assets son relativas a la base. Para dominio propio, cambia `VITE_BASE_PATH` del workflow a `/`, configura el dominio en Pages y actualiza los retornos de Auth y `ALLOWED_ORIGINS`. Este repositorio no cambia el dominio del PlanifIA anterior.

```powershell
npm.cmd run build
npm.cmd run preview
```

## Metas, planes y progreso

- Estructura: **meta → hitos → acciones**. Las acciones pueden ser independientes. Las metas se editan, pausan, retoman, alcanzan y archivan. Puedes crear hitos manuales y vincularles acciones.
- La barra cuenta acciones completadas sobre las acciones vigentes de la meta. Las retiradas no forman parte del porcentaje. Alcanzar el resultado requiere una confirmación del usuario.
- La IA entrega propuestas de hasta cuatro semanas, ocho hitos y cuarenta acciones, con una primera acción y límites de tiempo. Puedes editar títulos, fechas, prioridades y duraciones o retirar acciones antes de confirmar.
- Un ajuste aprobado conserva el historial y las acciones completadas; reemplaza las pendientes marcándolas como retiradas. La versión de la meta impide sobrescribir cambios realizados desde otro dispositivo mientras se revisaba la propuesta.
- Los hábitos registran un cumplimiento por fecha y hábito. Sus registros se pueden reabrir sin perder el historial.

## Lumi y seguridad de XP

Las reglas están centralizadas en `private.game_rules`: 10/20/35 XP por prioridad, 5 extra solo antes de una fecha límite real. Sin fecha o en el vencimiento/después: XP base. La curva empieza con 100 XP y suma 35 al coste de cada nivel siguiente. Hay 20 niveles y evoluciones en 1, 5, 10, 15 y 20.

`set_task_status` y `set_habit_completion` bloquean primero la mascota de la cuenta, cambian el estado y actualizan recompensas y eventos dentro de una transacción. Una recompensa conserva su primer importe aunque se cambien prioridad o fecha después. Reabrir resta ese importe exacto; completar nuevamente restaura la misma recompensa. El identificador de solicitud evita que un reintento antiguo vuelva a aplicar un cambio ya deshecho.

Todas las tablas públicas tienen RLS de lectura por `auth.uid()`. Las escrituras se realizan por funciones limitadas y no hay permisos de escritura directa para el navegador, incluida la XP. Las relaciones compuestas verifican que meta, hito, tarea y recompensa pertenezcan al mismo usuario. Consulta [seguridad y datos](docs/arquitectura.md).

## Importar datos anteriores

El PlanifIA anterior usa MySQL remoto a través de FastAPI; el navegador conserva la sesión, no una copia completa de tareas. No se modifica esa base ni se migran sus contraseñas. Crea y confirma primero tu cuenta nueva.

Con el servidor anterior encendido puedes exportar **tu cuenta**:

```powershell
py scripts/export_legacy.py --url https://api.planifia.cl --output exports/planifia-anterior.json
```

El script pide correo y contraseña sin escribirla en el archivo, conserva tareas, evaluaciones, disponibilidad, planes guardados y mascota. Usa solo la biblioteca estándar de Python. Verifica el archivo antes de continuar.

En la app nueva, abre **Ajustes → Seleccionar exportación**, revisa las actividades y confirma el correo de destino. La importación mantiene las actividades académicas como área de aprendizaje y conserva las fechas, estados y tiempos; también guarda el JSON original completo en una tabla privada por usuario. Una importación repetida identifica los registros por origen e ID y no los duplica. Las versiones distintas del original se conservan. Los datos históricos de planes y Lumi quedan en ese respaldo descargable; no se reinterpretan automáticamente ni se otorga XP retrospectiva desde datos manipulables del navegador.

La búsqueda de datos locales revisa únicamente `planifia-tareas`, `planifia-tasks` y `planifia-evaluaciones` del dominio actual. El navegador no permite leer el almacenamiento del dominio anterior; utiliza la exportación si está allí. Se conserva el archivo o almacenamiento de origen después de importar.

## Verificación

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:edge
npx.cmd --yes deno check --no-config --no-lock --node-modules-dir=none supabase/functions/goal-plan/index.ts
npm.cmd run build
```

Los tests de SQL ejecutan las migraciones en PostgreSQL embebido mediante PGlite: RLS entre dos usuarios, rechazo de escritura de XP, recompensas base/anticipadas/tardías, revocación, idempotencia, hábitos, conflictos de versión, rollback de planes e importación. Las tres pruebas de Edge Functions comprueban JWT ausente/vencido, origen, secretos y cuota, con Auth/proveedor sintéticos. Los tests de dominio cubren los veinte niveles y los límites del plan. Los tests de interfaz usan fixtures de Auth/IA y generan capturas de escritorio y móvil en `dist/qa`; requieren Microsoft Edge instalado.

Después de conectar un proyecto real, completa las comprobaciones en [la lista de aceptación](docs/verificacion.md). La conexión real a Supabase, correos, IA externa y dominio publicado requiere tus cuentas y no queda validada solo con los tests locales.
