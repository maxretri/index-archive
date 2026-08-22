import { describe, expect, it } from "vitest";
import {
  createCollectionExportToken,
  createFilePreviewToken,
  createSession,
  verifyCollectionExportToken,
  verifyFilePreviewToken,
  verifySession
} from "./session.js";

describe("application sessions", () => {
  it("round-trips the server-owned user identity", async () => {
    const secret = "a-secure-test-secret-that-is-longer-than-32-characters";
    const token = await createSession({ id: "ab82ee1c-7b44-4af0-91a7-f99ec30d1d3a", telegramUserId: "442211" }, secret, 60);
    await expect(verifySession(token, secret)).resolves.toEqual({ id: "ab82ee1c-7b44-4af0-91a7-f99ec30d1d3a", telegramUserId: "442211" });
    await expect(verifySession(token, `${secret}-wrong`)).rejects.toThrow();
  });

  it("scopes a short-lived preview token to one user and one file", async () => {
    const secret = "a-secure-test-secret-that-is-longer-than-32-characters";
    const token = await createFilePreviewToken("user-id", "file-id", secret, 60);
    await expect(verifyFilePreviewToken(token, secret)).resolves.toEqual({ userId: "user-id", fileId: "file-id" });
    await expect(verifyFilePreviewToken(token, `${secret}-wrong`)).rejects.toThrow();
  });

  it("scopes a collection export token to one owner and collection", async () => {
    const secret = "a-secure-test-secret-that-is-longer-than-32-characters";
    const token = await createCollectionExportToken("user-id", "collection-id", secret, 60);
    await expect(verifyCollectionExportToken(token, secret)).resolves.toEqual({ userId: "user-id", collectionId: "collection-id" });
    await expect(verifyCollectionExportToken(token, `${secret}-wrong`)).rejects.toThrow();
  });
});
