/**
 * AES-256-GCM envelope encryption for OAuth integration tokens.
 *
 * Stored format: base64(iv) + "." + base64(ciphertext) + "." + base64(authTag)
 *
 * Key is provided via env.INTEGRATION_TOKEN_ENCRYPTION_KEY (32-byte base64).
 * Uses Node Web Crypto (node:crypto webcrypto).
 */
import { webcrypto } from "node:crypto";
const subtle = webcrypto.subtle;
const ALGO = "AES-GCM";
const IV_BYTES = 12;
async function importKey(rawBase64) {
    const raw = Uint8Array.from(Buffer.from(rawBase64, "base64"));
    if (raw.byteLength !== 32) {
        throw new Error("Encryption key must be 32 bytes (256-bit AES key)");
    }
    return subtle.importKey("raw", raw, ALGO, false, ["encrypt", "decrypt"]);
}
function b64(bytes) {
    return Buffer.from(bytes).toString("base64");
}
function unb64(s) {
    return Uint8Array.from(Buffer.from(s, "base64"));
}
export async function encrypt(plaintext, keyB64) {
    const key = await importKey(keyB64);
    const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = new Uint8Array(await subtle.encrypt({ name: ALGO, iv }, key, encoded));
    // Web Crypto AES-GCM appends the 16-byte auth tag to the ciphertext.
    const tagStart = ciphertext.length - 16;
    const ct = ciphertext.slice(0, tagStart);
    const tag = ciphertext.slice(tagStart);
    return `${b64(iv)}.${b64(ct)}.${b64(tag)}`;
}
export async function decrypt(envelope, keyB64) {
    const [ivB64, ctB64, tagB64] = envelope.split(".");
    if (!ivB64 || !ctB64 || !tagB64) {
        throw new Error("Malformed encrypted envelope");
    }
    const key = await importKey(keyB64);
    const iv = unb64(ivB64);
    const ct = unb64(ctB64);
    const tag = unb64(tagB64);
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const plaintext = await subtle.decrypt({ name: ALGO, iv }, key, combined);
    return new TextDecoder().decode(plaintext);
}
//# sourceMappingURL=encryption.js.map