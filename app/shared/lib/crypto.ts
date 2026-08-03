const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface TimingSafeSubtleCrypto extends SubtleCrypto {
	timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
	return Uint8Array.from(bytes).buffer;
}

export function encodeBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeBase64Url(value: string): Uint8Array {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const binary = atob(padded);
	return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return encodeBase64Url(bytes);
}

export async function sha256Bytes(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sha256Hex(value: string): Promise<string> {
	const bytes = await sha256Bytes(value);
	return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Base64Url(value: string): Promise<string> {
	return encodeBase64Url(await sha256Bytes(value));
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
	return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
	const [leftHash, rightHash] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
	return (crypto.subtle as TimingSafeSubtleCrypto).timingSafeEqual(ownedBuffer(leftHash), ownedBuffer(rightHash));
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
	const keyMaterial = await sha256Bytes(`nycu.club oauth cookie:${secret}`);
	return crypto.subtle.importKey("raw", ownedBuffer(keyMaterial), "AES-GCM", false, ["decrypt", "encrypt"]);
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
	const iv = new Uint8Array(12);
	crypto.getRandomValues(iv);
	const key = await deriveAesKey(secret);
	const plaintext = encoder.encode(JSON.stringify(value));
	const ciphertext = await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, plaintext);
	return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptJson(value: string, secret: string): Promise<unknown> {
	const [ivValue, ciphertextValue, extra] = value.split(".");
	if (!ivValue || !ciphertextValue || extra) throw new Error("Invalid encrypted payload");
	const key = await deriveAesKey(secret);
	const plaintext = await crypto.subtle.decrypt({ iv: ownedBuffer(decodeBase64Url(ivValue)), name: "AES-GCM" }, key, ownedBuffer(decodeBase64Url(ciphertextValue)));
	return JSON.parse(decoder.decode(plaintext)) as unknown;
}
