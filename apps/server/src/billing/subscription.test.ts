import { describe, expect, it } from "vitest";
import { createPlusPayload, isPlusActive, parsePlusPayload, publicSubscriptionStatus, validatePlusInvoice } from "./subscription.js";

describe("INDEX PLUS billing rules", () => {
  it("binds invoice payloads to the internal and Telegram user identities", () => {
    const userId = "81a41446-c8ce-4b53-a8a7-9080c5b31ba1";
    expect(parsePlusPayload(createPlusPayload(userId, 998877))).toMatchObject({ userId, telegramUserId: 998877 });
    expect(parsePlusPayload("index-plus-v1:not-a-uuid:998877")).toBeNull();
  });

  it("grants PLUS only before the server-owned period end", () => {
    const record = {
      user_id: "user", status: "active" as const, current_period_end: "2030-01-01T00:00:00.000Z",
      first_charge_id: "first", latest_charge_id: "latest", cancel_at_period_end: true
    };
    expect(isPlusActive(record, Date.parse("2029-12-01"))).toBe(true);
    expect(isPlusActive(record, Date.parse("2030-02-01"))).toBe(false);
    expect(publicSubscriptionStatus(record)).toMatchObject({ priceStars: 299 });
  });

  it("rejects altered price, currency, or Telegram identity", () => {
    const payload = createPlusPayload("81a41446-c8ce-4b53-a8a7-9080c5b31ba1", 998877);
    expect(validatePlusInvoice(payload, "XTR", 299, 998877)).not.toBeNull();
    expect(validatePlusInvoice(payload, "XTR", 298, 998877)).toBeNull();
    expect(validatePlusInvoice(payload, "USD", 299, 998877)).toBeNull();
    expect(validatePlusInvoice(payload, "XTR", 299, 112233)).toBeNull();
  });
});
