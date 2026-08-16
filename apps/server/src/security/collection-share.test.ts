import { describe, expect, it } from "vitest";
import { createCollectionShareToken, hashCollectionShareToken, isCollectionShareToken } from "./collection-share.js";

describe("collection share capabilities", () => {
  it("creates high-entropy URL-safe tokens and stores only deterministic hashes", () => {
    const token = createCollectionShareToken();
    expect(isCollectionShareToken(token)).toBe(true);
    expect(hashCollectionShareToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCollectionShareToken(token)).toBe(hashCollectionShareToken(token));
  });

  it("rejects malformed capabilities", () => {
    expect(isCollectionShareToken("short")).toBe(false);
    expect(() => hashCollectionShareToken("short")).toThrow();
  });
});
