# Bruma con dominio Railway y servidor en tu laptop

La ruta es: navegador → dominio HTTPS de Railway → puente WebSocket → `server.js` en tu laptop. Railway solo reenvía tráfico; los archivos `storage/` se crean y permanecen en la laptop. No hace falta abrir puertos en el router ni tener IP pública fija.

## 1. Protege los datos antes de subir el repositorio

El proyecto ya ignora `storage/`, `node_modules/` y archivos `.env`. Comprueba si `storage/` estaba incluido en Git antes de este cambio:

```bash
git ls-files storage
```

Si aparece algún archivo, quítalo del índice sin borrarlo de tu laptop y confirma ese cambio:

```bash
git rm --cached -r storage
git add .gitignore
git commit -m "No publicar datos locales"
```

Esto evita nuevas publicaciones, pero no elimina archivos ya presentes en el historial de GitHub. Si el repositorio era público y contenía `accounts.json`, trata los correos y hashes como expuestos y revisa el historial antes de compartirlo.

## 2. Crea el servicio de Railway

1. Sube esta versión del repositorio a GitHub.
2. En Railway, crea un proyecto con **Deploy from GitHub repo** y selecciona el repositorio.
3. En el servicio, abre **Settings → Deploy** y pon **Custom Start Command** en `npm run start:railway`. Este paso es esencial: `npm start` iniciaría el chat en Railway y guardaría datos allí.
4. Deja una sola réplica del servicio. El túnel de la laptop se conecta a una instancia; otras réplicas no tendrían esa conexión.
5. Opcionalmente, configura **Healthcheck Path** como `/health`.
6. En **Variables**, agrega `TUNNEL_TOKEN` con un valor aleatorio de al menos 32 caracteres. Puedes generar uno en tu laptop con:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Copia el valor en Railway y guárdalo también para el paso 3. No lo subas a GitHub.
7. En **Settings → Networking → Public Networking**, pulsa **Generate Domain**. Copia la dirección completa, por ejemplo `https://bruma-xxxx.up.railway.app`.

`/health` debe devolver `{"connected":false}` mientras la laptop no esté conectada. Eso indica que el puente está funcionando, aunque el chat todavía no esté disponible.

## 3. Arranca la app en la laptop

Instala las dependencias una vez:

```bash
npm ci
```

Si compartiste el token con alguien, cámbialo por uno nuevo en Railway. En la carpeta del proyecto, crea `.env.local` con este contenido (usa la dirección completa con `https://`):

```dotenv
RAILWAY_URL=https://tu-dominio.up.railway.app
TUNNEL_TOKEN=pega_aqui_el_token_de_Railway
PORT=3000
```

Protege el archivo con `chmod 600 .env.local`. Está ignorado por Git; no lo subas ni compartas. Si usas GIFs, añade `GIPHY_API_KEY=tu_clave` al mismo archivo. La clave pertenece al servidor local, no al puente de Railway.

Si todavía tienes un `npm start` o `npm run tunnel` abierto, ciérralo con Ctrl+C antes de usar el controlador. Luego ejecuta:

```bash
npm run bruma -- iniciar
npm run bruma -- estado
```

`iniciar` deja ambos procesos en segundo plano. `estado` muestra si el servidor responde y si Railway informa que el túnel está conectado. Para apagarlos:

```bash
npm run bruma -- detener
```

Los registros están en `storage/.bruma-control/server.log` y `storage/.bruma-control/tunnel.log`. El controlador solo detiene procesos iniciados por él; si el puerto 3000 ya lo ocupa una instancia manual, te lo indicará sin cerrarla. El cliente del túnel se reconecta automáticamente si pierde la conexión.

## Comportamiento y límites

- La laptop debe seguir encendida, conectada a Internet y con ambos procesos ejecutándose. Si se apaga o duerme, el dominio seguirá existiendo, pero mostrará un error `503` hasta que vuelva a conectarse.
- Las cuentas, amistades y mensajes quedan en `storage/` en la laptop. Las sesiones se conservan al reiniciar hasta su caducidad. Los mensajes y medios usan SQLite en modo WAL: para respaldarlos, detén el servidor antes de copiar `storage/` o usa una copia consistente de SQLite que incluya las escrituras pendientes del WAL.
- Railway termina HTTPS; el puente se conecta mediante WSS y usa el token para autenticar a la laptop. El servidor local escucha solo en `127.0.0.1` con el comando anterior.
- El dominio es público: cualquier persona que conozca la dirección puede entrar como visitante o crear una cuenta. Este proyecto sigue pensado para grupos pequeños; antes de difundirlo ampliamente harían falta controles contra abuso, límites de registro e intentos de inicio de sesión.
- No configures `server.js` como proceso de Railway si quieres conservar los datos en la laptop.

Documentación de Railway: [repositorios de GitHub](https://docs.railway.com/services), [comando de inicio](https://docs.railway.com/deployments/start-command), [variables](https://docs.railway.com/variables), [dominios](https://docs.railway.com/networking/domains/working-with-domains) y [conexiones WebSocket](https://docs.railway.com/networking/public-networking/specs-and-limits).
