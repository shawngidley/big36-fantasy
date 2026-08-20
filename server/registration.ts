import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SUPPORTED_LOGO_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export type RegistrationLogo = { bytes: Buffer; contentType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp" };

export function normalizeRegistrationEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeRegistrationPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const localNumber = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(localNumber)) throw new Error("Enter a valid U.S. 10-digit phone number.");
  return `+1${localNumber}`;
}

export function assertValidRegistrationPin(pin: string) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("Choose a PIN containing 4 to 12 digits.");
  if (/^(\d)\1+$/.test(pin)) throw new Error("Choose a PIN that is not a repeated single digit.");
}

export function hashRegistrationPin(pin: string) {
  assertValidRegistrationPin(pin);
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pin, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyRegistrationPin(pin: string, storedHash: string) {
  const [algorithm, salt, derived] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !derived) return false;
  const actual = scryptSync(pin, salt, 64);
  const expected = Buffer.from(derived, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hasExpectedImageHeader(contentType: string, bytes: Buffer) {
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  return bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
}

export function decodeRegistrationLogo(dataUrl: string): RegistrationLogo {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error("Upload a PNG, JPEG, or WebP team logo.");
  const contentType = match[1].toLowerCase() as RegistrationLogo["contentType"];
  const extension = SUPPORTED_LOGO_TYPES.get(contentType) as RegistrationLogo["extension"] | undefined;
  if (!extension) throw new Error("Upload a PNG, JPEG, or WebP team logo.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 1_500_000) throw new Error("Team logos must be no larger than 1.5 MB.");
  if (!hasExpectedImageHeader(contentType, bytes)) throw new Error("The uploaded logo file does not match its image type.");
  return { bytes, contentType, extension };
}
