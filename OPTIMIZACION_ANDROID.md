# Optimización de Android — Bruma 0.2.5

Revisión del 6 de octubre de 2026, sobre el commit `42ff38d`. Se conservaron los mensajes compactos v3, SQLite, las confirmaciones idempotentes, los envíos pendientes, las colas independientes de texto y medios, y el túnel binario con prioridad de texto que ya tenía esta versión. La copia antigua en `/data/src/projects/chat-efimero-github` no se modificó.

## Revisión del recorrido de envío

### Preparación de fotos

**Antes:** la app leía hasta 10 MB completos en un `ByteArrayOutputStream`, copiaba ese contenido a un `byte[]`, lo convertía a Base64 y lo retenía en `pendingImages`. Luego serializaba JSON, creaba una copia de la vista previa mediante otra serialización y comprimía el cuerpo con gzip. Cuatro fotos podían superar el límite descomprimido de 30 MB del servidor. Las imágenes esperaban detrás de descargas de GIF en el mismo ejecutor.

**Ahora:** `ImagePreparer` prepara de una en una en un ejecutor independiente. Usa archivos temporales y un buffer de 16 KiB, sin cargar el archivo comprimido entero en RAM. Las fotos estáticas se decodifican con tamaño limitado y orientación EXIF, se convierten a sRGB y se codifican como WebP:

- Lado mayor inicial: 1600 px, sin ampliar fuentes pequeñas.
- Calidad inicial: 82; objetivo: 1.000.000 bytes por foto.
- Solo si excede ese objetivo: calidad 72, y después reducción a 1280/640 px si sigue siendo necesario.
- Si el original ya pesa menos que el resultado, se conservan sus bytes; en ese caso puede conservar también dimensiones mayores que 1600 px.
- Fuente estática máxima: 30.000.000 bytes; subida máxima: 10.000.000 bytes. El objetivo de 1 MB no es una garantía universal de calidad o tamaño.
- La decodificación antigua en Android 8 usa muestreo por potencias de dos; su resultado puede ser menor que los 1600 px exactos usados desde Android 9.

Esto implica pérdida de resolución, detalle y metadatos cuando se genera WebP. No se promete calidad idéntica a la fuente. **Para conservar el archivo original, usar «Archivos»**, sujeto al límite del servidor de 10 MB para tipos imagen/audio.

### GIF y WebP animados

Las animaciones del teléfono se envían sin transcodificar ni eliminar fotogramas. WebP se reconoce mediante la bandera de animación de VP8X antes de decodificar una foto. El límite sigue siendo 10 MB. Android 9+ reproduce GIF y WebP animados con `ImageDecoder`; Android 8 conserva la visualización estática preexistente.

Para GIPHY, `fields` pide solamente título, URLs, tamaños de `fixed_width` y URLs de miniaturas. El selector usa `fixed_width_small_still`; si falta, usa la alternativa disponible. Para enviar, elige WebP animado cuando Android lo soporta y GIPHY declara que pesa menos que el GIF. Conserva la resolución `fixed_width` anterior y el GIF como alternativa. Los tamaños declarados por la API son orientativos. Las búsquedas utilizan una cola diferente a las miniaturas, y las descargas de vistas retiradas se interrumpen al leer el siguiente fragmento.

### Transporte, confirmación y reintentos

Las fotos se suben como binario y el mensaje lleva solo `files: [{id: ...}]`. El servidor valida autor y destinatario y añade los metadatos. La web y Android muestran estas referencias como imágenes. Los medios v3 anteriores y el historial antiguo siguen siendo compatibles.

Las subidas de longitud conocida de hasta 10 MB mantienen el camino directo de una petición que ya tenía la API; ahora lo usan también las fotos. Los archivos grandes o de tamaño desconocido mantienen inicio/fragmentos/fin. Cada fragmento de hasta 2 MiB utiliza el buffer original, sin `Arrays.copyOf`; se espera su respuesta antes de reutilizarlo. Se cierra el stream también si falla la petición inicial. Se corrigieron la longitud desconocida del proveedor, la codificación de nombres con espacios y las diferencias entre límites decimales y binarios del selector y servidor.

Las vistas previas se crean sin serializar/copiar el contenido completo. El compositor se libera inmediatamente después de preparar el envío; la preparación activa se indica antes de permitir enviarlo. Cada envío conserva su `clientId`, sus referencias completadas y la sala original. Un reintento no vuelve a subir adjuntos ya completados. Si el servidor dice que los adjuntos caducaron, se invalidan las referencias para reponerlos. La confirmación por eventos o historial sigue retirando el envío pendiente aunque se pierda su respuesta HTTP.

Los temporales se eliminan al cancelar, confirmar o destruir una pantalla sin una subida activa. La preparación cancelada por cambiar de sala no añade imágenes a la sala nueva. Archivos abandonados por una terminación del proceso se recogen después de 24 horas al abrir de nuevo la app. Los envíos pendientes siguen estando únicamente en memoria, como antes: no se añadió una cola persistente para recuperar borradores tras terminar el proceso.

## Recepción, memoria y caché

