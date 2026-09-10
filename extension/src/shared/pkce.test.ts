import { describe, expect, it } from "vitest";
import { base64urlEncode, codeChallengeFor, generateCodeVerifier, randomString } from "./pkce.js";

describe("base64urlEncode", () => {
  it("encodes bytes to unpadded base64url", () => {
    // 0x00 0xFF 0x10 -> "AP8Q" in standard base64, no +/ so unchanged in base64url
    expect(base64urlEncode(new Uint8Array([0x00, 0xff, 0x10]))).toBe("AP8Q");
  });

  it("maps +/ to -_ and strips padding", () => {
    // 0xFB 0xEF 0xBE 0xEF -> standard base64 "++++7w=" -> base64url "----7w"
    expect(base64urlEncode(new Uint8Array([0xfb, 0xef, 0xbe, 0xef]))).toBe("----7w");
  });
});

describe("codeChallengeFor (S256)", () => {
  it("matches an independently computed SHA-256 vector", async () => {
    // Cross-checked with both Node crypto and Python hashlib:
    //   base64url(sha256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXw"))
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXw";
    await expect(codeChallengeFor(verifier)).resolves.toBe("LjpMKJRsJ-95DtvIeU9GCxhTWmmqrdNTCHRavuE4Z7U");
  });
});

describe("generateCodeVerifier", () => {
  it("is 64 chars of the RFC 7636 unreserved set", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(verifier).toHaveLength(64);
  });

  it("produces different verifiers on each call", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("randomString", () => {
  it("respects the requested length and charset", () => {
    expect(randomString(24)).toMatch(/^[A-Za-z0-9\-._~]{24}$/);
  });
});
