import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TelegramAuthError, verifyTelegramInitData } from "./telegram-auth.js";

const botToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

function sign(values: Record<string, string>) {
  const dataCheckString = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

describe("verifyTelegramInitData", () => {
  it("accepts a correctly signed, fresh Telegram identity", () => {
    const initData = sign({
      auth_date: "1800000000",
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: JSON.stringify({ id: 99112233, first_name: "Mara", username: "mara" })
    });
    const result = verifyTelegramInitData(initData, botToken, { now: 1800000030, maxAgeSeconds: 600 });
    expect(result.user.id).toBe(99112233);
    expect(result.user.username).toBe("mara");
  });

  it("rejects tampering even when the user payload remains valid JSON", () => {
    const initData = sign({ auth_date: "1800000000", user: JSON.stringify({ id: 1, first_name: "A" }) });
    const tampered = initData.replace("first_name%22%3A%22A", "first_name%22%3A%22B");
    expect(() => verifyTelegramInitData(tampered, botToken, { now: 1800000030 })).toThrow(TelegramAuthError);
  });

  it("rejects replayed initData outside the configured age", () => {
    const initData = sign({ auth_date: "1700000000", user: JSON.stringify({ id: 1, first_name: "A" }) });
    expect(() => verifyTelegramInitData(initData, botToken, { now: 1800000000, maxAgeSeconds: 600 })).toThrow("Expired");
  });
});
