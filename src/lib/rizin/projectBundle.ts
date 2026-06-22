// Self-contained RzWeb project bundle. A Rizin `.rzdb` only references the
// binary's path, not its bytes, so a bare `.rzdb` cannot be reopened cold in
// the browser. We wrap the binary with the rzdb so loading a saved project is a
// single cold action.
//
// Layout (all integers little-endian):
//   magic    "RZWEBPRJ"  (8 bytes)
//   version  u8
//   nameLen  u32  + name  (UTF-8)
//   binLen   u32  + binary bytes
//   rzdbLen  u32  + rzdb bytes
//
// decodeProjectBundle returns null for anything that isn't a bundle (e.g. a raw
// Rizin `.rzdb`), so callers can fall back to the legacy path.

const MAGIC = 'RZWEBPRJ';
const MAGIC_LEN = 8;
const VERSION = 1;
const HEADER_MIN = MAGIC_LEN + 1 + 4; // magic + version + first length field

export interface ProjectBundle {
  name: string;
  binary: Uint8Array;
  rzdb: Uint8Array;
}

export function encodeProjectBundle(name: string, binary: Uint8Array, rzdb: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(MAGIC);
  const nameBytes = encoder.encode(name);

  const total = MAGIC_LEN + 1 + 4 + nameBytes.length + 4 + binary.length + 4 + rzdb.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  let offset = 0;
  out.set(magicBytes, offset);
  offset += MAGIC_LEN;
  view.setUint8(offset, VERSION);
  offset += 1;
  view.setUint32(offset, nameBytes.length, true);
  offset += 4;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  view.setUint32(offset, binary.length, true);
  offset += 4;
  out.set(binary, offset);
  offset += binary.length;
  view.setUint32(offset, rzdb.length, true);
  offset += 4;
  out.set(rzdb, offset);

  return out;
}

export function decodeProjectBundle(data: Uint8Array): ProjectBundle | null {
  if (!data || data.byteLength < HEADER_MIN) {
    return null;
  }

  const decoder = new TextDecoder();
  if (decoder.decode(data.subarray(0, MAGIC_LEN)) !== MAGIC) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = MAGIC_LEN;

  try {
    if (view.getUint8(offset) !== VERSION) {
      return null;
    }
    offset += 1;

    const nameLen = view.getUint32(offset, true);
    offset += 4;
    if (offset + nameLen > data.byteLength) {
      return null;
    }
    const name = decoder.decode(data.subarray(offset, offset + nameLen));
    offset += nameLen;

    if (offset + 4 > data.byteLength) {
      return null;
    }
    const binLen = view.getUint32(offset, true);
    offset += 4;
    if (offset + binLen > data.byteLength) {
      return null;
    }
    const binary = data.slice(offset, offset + binLen);
    offset += binLen;

    if (offset + 4 > data.byteLength) {
      return null;
    }
    const rzdbLen = view.getUint32(offset, true);
    offset += 4;
    if (offset + rzdbLen > data.byteLength) {
      return null;
    }
    const rzdb = data.slice(offset, offset + rzdbLen);

    return { name, binary, rzdb };
  } catch {
    return null;
  }
}

// True when the bytes look like one of our bundles. Cheap magic-only check used
// by UI code that just needs to branch before doing the full decode.
export function isProjectBundle(data: Uint8Array): boolean {
  if (!data || data.byteLength < MAGIC_LEN) {
    return false;
  }
  return new TextDecoder().decode(data.subarray(0, MAGIC_LEN)) === MAGIC;
}
