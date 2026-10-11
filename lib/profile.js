const MAX_BANNER_BYTES = 1_000_000;
const MAX_BIO_LENGTH = 2000;

function validBanner(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(MAX_BANNER_BYTES / 3) + 64) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_BANNER_BYTES) return false;
  if (match[1] === 'jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (match[1] === 'png') {
    if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii',offset+4,offset+8);
      if (size > bytes.length - offset - 12 || type === 'acTL') return false;
      if (type === 'IEND') return size === 0;
      offset += size + 12;
    }
    return false;
  }
  if (bytes.length < 20 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WEBP') return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii',offset,offset+4), size = bytes.readUInt32LE(offset+4);
    if (size > bytes.length - offset - 8 || type === 'ANIM' || type === 'ANMF') return false;
    if (type === 'VP8X' && (size < 1 || (bytes[offset+8] & 2))) return false;
    offset += 8 + size + (size & 1);
  }
  return offset === bytes.length;
}

module.exports = {validBanner, MAX_BANNER_BYTES, MAX_BIO_LENGTH};
