const MAX_AVATAR_BYTES = 4_000_000;

function validAvatar(value) {
  if (!value) return true;
  const match = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || value.length > 4 * Math.ceil(MAX_AVATAR_BYTES / 3) + 64 || Buffer.byteLength(match[2], 'base64') > MAX_AVATAR_BYTES) return false;
  if (match[1] !== 'gif') return true;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return false;
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (!(width > 0 && height > 0 && width <= 1024 && height <= 1024)) return false;
  // Read blocks instead of assuming the trailer is the last byte. Some encoders
  // append padding after it; a 0x3b inside compressed pixels is not a trailer.
  let offset = 13 + ((bytes[10] & 0x80) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
  let frames = 0;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) return true;
      offset += size;
      if (offset > bytes.length) return false;
    }
    return false;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return frames > 0;
    if (marker === 0x21) { if (offset >= bytes.length) return false; offset++; if (!skipBlocks()) return false; }
    else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) return false;
      const frameWidth = bytes.readUInt16LE(offset + 4), frameHeight = bytes.readUInt16LE(offset + 6);
      if (!frameWidth || !frameHeight || frameWidth > 1024 || frameHeight > 1024) return false;
      const flags = bytes[offset + 8]; offset += 9;
      if (flags & 0x80) offset += 3 * (1 << ((flags & 7) + 1));
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return false;
      offset++; if (!skipBlocks()) return false; frames++;
    } else return false;
  }
  return false;
}

module.exports = {validAvatar, MAX_AVATAR_BYTES};
