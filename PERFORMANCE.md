# Rendimiento de Bruma

El recorrido de un mensaje es cliente → Railway → WebSocket persistente → servidor casero → eventos hacia los clientes. GitHub solo interviene al desplegar código. La latencia total sigue dependiendo de la conexión de la casa y de la distancia a Railway.

## Continuación de la optimización — 5 de octubre de 2026

Se conservan las mejoras existentes: mensajes compactos con medios descargados bajo demanda, SQLite en un worker, envíos con identificador estable para evitar duplicados, presentación inmediata de mensajes pendientes, eventos incrementales y protocolo binario del túnel.

Cambios de esta revisión:

- **Disco:** hasta 32 envíos que coinciden en una vuelta del bucle comparten una transacción. No hay una espera artificial para llenar tandas. Cada envío tiene su propio savepoint; un error no descarta los demás. Se conserva `synchronous=FULL` y se responde únicamente después de confirmar la transacción. Las lecturas, ediciones y el cierre respetan el orden de los envíos anteriores.
- **Medios:** las referencias se verifican sin leer el BLOB entero; la limpieza tiene un índice por medio. Al reconstruir una respuesta para clientes antiguos, cada avatar o imagen repetida se lee y convierte una sola vez por respuesta.
- **Túnel:** un planificador limita a una trama en curso por dirección, fragmenta cuerpos y respuestas en partes de hasta 16 KiB y prioriza texto/eventos frente a medios/subidas. Cada ocho tramas prioritarias permite avanzar una transferencia pendiente. Mantiene el orden de cada petición y el protocolo anterior. Esto reduce lo que una transferencia deja en cola; no reserva ancho de banda ni elimina la latencia TCP.
- **Conexiones:** Railway entrega las cabeceras en cuanto llegan, y los callbacks de una conexión antigua no envían respuestas por su reemplazo.
- **Web:** muestra inicialmente 40 mensajes, permite recuperar historial con «Mostrar mensajes anteriores» y carga avatares de forma diferida. Al seguir la conversación mantiene limitada la cantidad de mensajes dibujados. Una confirmación recibida en el historial tras reconectar retira el envío pendiente aunque se pierda su respuesta HTTP.

## Medición del almacenamiento

Datos sintéticos, directorios temporales, 640 mensajes por ejecución, concurrencia 16 y avatar de 4 KiB. Comparación con los archivos que había al comenzar esta revisión, incluyendo las optimizaciones del agente anterior. Tres ejecuciones alternadas de cada versión en el mismo entorno; se muestran las medianas:

| Medida | Antes | Después |
| --- | ---: | ---: |
| Tiempo total | 6.719 ms | 678 ms |
| Confirmación p95 por ejecución | 286,53 ms | 33,97 ms |
| Bytes escritos por el proceso | 19.777.248 | 6.215.364 |

El total se redujo aproximadamente un 90 % y las escrituras un 69 % en esta carga concurrente. El disco tuvo variabilidad: los totales anteriores fueron 9.869/3.096/6.719 ms y los nuevos 678/809/623 ms. Estas cifras **no miden Railway, Internet, ni el tiempo hasta otro teléfono**, y no predicen el ahorro de un mensaje aislado. `writtenBytes` usa el contador Linux `/proc/self/io`, no un contador físico del dispositivo.

```bash
npm run benchmark:store
# Comparar una copia anterior sin tocar su storage:
node tools/benchmark-store.js /ruta/a/la/copia
```

## Validación

```bash
npm run test:unit
npm test
npm run benchmark:messages
```

Las pruebas sin puertos cubren reintentos, caducidad, importación, recuperación después de interrumpir el worker, fallo aislado en una tanda, cierre tras 70 envíos, protocolo anterior, prioridad, equidad y limpieza de colas. Otra prueba ejecuta ambos programas reales del túnel con sockets y HTTP simulados en memoria: transmite una subida de 700 KB, una descarga de 5 MB y texto simultáneamente, y verifica los bytes recibidos.

La integración TCP y el benchmark de mensajes no pudieron ejecutarse en el entorno de edición: abrir un puerto local devuelve `EPERM`. Deben ejecutarse en la laptop antes del despliegue. El comprobador web `node tools/check-web-ui.js` requiere `jsdom` disponible (puede indicarse con `NODE_PATH`); incluye confirmación, reintentos, reconexión e historial de 1.000 mensajes. Aquí no estaba disponible `jsdom`, su instalación temporal falló por restricciones de red y Firefox headless falló al iniciar, por lo que queda pendiente esa comprobación de interfaz.

## Ponerlo en uso

1. Ejecutar las pruebas completas en la laptop. Si se respalda `storage/`, detener primero Bruma para que la copia de SQLite y su WAL sea consistente.
2. Publicar el código actualizado en el repositorio conectado a Railway; conservar el comando `npm run start:railway`. Incluir `lib/`, `railway/wire.js` y `railway/sender.js` junto con el resto del proyecto: varios archivos de la optimización previa todavía no estaban registrados en Git.
3. Reiniciar servidor y túnel con `npm run bruma -- detener` y `npm run bruma -- iniciar`; comprobar `npm run bruma -- estado`.
4. Recargar la web. Las mejoras de almacenamiento y transporte también benefician a Android; esta revisión no modifica ni recompila el APK.

No se realizó un despliegue ni se reiniciaron los procesos de producción durante esta revisión. Los benchmarks solo usan información ficticia y no abren el almacenamiento real.
