# Bruma — chat efímero

#HECHO CON IA - NO USAR

Chat web para grupos pequeños con sala compartida, cuentas opcionales, amistades y conversaciones privadas. Los mensajes grupales caducan después de 12 horas o durante la limpieza de medianoche; los privados, después de 24 horas. Mensajes y medios se guardan en `storage/chat.sqlite`; cuentas, amistades, sesiones y metadatos de archivos, en JSON dentro de `storage/`. Requiere Node.js 22.16 o posterior.

## Uso local

```bash
npm ci
npm start
```

Abre <http://localhost:3000>. Puedes cambiar el puerto con `PORT=4000 npm start` y activar el buscador de GIFs con `GIPHY_API_KEY=tu_clave npm start`.

## Dominio de Railway con los datos en tu laptop

Sigue [RAILWAY_SETUP.md](RAILWAY_SETUP.md). Railway ejecuta el puente con `npm run start:railway`. En la laptop, guarda `RAILWAY_URL` y `TUNNEL_TOKEN` en `.env.local` y usa estos comandos:

```bash
npm run bruma -- iniciar
npm run bruma -- estado
npm run bruma -- detener
```

`iniciar` arranca el servidor y el túnel en segundo plano; `detener` cierra solo los procesos que inició este controlador. Los datos, registros y archivos de control permanecen en `storage/` en la laptop. Sin `RAILWAY_URL` y `TUNNEL_TOKEN`, `iniciar` levanta solo el servidor local.

## App Android

El cliente nativo para teléfono está en [android/](android/). Tiene una sala central y paneles desplegables para conversaciones y cuenta. Usa la misma API del servidor mediante el dominio HTTPS de Railway; consulta [android/README.md](android/README.md) para compilar el APK.

## Perfiles y notificaciones

En Cuenta puedes elegir un GIF como foto de perfil: conserva la animación, con un máximo de 4 MB y 1024 × 1024 px. También se admiten JPEG, PNG y WebP. Toca el autor de un mensaje registrado o «Perfil» junto a un amigo para ver su foto, nombre visible y @usuario. Los perfiles públicos no incluyen correo ni datos de sesión.

Activa las notificaciones desde Cuenta. La web muestra avisos de mensajes nuevos y solicitudes de amistad, con contadores por conversación; los avisos del sistema requieren permiso y mantener la página abierta. No avisa por mensajes propios, historial, ediciones ni mensajes de la sala que estás viendo. Android permite recibir avisos al minimizar la app mediante una conexión en segundo plano con una notificación permanente. Ambos clientes necesitan conexión con el servidor; no hay servicio de push para avisar después de forzar el cierre.

## Documentación y pruebas

Consulta [GUIA_PROYECTO.txt](GUIA_PROYECTO.txt) para las funciones y rutas de la API. Ejecuta `npm test` para verificar la propiedad de mensajes, la privacidad de eventos y el puente local.

La ruta de cada mensaje es **cliente → Railway → túnel WebSocket → servidor casero → clientes conectados**. GitHub distribuye el código para el despliegue y no participa en el envío de mensajes.

Consulta [PERFORMANCE.md](PERFORMANCE.md) para las optimizaciones, mediciones reproducibles y pasos de actualización. `npm run test:unit` comprueba almacenamiento y transporte sin abrir puertos; `npm run benchmark:store` mide escrituras en un directorio temporal; `npm run benchmark:messages` mide confirmación y recepción usando un túnel local de prueba.
