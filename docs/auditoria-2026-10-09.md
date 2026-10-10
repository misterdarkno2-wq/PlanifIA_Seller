# Revisión de ingeniería, IA, seguridad y experiencia

> Este documento conserva el diagnóstico y la verificación local inicial. En la continuación autorizada del 9 de octubre se publicaron `admob-ssv` v2, `goal-plan` v10 y `lumi-chat` v2, y se reinició el trabajador local con la corrección de reintentos. Los resultados posteriores de modelos y despliegue se documentan por separado; las menciones a «pendiente de desplegar» de abajo describen el estado inicial.

Fecha: 9 de octubre de 2026. Alcance: copia local de PlanifIA_Seller, sus migraciones, funciones, trabajador de IA, frontend y configuración Android disponible. No se modificó producción ni se ejecutaron compras, anuncios reales o pruebas contra cuentas reales. Se preservaron los cambios previos en Android y `.claude/`.

## Cómo funciona

La web es una SPA de JavaScript y Vite, publicada mediante GitHub Pages; Tauri reutiliza el frontend para Android. Supabase gestiona identidad, datos, créditos y operaciones protegidas. El navegador consulta datos con su sesión y RLS; las escrituras relevantes pasan por funciones SQL. Los pagos se verifican en servidor con Transbank/Google y las recompensas con AdMob. La interfaz actual dirige las nuevas suscripciones a Google Play, aunque sigue existiendo código para gestionar cobros anteriores.

Los planes siguen este recorrido: formulario → `goal-plan` valida la sesión y consulta calendario → `enqueue_ai_job` comprueba permisos, cuota y créditos → trabajador local obtiene una concesión → gateway local → Ollama → validación de propuesta → resultado persistido → revisión y aprobación humana. El chat sigue un flujo separado: `lumi-chat` → reserva de créditos/contexto → gateway de chat → guardar conversación o devolver créditos. La IA no recibe herramientas para ejecutar SQL, cobrar o modificar metas.

## Diagnóstico priorizado y ejecución

Esfuerzo orientativo: bajo, menos de un día; medio, uno a tres días. Son rangos de planificación, no tiempos medidos.

