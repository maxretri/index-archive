import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TelegramUser } from "../types.js";

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean().optional(),
  first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional()
});

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
  queryId?: string;
}

export class TelegramAuthError extends Error {}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { now?: number; maxAgeSeconds?: number } = {}
): VerifiedInitData {
  if (!initData || initData.length > 16_384) throw new TelegramAuthError("Invalid initData");

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f\d]{64}$/i.test(receivedHash)) {
    throw new TelegramAuthError("Missing or invalid signature");
  }

  const entries = [...params.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const received = Buffer.from(receivedHash, "hex");
  if (received.length !== expectedHash.length || !timingSafeEqual(received, expectedHash)) {
    throw new TelegramAuthError("Invalid Telegram signature");
  }

  const authDate = Number(params.get("auth_date"));
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 600;
  if (!Number.isSafeInteger(authDate) || authDate > now + 30 || now - authDate > maxAge) {
    throw new TelegramAuthError("Expired Telegram authentication");
  }

  const rawUser = params.get("user");
  if (!rawUser) throw new TelegramAuthError("Telegram user is missing");
  let parsed: unknown;
  try { parsed = JSON.parse(rawUser); } catch { throw new TelegramAuthError("Invalid Telegram user"); }
  const user = telegramUserSchema.safeParse(parsed);
  if (!user.success || user.data.is_bot) throw new TelegramAuthError("Invalid Telegram user");

  return { user: user.data, authDate, queryId: params.get("query_id") ?? undefined };
}
