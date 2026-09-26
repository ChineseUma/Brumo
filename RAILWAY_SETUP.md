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

En una terminal, inicia el servidor local:

```bash
HOST=127.0.0.1 PORT=3000 npm start
```

Si usas GIFs, agrega `GIPHY_API_KEY=tu_clave` a ese comando. La clave de GIPHY pertenece al servidor local, no al puente de Railway.

En otra terminal, inicia el túnel con el mismo token de Railway:

```bash
RAILWAY_URL=https://bruma-xxxx.up.railway.app TUNNEL_TOKEN=tu_token_aleatorio LOCAL_PORT=3000 npm run tunnel
```

Debe aparecer `Túnel conectado a Railway.`. Ahora `/health` mostrará `{"connected":true}` y el dominio abrirá Bruma. El cliente del túnel se reconecta automáticamente si pierde la conexión.

## Comportamiento y límites

- La laptop debe seguir encendida, conectada a Internet y con ambos procesos ejecutándose. Si se apaga o duerme, el dominio seguirá existiendo, pero mostrará un error `503` hasta que vuelva a conectarse.
- Las cuentas, amistades y mensajes quedan en `storage/` en la laptop. Haz copias de seguridad de esa carpeta. Reiniciar `server.js` cierra las sesiones actuales porque estas viven en memoria.
- Railway termina HTTPS; el puente se conecta mediante WSS y usa el token para autenticar a la laptop. El servidor local escucha solo en `127.0.0.1` con el comando anterior.
- El dominio es público: cualquier persona que conozca la dirección puede entrar como visitante o crear una cuenta. Este proyecto sigue pensado para grupos pequeños; antes de difundirlo ampliamente harían falta controles contra abuso, límites de registro e intentos de inicio de sesión.
- No configures `server.js` como proceso de Railway si quieres conservar los datos en la laptop.

Documentación de Railway: [repositorios de GitHub](https://docs.railway.com/services), [comando de inicio](https://docs.railway.com/deployments/start-command), [variables](https://docs.railway.com/variables), [dominios](https://docs.railway.com/networking/domains/working-with-domains) y [conexiones WebSocket](https://docs.railway.com/networking/public-networking/specs-and-limits).
