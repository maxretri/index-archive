import { describe, expect, it } from "vitest";
import { isStartCommand } from "./webhook.js";

describe("Telegram welcome command", () => {
  it.each(["/start", "/start payload", "/start@indexarchivebot"])("accepts %s", (text) => {
    expect(isStartCommand(text)).toBe(true);
  });

  it.each([undefined, "start", "/starter", "hello /start"])("ignores %s", (text) => {
    expect(isStartCommand(text)).toBe(false);
  });
});
