import { describe, expect, it } from "vitest";
import { assertValidRegistrationPin, decodeRegistrationLogo, hashRegistrationPin, normalizeRegistrationPhone, verifyRegistrationPin } from "./registration";

describe("owner registration safeguards", () => {
  it("normalizes a submitted phone number to a private E.164 storage value", () => {
    expect(normalizeRegistrationPhone("(555) 555-0182")).toBe("+5555550182");
    expect(() => normalizeRegistrationPhone("1234")).toThrow("valid phone number");
  });

  it("stores verifiable salted PIN hashes instead of the submitted PIN", () => {
    const hash = hashRegistrationPin("482917");
    expect(hash).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
    expect(hash).not.toContain("482917");
    expect(verifyRegistrationPin("482917", hash)).toBe(true);
    expect(verifyRegistrationPin("482918", hash)).toBe(false);
    expect(() => assertValidRegistrationPin("1111")).toThrow("repeated");
  });

  it("accepts only small image payloads whose bytes match the declared logo type", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(decodeRegistrationLogo(png)).toMatchObject({ contentType: "image/png", extension: "png" });
    expect(() => decodeRegistrationLogo("data:image/png;base64,SGVsbG8=")).toThrow("does not match");
    expect(() => decodeRegistrationLogo("data:image/svg+xml;base64,PHN2Zy8+")).toThrow("PNG, JPEG, or WebP");
  });
});
