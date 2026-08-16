import type { SubscriptionStatus } from "@index/shared";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Services } from "../types.js";

export const PLUS_PRICE_STARS = 299 as const;
export const PLUS_PERIOD_SECONDS = 2_592_000;

const payloadSchema = z.tuple([
  z.literal("index-plus-v1"),
  z.string().uuid(),
  z.coerce.number().int().positive(),
  z.string().regex(/^[A-Za-z0-9_-]{22}$/)
]);

export function createPlusPayload(userId: string, telegramUserId: number) {
  return `index-plus-v1:${userId}:${telegramUserId}:${randomBytes(16).toString("base64url")}`;
}

export function parsePlusPayload(payload: string) {
  const result = payloadSchema.safeParse(payload.split(":"));
  if (!result.success) return null;
  return { userId: result.data[1], telegramUserId: result.data[2], nonce: result.data[3] };
}

export function validatePlusInvoice(payload: string, currency: string, amount: number, telegramUserId: number) {
  const identity = parsePlusPayload(payload);
  return identity && identity.telegramUserId === telegramUserId && currency === "XTR" && amount === PLUS_PRICE_STARS
    ? identity : null;
}

export async function subscriptionRecord(services: Services, userId: string) {
  const { data, error } = await services.db.from("subscriptions")
    .select("user_id,status,current_period_end,first_charge_id,latest_charge_id,cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as {
    user_id: string;
    status: "active" | "expired";
    current_period_end: string;
    first_charge_id: string;
    latest_charge_id: string;
    cancel_at_period_end: boolean;
  } | null;
}

export function isPlusActive(record: Awaited<ReturnType<typeof subscriptionRecord>>, now = Date.now()) {
  return Boolean(record && record.status === "active" && new Date(record.current_period_end).getTime() > now);
}

export function publicSubscriptionStatus(record: Awaited<ReturnType<typeof subscriptionRecord>>): SubscriptionStatus {
  const active = isPlusActive(record);
  return {
    plan: active ? "plus" : "free",
    priceStars: PLUS_PRICE_STARS,
    currentPeriodEnd: active ? record!.current_period_end : null,
    cancelAtPeriodEnd: active ? record!.cancel_at_period_end : false
  };
}
