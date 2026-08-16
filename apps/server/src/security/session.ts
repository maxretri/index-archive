import { jwtVerify, SignJWT } from "jose";
import type { SessionUser } from "../types.js";

const issuer = "index-server";
const audience = "index-mini-app";
const previewAudience = "index-file-preview";

function key(secret: string) { return new TextEncoder().encode(secret); }

export async function createSession(user: SessionUser, secret: string, expiresIn = 86_400) {
  return new SignJWT({ telegramUserId: user.telegramUserId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(key(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"], issuer, audience });
  if (!payload.sub || typeof payload.telegramUserId !== "string") throw new Error("Invalid session");
  return { id: payload.sub, telegramUserId: payload.telegramUserId };
}

export async function createFilePreviewToken(userId: string, fileId: string, secret: string, expiresIn = 600) {
  return new SignJWT({ fileId, purpose: "file-preview" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(previewAudience)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(key(secret));
}

export async function verifyFilePreviewToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, key(secret), {
    algorithms: ["HS256"], issuer, audience: previewAudience
  });
  if (!payload.sub || typeof payload.fileId !== "string" || payload.purpose !== "file-preview") {
    throw new Error("Invalid file preview token");
  }
  return { userId: payload.sub, fileId: payload.fileId };
}
