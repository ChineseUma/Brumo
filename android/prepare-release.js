#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const privateDir = path.join(__dirname, '.private');
const keystore = path.join(privateDir, 'bruma-release.p12');
const settings = path.join(privateDir, 'release.properties');

if (fs.existsSync(keystore) || fs.existsSync(settings)) {
  console.error('Ya existe una clave o configuración de firma. No se reemplazará: es necesaria para actualizar la app.');
  process.exit(1);
}

fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
fs.chmodSync(privateDir, 0o700);
const password = crypto.randomBytes(32).toString('hex');
const result = spawnSync('keytool', [
  '-genkeypair', '-noprompt', '-keystore', keystore, '-storetype', 'PKCS12',
  '-alias', 'bruma', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000',
  '-dname', 'CN=Bruma', '-storepass:env', 'BRUMA_SIGNING_PASSWORD',
  '-keypass:env', 'BRUMA_SIGNING_PASSWORD'
], { env: { ...process.env, BRUMA_SIGNING_PASSWORD: password }, stdio: 'inherit' });

if (result.status !== 0) process.exit(result.status || 1);
fs.chmodSync(keystore, 0o600);
fs.writeFileSync(settings, [
  'storeFile=.private/bruma-release.p12',
  `storePassword=${password}`,
  'keyAlias=bruma',
  `keyPassword=${password}`,
  ''
].join('\n'), { mode: 0o600 });
console.log('Clave de firma creada en android/.private/. Respáldala junto con release.properties; ambos archivos son necesarios para futuras actualizaciones.');
