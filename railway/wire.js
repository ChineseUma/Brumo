'use strict';
// Four header-length bytes, compact JSON metadata, then the unmodified body.
function encode(message, body) {
  const metadata = Buffer.from(JSON.stringify(message));
  const prefix = Buffer.allocUnsafe(4); prefix.writeUInt32BE(metadata.length);
  return Buffer.concat([prefix, metadata, body], 4 + metadata.length + body.length);
}
function decode(raw, binary) {
  if (!binary) return JSON.parse(raw.toString());
  if (raw.length < 4) throw new Error('Trama incompleta');
  const length = raw.readUInt32BE();
  if (length > 65536 || length > raw.length - 4) throw new Error('Cabecera inválida');
  return {...JSON.parse(raw.subarray(4, 4 + length).toString()), bytes: raw.subarray(4 + length)};
}
module.exports = {encode, decode};
