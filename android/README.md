# Bruma para Android

Cliente Android nativo en Java. La sala ocupa la pantalla principal; el botón ☰ abre conversaciones y solicitudes de amistad, y ⓘ abre la cuenta, los detalles y la dirección del servidor. Admite chat grupal como visitante o con cuenta, texto, imágenes, GIFs y notas de voz en la sala, respuestas, edición y borrado de mensajes propios, amistades y chats privados de texto. Recibe cambios en tiempo real mientras está abierta mediante Server-Sent Events. El compositor se desplaza con el teclado y la interfaz respeta las barras del sistema.

En la sala, **GIF** abre el buscador y permite adjuntar un resultado; la búsqueda necesita `GIPHY_API_KEY` en el servidor local. También puedes elegir un GIF guardado en el teléfono sin esa clave. **● Voz** inicia la grabación y el mismo botón la detiene; después toca **➤** para enviarla. Android solicitará permiso de micrófono la primera vez. Toca la indicación del adjunto para quitarlo. En ⓘ se muestra la foto de perfil actual, que puedes tocar para ampliarla.

La app se conecta por defecto a `https://brumo-production.up.railway.app`. Puedes cambiar la dirección desde ⓘ → Servidor. **El APK no ejecuta `server.js`:** tu laptop debe tener Bruma y el túnel activos. Puedes activar notificaciones en ⓘ. Una conexión en segundo plano con aviso permanente recibe mensajes y solicitudes al minimizar la app; Android 13 o posterior pide permiso. No llegan avisos sin conexión o después de forzar el cierre. No hay modo sin conexión. La versión 1.3.0 recibe eventos incrementales: al crear, editar o borrar un mensaje solo se transmite ese cambio; tras reconectar recibe una copia completa para sincronizarse. Inicia los eventos apenas valida la sesión y consulta amistades y configuración en paralelo. Si los mensajes no llegan por eventos, intenta obtenerlos por separado. Conserva las salas abiertas en memoria durante la sesión, dibuja inicialmente los últimos 40 mensajes y carga imágenes al entrar en pantalla. El botón «Mostrar mensajes anteriores» permite ver más historial.

## Compilar

Requiere JDK 17 y Android SDK Platform 36 con Build-Tools 35.0.0. Define `ANDROID_HOME` con la ruta de tu SDK, o crea `local.properties` en esta carpeta con `sdk.dir=/ruta/al/sdk`. Para generar un APK de prueba firmado con la clave de depuración:

```bash
cd android
./gradlew assembleDebug
```

El archivo estará en `app/build/outputs/apk/debug/app-debug.apk`. Para probarlo en un teléfono conectado por USB con depuración habilitada, usa `adb install app/build/outputs/apk/debug/app-debug.apk`.

Para compartir un APK de versión estable, genera la clave privada una sola vez y compila `release`:

```bash
node prepare-release.js
./gradlew assembleRelease
```

El archivo estará en `app/build/outputs/apk/release/app-release.apk`. **Respalda toda la carpeta `android/.private/`** en un lugar seguro antes de compartir el APK: contiene la clave y la contraseña necesarias para que Android acepte futuras actualizaciones. El script nunca sobrescribe una clave existente. El SDK, la clave y los archivos generados están ignorados por Git. La versión 1.3.0 usa `versionCode` 4 y la misma firma de las versiones anteriores para instalarse como actualización.

## Optimización 0.2.5

Las fotos se preparan fuera de la interfaz, con un lado inicial máximo de 1600 px y objetivo de 1 MB en WebP. La app conserva el original si ya es menor. GIF y WebP animados conservan sus bytes y fotogramas. Para enviar una foto original, usa «Archivos» (el servidor admite hasta 10 MB por archivo de imagen/audio).

Las fotos se envían como binario y el mensaje contiene referencias pequeñas; se conservan la vista previa inmediata, la cola independiente de texto y los reintentos con identificador estable. La búsqueda de GIF pide menos metadatos y miniaturas estáticas. La caché HTTP de 16 MiB se comparte entre pantallas y se añade una caché de bitmaps de 4 MiB.

La versión release reduce código y recursos con R8. Revisa [OPTIMIZACION_ANDROID.md](../OPTIMIZACION_ANDROID.md) para el análisis detallado, los límites, las pruebas y las comprobaciones pendientes en teléfono.

## Perfiles y avisos 0.2.6

Las fotos de perfil admiten GIF animado de hasta 280 KB y 1024 × 1024 px, conservando sus fotogramas. Toca el autor registrado de un mensaje o «Ver perfil» en conversaciones para consultar foto, nombre visible y @usuario. El correo permanece privado.

En ⓘ puedes activar o desactivar los avisos. Tocarlos abre la sala, conversación privada o solicitudes correspondientes. Los mensajes propios, el historial al reconectar y los mensajes de la conversación visible no generan avisos. La conexión de notificaciones consume red y puede ser detenida por Android o por el usuario; no utiliza Firebase ni requiere claves externas. La versión es 0.2.6, código 10.
