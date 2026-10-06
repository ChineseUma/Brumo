# Bruma para Android

Cliente Android nativo en Java. La sala ocupa la pantalla principal; el botón ☰ abre conversaciones y solicitudes de amistad, y ⓘ abre la cuenta, los detalles y la dirección del servidor. Admite chat grupal como visitante o con cuenta, texto, imágenes, GIFs y notas de voz en la sala, respuestas, edición y borrado de mensajes propios, amistades y chats privados de texto. Recibe cambios en tiempo real mientras está abierta mediante Server-Sent Events. El compositor se desplaza con el teclado y la interfaz respeta las barras del sistema.

En la sala, **GIF** abre el buscador y permite adjuntar un resultado; la búsqueda necesita `GIPHY_API_KEY` en el servidor local. También puedes elegir un GIF guardado en el teléfono sin esa clave. **● Voz** inicia la grabación y el mismo botón la detiene; después toca **➤** para enviarla. Android solicitará permiso de micrófono la primera vez. Toca la indicación del adjunto para quitarlo. En ⓘ se muestra la foto de perfil actual, que puedes tocar para ampliarla.

La app se conecta por defecto a `https://brumo-production.up.railway.app`. Puedes cambiar la dirección desde ⓘ → Servidor. **El APK no ejecuta `server.js`:** tu laptop debe tener Bruma y el túnel activos. No hay notificaciones en segundo plano ni modo sin conexión en esta versión. La versión 1.3.0 recibe eventos incrementales: al crear, editar o borrar un mensaje solo se transmite ese cambio; tras reconectar recibe una copia completa para sincronizarse. Inicia los eventos apenas valida la sesión y consulta amistades y configuración en paralelo. Si los mensajes no llegan por eventos, intenta obtenerlos por separado. Conserva las salas abiertas en memoria durante la sesión, dibuja inicialmente los últimos 40 mensajes y carga imágenes al entrar en pantalla. El botón «Mostrar mensajes anteriores» permite ver más historial.

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
