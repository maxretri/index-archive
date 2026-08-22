import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getCachedFiles, getSession, setSession } from "./api";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

function sessionToken(telegramUserId: string, expiresAt = Math.floor(Date.now() / 1000) + 600) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode({ sub: "0ef7b033-7cb4-4f9e-90ef-f08e77414f5a", telegramUserId, exp: expiresAt })}.signature`;
}

describe("fast returning sessions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists a valid session and rejects another Telegram identity", () => {
    const token = sessionToken("778899");
    setSession(token);
    expect(getSession("778899")).toBe(token);
    expect(getSession("112233")).toBeNull();
    expect(localStorage.getItem("index.session")).toBeNull();
  });

  it("does not reuse an expired session", () => {
    setSession(sessionToken("778899", Math.floor(Date.now() / 1000) - 1));
    expect(getSession("778899")).toBeNull();
  });

  it("keeps the first library page ready for the next launch", async () => {
    setSession(sessionToken("778899"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    await api.files({ filter: "all" });
    expect(getCachedFiles({ filter: "all" })?.data).toEqual({ items: [], nextCursor: null });
  });
});