| ID / prioridad | Problema y evidencia | Solución / beneficio | Esfuerzo / riesgo | Validación / estado |
|---|---|---|---|---|
| S1 / alta | `admob-ssv/handler.ts`, `verifyAdmobCallback`: verificaba el prefijo firmado pero devolvía parámetros de toda la consulta. Una firma válida sin usuario aceptaba un usuario añadido después. | Procesar sólo parámetros firmados; rechazar duplicados y sufijos diferentes de firma + clave. Protege la asignación de créditos. | Bajo / medio por afectar recompensas. | Regresión falló antes y pasó después. Corregido localmente. |
| A1 / alta | `generate-plan.ts` agotaba dos propuestas inválidas con error 502; `ai-worker.js` reintentaba cualquier 502; cola con tres intentos por defecto. | Marcar fallos definitivos; mantener reintentos de red, 429 y fallos transitorios. Evita repetir una corrección ya agotada. | Bajo / bajo. | Prueba integrada generador/trabajador: dos llamadas y `p_retry=false`; 429/502/504 transitorios mantienen reintento. Corregido. |
| A2 / media | `goal-plan/handler.ts` consultaba tareas/hábitos/metas sin paginar. El límite REST puede dejar parte del calendario fuera. Además, enviaba filas completas a IA. | Lectura paginada ordenada con total explícito, selección de columnas y contexto sin identificadores técnicos. Conserva títulos, detalles, área, prioridades, fechas y finalización. | Medio / medio: cálculo de capacidad. | 1.201 filas con páginas de 400: conserva todas y suma 6.005 minutos. Calendario incompleto falla de forma explícita. Corregido. |
| S2 / media | `lumi-chat/handler.ts`, `lumiMessages`: nombre, nombre de mascota, títulos y acciones editables iban en un segundo mensaje `system`. | Datos serializados en mensaje `user`; reglas separadas y sin autoridad para acciones. Reduce una superficie de inyección. | Bajo / bajo. | Se conservan contenidos adversariales como datos y existe un único mensaje de sistema. Mitigado; comportamiento del modelo pendiente de evaluación. |
| S3 / media | `goal-plan` y `lumi-chat` comprobaban el tamaño después de `req.text()`. Sin encabezado fiable, ya habían leído el cuerpo completo. | Lectura incremental acotada y cancelación al exceder el límite. Mantiene los límites anteriores de caracteres. | Bajo / bajo. | UTF-8 partido y cuerpos grandes con encabezado ausente, falso y excesivo. Corregido en endpoints de IA. |
| S4 / media | El chat no exigía HTTPS al construir el endpoint configurado; un error administrativo podía enviar el secreto por HTTP. | Exigir HTTPS sin credenciales en la URL, sin seguir redirecciones. | Bajo / bajo; requiere URL segura configurada. | HTTP no produce llamada de IA y solicita devolución. Corregido. No se demostró una exposición real de claves. |
| Q1 / media | El servidor afirmaba devolución aunque fallara su RPC; la web afirmaba ausencia de descuento incluso al perder la respuesta de red. | Mostrar incertidumbre cuando no existe confirmación de devolución. | Bajo / bajo. | Error de devolución devuelve `refunded=false` y un mensaje preciso. Corregido. |
| Q2 / media | El chat permitía enviar/borrar mientras cargaba el historial o procesaba otro cambio. Un borrado podía competir con una respuesta pendiente. | Estados excluyentes de carga, envío y borrado; limpieza del texto accesible al borrar. | Medio / bajo. | Prueba de navegador con promesas demoradas: una operación cada vez. Corregido en la misma vista; concurrencia entre dispositivos pendiente. |
| U1 / media | `--muted: #677c77`: contraste 4,12:1 sobre `#f5f7f4`, insuficiente para texto normal. | Oscurecer a `#536b65`: 5,33:1 en ese fondo, conservando la paleta. | Bajo / bajo. | Cálculo de luminancia y revisión visual de capturas. Corregido para ese token, no certifica toda la interfaz. |
| U2 / baja | `hashchange` reconstruía la vista al usar anclas; el enlace para saltar contenido no gestionaba el foco. El pie de portada omitía las páginas legales ya existentes. | Conservar la vista en anclas, enfocar el contenido y enlazar privacidad, términos y eliminación. | Bajo / bajo. | Pruebas de foco, identidad del DOM y enlaces; capturas de escritorio/móvil. Corregido. |

### S1: alcance de la vulnerabilidad confirmada

La reproducción usa una clave ECDSA de prueba que representa al emisor confiable. Firma una consulta con transacción pero sin `user_id`; después añade `user_id` fuera de la firma. El verificador anterior devolvía ese usuario. El controlador utiliza ese valor para `admob_reward`.

