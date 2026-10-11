const MAX_AVATAR_BYTES = 280_000;

function validAvatar(value) {
  if (!value) return true;
  const match = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || value.length > 400_000 || Buffer.byteLength(match[2], 'base64') > MAX_AVATAR_BYTES) return false;
  if (match[1] !== 'gif') return true;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return false;
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  return width > 0 && height > 0 && width <= 1024 && height <= 1024 && bytes.at(-1) === 0x3b;
}

module.exports = {validAvatar, MAX_AVATAR_BYTES};
