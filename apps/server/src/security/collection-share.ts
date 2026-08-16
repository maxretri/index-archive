import { createHash, randomBytes } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createCollectionShareToken() {
  return randomBytes(32).toString("base64url");
}

export function isCollectionShareToken(value: string) {
  return tokenPattern.test(value);
}

export function hashCollectionShareToken(value: string) {
  if (!isCollectionShareToken(value)) throw new Error("Invalid collection share token");
  return createHash("sha256").update(value).digest("hex");
}