- Un solo OkHttpClient por proceso comparte conexiones y caché entre recreaciones de Activity. Esto evita abrir simultáneamente varios propietarios de la misma caché en disco.
- Se conserva la caché HTTP de **16 MiB**. Las descargas remotas para imágenes se escriben en temporales y se decodifican desde disco; ya no hacen una copia adicional completa mediante `toByteArray`.
- Caché adicional de bitmaps: **4 MiB**; caché de avatares existente: **4 MiB**. Una vista previa estática que ya se decodificó puede reutilizar su bitmap bajo la URL confirmada, evitando volver a descargarla cuando siga en caché.
- Estos tamaños son presupuestos de caché, no límites de memoria total. Decodificación, vistas y animaciones usan memoria adicional. La preparación sRGB a 1600 × 1600 puede requerir unos 10,24 MB de píxeles ARGB antes de contar rotación/codificación; se procesa una foto a la vez.
- Se conservó el renderizado incremental existente. Las imágenes remotas se decodifican a un lado máximo de 960 px, las miniaturas a 320 px, y las animaciones de la sala se detienen al quedar fuera de pantalla o al dejar la app.
- Adjuntos descargados con token correcto: `Cache-Control: private, max-age=86400`. Descargas por permisos/cookies sin token: `no-store`. Se conserva `Content-Disposition: attachment` y `nosniff` para impedir ejecutar HTML bajo el dominio del chat. No se aplica esta política al JSON de cuentas o mensajes.
- La versión release activa R8 y reducción de recursos con las reglas oficiales de Android, incluyendo las reglas de consumidor de las dependencias. No se añadió otra biblioteca al APK.

## Medición y alcance de las cifras

Para 1.048.576 bytes, Base64 ocupa 1.398.104 caracteres antes de prefijo y JSON: quitarlo elimina 349.528 bytes de esa representación, un 25 %. **Eso no equivale a ahorrar un 25 % en la red respecto a este commit**, porque ya comprimía el JSON con gzip y usaba un túnel binario. En una muestra de 1 MiB aleatorio, gzip del JSON/Base64 midió 1.059.107 bytes frente a 1.048.576 bytes binarios: aproximadamente un 1 % de diferencia, sin cabeceras ni TLS. Los mayores ahorros de las fotos vienen de reducir/codificar la imagen y quitar las copias y el trabajo de codificación/compresión del cliente; dependen de la foto.

La nueva prueba de transporte sube aproximadamente 1 MiB y verifica que el mensaje enviado por referencia ocupa menos de 200 bytes y que su historial ocupa menos de 1 KiB. Esta versión ya tenía historial compacto para imágenes Base64 recibidas: no se atribuye esa mejora previa a esta revisión. La prueba comprueba también confirmación idempotente, bytes descargados y propiedad del adjunto.

No hay una medición de latencia real en teléfono ni un porcentaje inventado de compresión para fotos. Una foto ahora necesita subida + mensaje, frente al antiguo POST con Base64; esa segunda petición puede pesar en redes de latencia alta, especialmente para imágenes diminutas. A cambio se elimina Base64 del compositor y se reduce la foto antes de transmitirla. Los GIF de GIPHY siguen enviándose como una URL, sin subir su contenido al servidor.

## Tamaño del APK

Se ensamblaron ambos releases sin firma con JDK 17, Gradle 8.13, SDK 36 y las mismas dependencias. La copia anterior se obtuvo del commit `42ff38d` en un directorio independiente, sin tocar el repo ni datos reales.

| APK release sin firma | Bytes |
| --- | ---: |
| Anterior, 0.2.4 | 1.185.603 |
| Optimizado, 0.2.5 | 276.535 |
| Reducción | 909.068 (76,68 %) |

La reducción corresponde principalmente a R8 y recursos; no mide memoria en uso ni tráfico de mensajes. El APK debug tiene 1.653.896 bytes porque conserva código de depuración y no usa esa reducción.

Se generaron `android/app/build/outputs/apk/debug/app-debug.apk` y `android/app/build/outputs/apk/release/bruma-0.2.5.apk`. **El release está sin firmar y no se instala directamente.** El debug tiene firma de depuración y no sustituye una instalación con otra firma. La revisión automática bloqueó firmar con la clave privada local de la copia anterior; ese paso requiere autorización explícita. La clave no se modificó y se retiró el enlace temporal a ella. No se instaló ni publicó ningún APK.

## Validación

- **25 pruebas Node pasan:** almacenamiento, controlador, permisos, medios, reintentos, eventos y túnel; tres nuevas cubren fotos binarias, GIF privados y su representación en la web.
- Compilación Java 17 de las tres clases Android con Android API 35 y las dependencias reales: OkHttp 5.3.0, Okio 3.16.2 y Kotlin stdlib 2.2.21. Las nuevas APIs posteriores a Android 8 tienen guardas de versión; el proyecto conserva `compileSdk 36`.
- `assembleDebug` y `assembleRelease` completados con SDK 36, incluyendo R8 y `lintVitalRelease`. Se reconstruyeron después del ajuste final de animaciones en segundo plano.
- Comprobación sintáctica de servidor/web y `git diff --check`.
- La revisión no publica en Railway, no reinicia producción y no modifica datos reales.

La calidad de fotos/texto, transparencia, orientación EXIF reflejada y reproducción de animaciones deben verificarse en dispositivo. También hay que medir memoria y bytes con las mismas fotos antes/después en Wi-Fi y datos móviles, probar cambios de sala durante la preparación, fallos de red entre subida y confirmación y caché tras recrear la pantalla. Compilar no sustituye estas comprobaciones.

Fuentes técnicas: [Android ImageDecoder](https://developer.android.com/reference/android/graphics/ImageDecoder), [GIPHY: rendiciones y campos bajo demanda](https://developers.giphy.com/docs/optional-settings/).
