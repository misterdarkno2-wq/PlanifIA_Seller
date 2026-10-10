# Publicación y verificación posterior a la auditoría

Fecha local: 9 de octubre de 2026, Chile. Continuación autorizada de la auditoría inicial.

## Cambios publicados

- Commit `eb4ca91`: firma de recompensas, lectura acotada, paginación/contexto, control de reintentos, estados del chat, contraste y navegación. [Publicación web verificada](https://github.com/misterdarkno2-wq/PlanifIA_Seller/actions/runs/38014069745): finalizó correctamente, con pruebas Node/Edge, tipos, suites de navegador y compilación. [Prueba Android en emulador](https://github.com/misterdarkno2-wq/PlanifIA_Seller/actions/runs/38014069696): finalizó correctamente.
- Funciones Supabase comprobadas activas: `admob-ssv` versión 2, `goal-plan` versión 10, `lumi-chat` versión 3. La versión 3 del chat añade las aclaraciones evaluadas sobre contexto, cambio de intención y crisis.
- Trabajador/adaptador local actualizado y reiniciado con la corrección de reintentos. Se conservaron el túnel y la configuración privada. Sin migración de base de datos.
- Commit `3b9c8fd`: evaluación reproducible, verificación real y ensayo de instrucciones. El prompt experimental de planes de ese commit se revirtió tras la evaluación; no se activó en el trabajador. Consultar [decisión y evidencia](modelos-2026-10-09.md).

## Prueba contra el servicio publicado

`scripts/verify-release.mjs` terminó correctamente entre 01:54:56 y 01:55:48 UTC del 10 de octubre (noche del 9 en Chile). Creó dos cuentas confirmadas de validación y eliminó ambas en la limpieza final.

| Comprobación | Resultado |
|---|---|
| Chat y planes sin autenticación | Ambos rechazan con 401. |
| Callback AdMob con usuario agregado fuera de la firma | Rechazado con 400. No se generó una recompensa real. |
| Conversación real con Lumi | Respuesta recibida en 2,243 s, incluyendo recorrido remoto. |
| Repetición del mismo mensaje | Rechazo 409, sin un segundo descuento. |
| Historial de otra cuenta | No accesible desde la segunda cuenta. |
| Plan por cola real | Completado en 32,716 s desde el envío hasta observar el resultado, incluyendo sondeo cada dos segundos. |
| Trabajo de IA de otra cuenta | No accesible desde la segunda cuenta. |
| Guardado automático de la propuesta | No se creó una meta sin aprobación. |
| Web publicada, escritorio y móvil | Inicio/cierre de sesión, recuperación de datos, enlaces legales, ausencia de desbordamiento horizontal y ausencia de errores JavaScript en el recorrido. |
| Limpieza | Dos cuentas temporales eliminadas; no se modificaron cuentas ajenas. |

Estas dos duraciones son observaciones únicas de funcionamiento, no percentiles ni un estudio de rendimiento. No se hicieron compras, anuncios auténticos ni envíos de correo. La prueba de firma auténtica/maliciosa se cubre con claves de ensayo en la regresión local; el smoke remoto sólo comprueba rechazo de una consulta manipulada.

Se revisaron las capturas de portada y panel en escritorio y móvil, guardadas en `artifacts/release-visual/`. La captura del panel puede recoger la animación de texto de Lumi a medio escribir; no se interpretó ese fotograma como un fallo de carga. Persisten las observaciones de la auditoría sobre densidad de navegación y protagonismo de Lumi en móvil.

## Estado final de modelos y configuración

Tras las pruebas se descargaron de memoria los candidatos experimentales, conservando sus archivos instalados para futuras comparaciones. Ollama volvió a mostrar solamente:

- `qwen3.5:9b`, contexto 8.192, 5.729.167.604 bytes de VRAM atribuida.
- `qwen3:4b-instruct`, contexto 2.048, 2.874.062.929 bytes de VRAM atribuida.

Se restauró la residencia de chat a 30 minutos. No se cambió el modelo de producción ni se dejó el chat con el contexto de 8.192 utilizado en el ensayo de planificación.

Se confirmó la existencia remota de la variable `ADMOB_REWARDED_AD_UNIT`, sin leer ni publicar su valor. Esa presencia no demuestra que su contenido sea el bloque correcto; falta una prueba auténtica del proveedor.

El asesor de Supabase informó protección contra contraseñas filtradas desactivada. Las advertencias de funciones con privilegios no se trataron automáticamente como vulnerabilidades: `rls_auto_enable` es un disparador de eventos de creación de tablas y `billing_promotion` sirve un catálogo público; sigue siendo necesario revisar los permisos según su finalidad. No se activaron funciones que pudieran requerir un cambio de plan de pago.

## Qué queda pendiente

Resultados lingüísticos incoherentes en planes, correspondencia del resumen con tareas que `fitSchedule` cambia o elimina, evaluación independiente de modelos, métricas reales de carga/energía/costo, contraseñas filtradas, pruebas de pagos y anuncios reales, correo y accesibilidad con lector de pantalla. El detalle priorizado está en la auditoría y en la evaluación.

La verificación local pasó 121 pruebas Node/SQL y 50 pruebas Edge. La compilación, los tipos y las suites de interfaz también pasaron en la publicación. No se certifica seguridad completa ni ahorro monetario. Los cambios previos de Android, `.claude/` y la presentación del usuario se conservaron fuera de los commits de esta revisión.
