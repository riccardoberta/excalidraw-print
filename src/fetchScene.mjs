import zlib from "node:zlib";

const BACKEND_GET_URL = "https://json.excalidraw.com/api/v2/";

const JSON_HASH_RE = /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/;
const ROOM_HASH_RE = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/;

/**
 * Resolves a (possibly shortened, link.excalidraw.com) URL to its final
 * app.excalidraw.com URL, by letting a real browser follow any client-side
 * redirect, then reads the resulting #json=id,key hash.
 */
export async function resolveShareLink(page, inputUrl) {
  await page.goto(inputUrl, { waitUntil: "domcontentloaded" });
  // link.excalidraw.com resolves the short link and rewrites the URL hash
  // client-side; give it a moment to settle.
  await page.waitForTimeout(1500);
  const finalUrl = page.url();
  const hash = new URL(finalUrl).hash;

  if (ROOM_HASH_RE.test(hash) || /^https:\/\/app\.excalidraw\.com\/l\//.test(finalUrl)) {
    // Excalidraw+ (app.excalidraw.com) room invite: no static export-link
    // protocol here, needs an actual join + in-app export instead.
    return { type: "room", url: finalUrl };
  }

  const match = hash.match(JSON_HASH_RE);
  if (!match) {
    throw new Error(
      `Non riesco a trovare un hash #json=id,key nell'URL risolto: ${finalUrl}`,
    );
  }

  return { type: "json", id: match[1], key: match[2] };
}

// -- byte-buffer helpers, mirroring excalidraw's concatBuffers/splitBuffers --

function readUint32BE(buf, offset) {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(
    offset,
  );
}

function splitBuffers(concatenated) {
  const buffers = [];
  let cursor = 4; // skip the leading 4-byte format version
  while (true) {
    const chunkSize = readUint32BE(concatenated, cursor);
    cursor += 4;
    buffers.push(concatenated.slice(cursor, cursor + chunkSize));
    cursor += chunkSize;
    if (cursor >= concatenated.byteLength) break;
  }
  return buffers;
}

async function importAesGcmKey(base64UrlKey) {
  return crypto.subtle.importKey(
    "jwk",
    {
      alg: "A128GCM",
      ext: true,
      k: base64UrlKey,
      key_ops: ["decrypt"],
      kty: "oct",
    },
    { name: "AES-GCM", length: 128 },
    false,
    ["decrypt"],
  );
}

/**
 * Downloads and decrypts an Excalidraw shared scene, returning the parsed
 * `{ elements, appState, files }` payload — mirrors excalidraw-app's
 * `importFromBackend` / `decompressData`.
 */
export async function fetchScene({ id, key }) {
  const res = await fetch(BACKEND_GET_URL + id);
  if (!res.ok) {
    throw new Error(
      `Download della scena fallito (HTTP ${res.status}) per id ${id}`,
    );
  }
  const outer = new Uint8Array(await res.arrayBuffer());

  const [encodingMetadataBuffer, iv, encryptedBuffer] = splitBuffers(outer);
  const encodingMetadata = JSON.parse(
    Buffer.from(encodingMetadataBuffer).toString("utf-8"),
  );

  const cryptoKey = await importAesGcmKey(key);
  const deflated = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      encryptedBuffer,
    ),
  );

  const inflated = encodingMetadata.compression
    ? new Uint8Array(zlib.inflateSync(Buffer.from(deflated)))
    : deflated;

  const [, contentsBuffer] = splitBuffers(inflated);
  const json = Buffer.from(contentsBuffer).toString("utf-8");
  const data = JSON.parse(json);

  return {
    elements: data.elements || [],
    appState: data.appState || {},
    files: data.files || {},
  };
}
