# Bruma — chat efímero

#HECHO CON IA - NO USAR

Chat web para grupos pequeños con sala compartida, cuentas opcionales, amistades y conversaciones privadas. Los mensajes grupales caducan después de 12 horas o durante la limpieza de medianoche; los privados, después de 24 horas. Cuentas, amistades y mensajes se guardan en archivos JSON dentro de `storage/`.

## Uso local

```bash
npm ci
npm start
```

Abre <http://localhost:3000>. Puedes cambiar el puerto con `PORT=4000 npm start` y activar el buscador de GIFs con `GIPHY_API_KEY=tu_clave npm start`.

## Dominio de Railway con los datos en tu laptop

Sigue [RAILWAY_SETUP.md](RAILWAY_SETUP.md). Railway ejecuta el puente con `npm run start:railway`, mientras la laptop ejecuta `npm start` y `npm run tunnel`. La carpeta `storage/` permanece en la laptop.

## Documentación y pruebas

Consulta [GUIA_PROYECTO.txt](GUIA_PROYECTO.txt) para las funciones y rutas de la API. Ejecuta `npm test` para verificar la propiedad de mensajes, la privacidad de eventos y el puente local.
