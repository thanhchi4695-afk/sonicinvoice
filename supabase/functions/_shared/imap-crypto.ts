// _shared encryption helpers for storing IMAP app passwords at rest.
// Uses AES-GCM with a key derived from IMAP_ENCRYPTION_KEY env var.

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("IMAP_ENCRYPTION_KEY");
  if (!raw) throw new Error("IMAP_ENCRYPTION_KEY not configured");
  // Derive 32-byte key from the secret via SHA-256 — accepts any length input.
  const keyBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
  );
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptString(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return { ciphertext: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
}

export async function decryptString(ciphertextB64: string, ivB64: string): Promise<string> {
  const key = await getKey();
  const ct = b64ToBytes(ciphertextB64);
  const iv = b64ToBytes(ivB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
