import { describe, expect, it } from "vitest";
import { createSession, verifySession } from "./session.js";

describe("application sessions", () => {
  it("round-trips the server-owned user identity", async () => {
    const secret = "a-secure-test-secret-that-is-longer-than-32-characters";
    const token = await createSession({ id: "ab82ee1c-7b44-4af0-91a7-f99ec30d1d3a", telegramUserId: "442211" }, secret, 60);
    await expect(verifySession(token, secret)).resolves.toEqual({ id: "ab82ee1c-7b44-4af0-91a7-f99ec30d1d3a", telegramUserId: "442211" });
    await expect(verifySession(token, `${secret}-wrong`)).rejects.toThrow();
  });
});