Para explotar el servicio real se necesita una URL auténticamente firmada sin usuario, acceso a dicha URL, una transacción aún no acreditada y cumplir la comprobación de bloque de anuncios cuando esté configurada. No permite falsificar firmas ni demuestra fraude ocurrido. La idempotencia de transacciones y el límite diario siguen limitando las recompensas. La corrección elimina la aceptación de campos no firmados y ambigüedades de parámetros. Formato contrastado con la [documentación de AdMob](https://developers.google.com/admob/android/ssv).

### S2: límites de la mitigación

Se comprobó la elevación de texto editable a rol de sistema, no una filtración entre cuentas. El contexto procede de consultas restringidas al propietario; no incluye otras cuentas ni secretos de proveedor. El chat no tiene herramientas. Separar roles reduce el problema, pero hacen falta pruebas con el modelo real para valorar obediencia y resistencia a instrucciones maliciosas. Nunca se debe usar la respuesta del modelo como autorización.

## IA: inventario y presupuesto real del código

| Uso | Configuración local observada | Contexto y salida | Invocación / controles |
|---|---|---|---|
| Crear/ajustar planes | `OLLAMA_MODEL=qwen3.5:9b`; 8.192 de contexto; máximo 6.000 tokens de salida. | Instrucción de planificación + idea, situación, resultado, motivo, meta actual, acciones completadas y capacidad diaria/semanal de 28 días. JSON Schema aparte. El gateway admite hasta 24.000 caracteres de mensajes y 16.000 de esquema. | Botón explícito. Hasta dos generaciones por validación dentro de 125 s; gateway 120 s por defecto. Una plaza de planes por defecto. Cola con máximo tres intentos para fallos transitorios. |
| Hablar con Lumi | `OLLAMA_CHAT_MODEL=qwen3:4b-instruct`; 2.048 de contexto, máximo 220 tokens por valores predeterminados; residencia configurada de 30 minutos. | Reglas + nombre/etapa + hasta tres metas y próxima acción + últimos seis mensajes + texto nuevo de hasta 500 caracteres. Gateway: máximo 8.000 caracteres. Respuesta almacenada: hasta 600 caracteres. | Cada envío explícito; sin cola de planes. Dos plazas y timeout 30 s en gateway por defecto; 35 s en Edge. Sin reintento automático de generación. |
| Saludos, voz, animación, juegos, progreso, calendario y XP | Código local y reglas SQL. | No necesitan un modelo. | Se conservaron. |

Estos son valores del archivo local y valores predeterminados del código; no son una lectura del proceso Ollama ni de la configuración desplegada. `.env.gateway.example` propone otro modelo de planes, de 27B. No se puede usar ese ejemplo para afirmar qué modelo atiende producción.

El plan pide entre 6 y 20 acciones, aunque el validador admite hasta 40. Se conservan los límites de salida y el contexto conversacional: no se acortaron descripciones ni historial para aparentar ahorro. `fitSchedule` ya corrige fechas/capacidad con código, sin una nueva llamada; cambiarlo por IA sería un retroceso de eficiencia.

Las instrucciones sobre capacidad se repiten en el sistema, el payload y la corrección. Es redundancia comprobable, pero retirar esa parte requiere medir cumplimiento de restricciones: por ahora se mantiene. La corrección no reenvía la propuesta inválida completa, lo que ya evita contexto innecesario.

### Reutilización, contexto y modelos

- Ya existe idempotencia por usuario + `request_id`, comprobada con huella de los datos de entrada. Recuperar el mismo trabajo devuelve el resultado persistido y no vuelve a cobrar/generar. Esto no equivale a una caché semántica de cualquier petición parecida.
- No se añadió caché compartida entre personas: metas, disponibilidad y progreso son privados y cambian. Si se amplía la reutilización, la clave debe incorporar propietario, versión de meta, versión de disponibilidad/calendario, fecha de inicio, modelo, prompt y esquema. Invalidar ante cambios y no reutilizar resultados cuyo calendario ya no sea válido.
- La reducción implementada elimina IDs y datos técnicos de las filas, conservando el contenido útil y la fecha real de finalización. Las acciones completadas también se conservan al ajustar una meta pausada. No se filtran arbitrariamente acciones antiguas.
- Sigue pendiente una recuperación selectiva más ambiciosa para historiales muy extensos. No basta con cortar a las últimas N acciones: pueden reaparecer tareas ya realizadas. Propuesta: calendario como agregados SQL por fecha y registro de resultados completados; búsqueda por relevancia sólo para detalles, con detección de duplicados fuera del modelo. Requiere pruebas y una migración revisada.
- Mantener el modelo pequeño para conversación breve y el de mayor capacidad para planificación con restricciones. Escalar un caso de chat a planificación sólo tras intención explícita de crear/ajustar una meta y confirmación del costo. No escalar por un 429, desconexión o palabras sueltas del usuario.
- Un cambio a otro modelo debe superar el protocolo de `docs/evaluacion-ia.md`. Para fallos semánticos persistentes, proponer una revisión humana o un intento con modelo más capaz bajo un presupuesto explícito; no encadenar modelos automáticamente ni descargar otros modelos sin evaluar memoria, licencia y calidad.

### Ahorros: qué está medido y qué es estimación

**Medido con fixtures:** una propuesta inválida dos veces produce dos llamadas y se finaliza sin reintento de cola. Un resultado válido sigue requiriendo una llamada. Los tests de calendario y presupuesto siguen pasando. No son mediciones de tokens o calidad lingüística.

**Inferencia del código anterior:** con tres intentos de cola y dos propuestas JSON completas pero inválidas para las reglas del plan, rápidas, por intento, un fallo persistente podía hacer seis llamadas. Ahora ese caso termina con dos. Hasta cuatro llamadas evitadas en ese escenario; no aplica a todos los usuarios ni implica un porcentaje de ahorro global. La frecuencia real de esos fallos no está disponible.

**No medido:** consumo eléctrico, VRAM/RAM, tokens por petición real, p50/p95 de latencia, tasa de correcciones en producción, costo de Supabase, facturación o satisfacción de respuestas. Ollama local no tiene en este flujo una tarifa de API por token; los créditos del producto no son un costo del proveedor. Medir energía y tiempos antes de expresar CLP por respuesta. Los campos de uso que el gateway devuelve no se consolidan actualmente en una serie de métricas.

## Seguridad: controles comprobados y asuntos pendientes

Controles revisados en código y/o fixtures PostgreSQL:

- RLS por propietario en tablas de usuario; claves foráneas compuestas impiden asociar datos de otra cuenta. Tablas privadas y funciones administrativas revocadas a clientes. Tests de dos usuarios, rechazo de escrituras de XP, créditos e importación.
- `verify_jwt=false` en configuración de Edge no es por sí solo un fallo: los endpoints de usuario validan la sesión con `auth.getUser`; los callbacks tienen mecanismos propios. CORS no sustituye autenticación y sus encabezados se pueden imitar fuera del navegador.
- Las cuotas, prioridades, cobros, recompensas y aprobación de planes importantes se aplican en SQL/servidor. El cliente no elige su prioridad ni acredita una compra. El trabajador necesita una concesión y renueva su propiedad antes de seguir consumiendo GPU.
- Límite de cola por usuario y cuota diaria; chat con límites por minuto/día, cobro y devolución; gateway con concurrencia, modelos fijos, secreto y escucha sólo por loopback. Valores SQL predeterminados: un plan pendiente, ocho solicitudes de plan al día; seis mensajes/minuto y 200/día. Configuración remota no comprobada.
- El chat inserta texto con `textContent`; el frontend escapa los textos usados en sus plantillas. No se encontró un camino concreto de XSS en lo revisado. La ausencia de hallazgo no sustituye pruebas de penetración.
- Los archivos privados de entorno están excluidos de Git; `git ls-files '*env*'` sólo enumera ejemplos. La compilación rechaza claves administrativas/IA con prefijo público. No se imprimieron secretos ni se revisó exhaustivamente todo el historial Git.
- `npm audit --json`: cero vulnerabilidades conocidas reportadas para el árbol npm instalado. Esto no cubre Rust/Cargo, Gradle, binarios de Ollama, el sistema operativo ni vulnerabilidades desconocidas.

Pendientes concretos, sin presentarlos como incidentes:

| Prioridad | Evidencia / condición | Qué falta / propuesta | Validación |
|---|---|---|---|
| Alta operativa | Las correcciones están sólo en la copia local. | Publicar `admob-ssv`, `goal-plan` y `lumi-chat`; actualizar/reiniciar el trabajador y publicar frontend mediante el proceso habitual. No se cambió base de datos ni se necesita migración para estos cambios. | Smoke de callback firmado, chat y plan en entorno controlado; monitorizar errores sin registrar secretos. |
| Media | `ADMOB_REWARDED_AD_UNIT` es opcional en el controlador. Sin ese secreto no compara el bloque de anuncios. | Confirmar que producción tiene el bloque propio configurado; después convertir su ausencia en un error de configuración. No se puede inferir el secreto remoto desde el repositorio. | Callback válido de otro bloque no acredita. |
| Media | `lumi_chat_begin` devuelve pendientes antiguos sólo cuando el usuario vuelve a enviar. `lumi_chat_clear` no coordina solicitudes de otros dispositivos. | Reconciliación periódica de devoluciones y semántica de borrado concurrente, mediante migración que no duplique crédito. No se cambió el esquema sin verificar esos casos. | Reinicio de Edge, cuenta sin nuevos mensajes y borrado mientras responde otro dispositivo. |
| Media | El gateway tiene uso agregado en las respuestas; Edge/trabajador no lo guardan. | Métricas mínimas sin prompts ni PII: modelo, versión de prompt, intento, tokens, duración y resultado. Retención y costo de almacenamiento por definir. | Comparar con contadores Ollama y comprobar ausencia de datos personales en registros. |
| Media | `src/cloud.js:68` vuelve a cargar ocho conjuntos de datos; `src/main.js`, `saved`, llama a `refresh` tras guardar. | Medir tráfico en cuentas grandes; actualizar entidad afectada y resúmenes o separar consultas por vista. Esfuerzo medio, riesgo de estado obsoleto: conservar reconciliación completa. | Comparar bytes, consultas y latencia con varias pestañas y cuentas grandes. |
| Media | El trabajador consulta cada 3 s incluso en reposo; el cliente cada 3/20/30 s según actividad/visibilidad. | Medir carga antes de adoptar notificaciones o espera adaptativa. No aumentar espera sin revisar la experiencia y el umbral de trabajador conectado (30 s). | Techo teórico en reposo: 28.800 consultas/día por trabajador con RPC instantánea; no es tráfico real medido. |
| Media | Sesión SPA persistida; RPCs basadas en JWT/`auth.uid()`. No se verificó revocación remota ni caducidad efectiva. | Revisar expiración, cierre de sesiones, SMTP, redirecciones y recuperación en proyecto remoto. Para acciones especialmente sensibles, evaluar reautenticación según producto. | Sesión revocada, usuario eliminado, recuperación expirada y cierre desde otro dispositivo. |
| Media | Otros handlers de pagos todavía leen cuerpos completos antes de limitar o procesar. | Extender lector acotado con límites compatibles con callbacks de proveedores; límite de uso para verificaciones Play. Falta medir límites de la plataforma y abuso real. | Cuerpos grandes, compras repetidas y webhook legítimo. |
| Media | La configuración Tauri tiene CSP; no hay política equivalente declarada en `index.html`. | Revisar encabezados efectivos del alojamiento y ensayar CSP compatible con Supabase y pagos. No equivale a XSS confirmado. | Reporte de CSP y recorrido de autenticación/pagos antes de exigirla. |
| Media | Contexto de chat 2.048 tokens frente a un límite separado de 8.000 caracteres; planes combinan contexto 8.192 y salida máxima 6.000. | Medir tokenización efectiva de casos máximos y truncamiento. No asumir que caracteres equivalen a tokens ni recortar reglas/historial a ciegas. | Casos largos y multilingües del protocolo de IA; comprobar instrucciones al inicio. |
| Baja | Dependencias Edge fijadas a Supabase 2.58.0; npm usa rango con lockfile; Deno se invoca por `npx --yes` sin versión fija. | Unificar/pinar herramientas después de comprobar compatibilidad. Revisar Cargo/Gradle con sus analizadores y versiones reales. | Compilación reproducible y pruebas Android. |

La revisión de grants/RLS sigue el criterio de [seguridad de la API de Supabase](https://supabase.com/docs/guides/api/securing-your-api); paginación contrastada con [select/range](https://supabase.com/docs/reference/javascript/select). Se consultó el changelog vigente. No se verificó la versión PostgreSQL remota ni si le aplica la [actualización de septiembre de 2026](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## Calidad profesional y accesibilidad

La portada tiene una jerarquía clara (propuesta, acción principal, ejemplo y explicación), tipografía del sistema con fallback, paleta verde consistente y un personaje reconocible. No se justifica un rediseño completo. La revisión de capturas y los recorridos automatizados abarcaron escritorio y móvil, formularios, errores, propuesta editable, carga, cola persistente, chat y suscripción.

Se mejoró el contraste del token secundario sobre tres fondos: blanco 4,44 → 5,74; fondo principal 4,12 → 5,33; superficie clara 3,99 → 5,16. Son cálculos de colores CSS, no una certificación integral. El umbral para texto normal es 4,5:1 según [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Aspectos pendientes que requieren una decisión de producto o más evaluación:

- Navegación móvil con ocho destinos: en 390 px cabe sin desbordamiento en las pruebas, pero resulta densa. Propuesta concreta: cinco destinos principales y «Más» para secundarios. Requiere decidir qué rutas son prioritarias; no se cambió la navegación.
- `src/pet-motion.js:3` define animación por defecto incluso con reducción de movimiento del sistema. Está documentado y probado como decisión actual. Propuesta: respetar el sistema en instalaciones nuevas, preservando elecciones explícitas. Debe aprobarse por cambiar el comportamiento del producto.
- La tarjeta de Lumi ocupa gran parte de la primera pantalla de «Hoy». Medir si retrasa encontrar la próxima acción; ofrecer una vista compacta podría ayudar, pero no se redujo el protagonismo de la mascota sin decisión de producto.
- El chat muestra la última respuesta tanto en la burbuja como en el historial y anima su texto. Comprobar lectura con NVDA/TalkBack y evitar anuncios duplicados. La prueba de foco no sustituye un lector de pantalla real.
- El estado vacío, los controles de carga y errores principales existen. No se encontró un botón sin controlador en los recorridos probados. Pagos reales, SMTP y una instalación Android firmada no quedaron validados con fixtures.
- Evaluar a 320 px, zoom de 200–400 %, teclado virtual real, modo de alto contraste y texto ampliado. Las capturas de 390 px no prueban todos esos escenarios.

## Verificación y entrega

Base antes de cambios: 119 pruebas Node/SQL y 41 Edge aprobadas; interfaz base aprobada. Después: 121 Node/SQL, 50 Edge, comprobación de tipos de ocho entradas Edge, compilación Vite y cuatro suites de navegador (general, pagos, acompañante y chat). El test nuevo de chat se agregó a los workflows de comprobación y publicación. Se revisaron visualmente capturas generadas de portada, escritorio y móvil; el nuevo pie y el contraste se conservaron dentro de la identidad existente.

Bundle principal de la compilación revisada: 371,25 kB, 110,49 kB gzip. Es una medición del tamaño actual; no hay una medición comparable anterior para afirmar reducción del bundle. No se instalaron dependencias de producto ni servicios nuevos.

Los tests de base usan PGlite y los de navegador/Edge usan datos sintéticos. No prueban el despliegue remoto, respuestas lingüísticas reales, facturación, correos, rendimiento de GPU o seguridad completa. No se ejecutó `test:live`, que crea cuentas reales, ni se desplegaron estos cambios.

Próximo paso recomendado: revisar y publicar primero el arreglo de AdMob junto con sus pruebas; desplegar luego contexto/lectura acotada y actualizar trabajador/frontend. Antes de sustituir modelos, modificar el protagonismo de Lumi, cambiar navegación o contratar servicios, ejecutar el protocolo de evaluación y aprobar el cambio concreto.
