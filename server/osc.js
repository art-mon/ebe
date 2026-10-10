// Minimal OSC 1.0 codec — just enough for AbletonOSC (int32, float32, string,
// blob, T/F/N, bundles). Kept dependency-free on purpose.

const pad4 = (n) => (n + 3) & ~3;

function encodeString(str) {
  const bytes = Buffer.from(String(str), 'utf8');
  const buf = Buffer.alloc(pad4(bytes.length + 1));
  bytes.copy(buf);
  return buf;
}

function inferType(arg) {
  if (typeof arg === 'string') return 's';
  if (typeof arg === 'boolean') return arg ? 'T' : 'F';
  if (arg === null || arg === undefined) return 'N';
  return Number.isInteger(arg) ? 'i' : 'f';
}

/**
 * @param {string} address
 * @param {Array<number|string|boolean|null>} args
 * @param {string} [types] optional explicit type tags (e.g. "iif"), one per arg
 */
export function encodeMessage(address, args = [], types) {
  let tags = ',';
  const parts = [];
  args.forEach((arg, i) => {
    const t = types?.[i] ?? inferType(arg);
    tags += t;
    if (t === 'i') {
      const b = Buffer.alloc(4);
      b.writeInt32BE(Math.trunc(Number(arg)));
      parts.push(b);
    } else if (t === 'f') {
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number(arg));
      parts.push(b);
    } else if (t === 's') {
      parts.push(encodeString(arg));
    } else if (t !== 'T' && t !== 'F' && t !== 'N') {
      throw new Error(`Unsupported OSC type tag "${t}"`);
    }
  });
  return Buffer.concat([encodeString(address), encodeString(tags), ...parts]);
}

function readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return [buf.toString('utf8', offset, end), pad4(end + 1)];
}

/**
 * Decodes a packet into a flat list of messages (bundles are unpacked).
 * @returns {{address: string, args: any[]}[]}
 */
export function decode(buf) {
  if (buf.length >= 16 && buf.toString('ascii', 0, 8) === '#bundle\0') {
    const out = [];
    let off = 16; // "#bundle\0" + 8-byte timetag
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off);
      off += 4;
      out.push(...decode(buf.subarray(off, off + size)));
      off += size;
    }
    return out;
  }

  let [address, off] = readString(buf, 0);
  let tags = ',';
  if (off < buf.length) [tags, off] = readString(buf, off);

  const args = [];
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i': args.push(buf.readInt32BE(off)); off += 4; break;
      case 'f': args.push(buf.readFloatBE(off)); off += 4; break;
      case 'd': args.push(buf.readDoubleBE(off)); off += 8; break;
      case 'h': args.push(Number(buf.readBigInt64BE(off))); off += 8; break;
      case 's':
      case 'S': {
        let s;
        [s, off] = readString(buf, off);
        args.push(s);
        break;
      }
      case 'b': {
        const n = buf.readInt32BE(off);
        off += 4;
        args.push(buf.subarray(off, off + n).toString('base64'));
        off += pad4(n);
        break;
      }
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 'I': args.push(Infinity); break;
      default:
        return [{ address, args, error: `unsupported type tag "${t}"` }];
    }
  }
  return [{ address, args }];
}
