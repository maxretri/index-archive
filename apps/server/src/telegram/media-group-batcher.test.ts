import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaGroupReplyBatcher } from "./media-group-batcher.js";

afterEach(() => vi.useRealTimers());

describe("Telegram media group reply batching", () => {
  it("sends one summary after the final item in an album", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const batcher = new MediaGroupReplyBatcher(send, vi.fn(), 1_000);

    batcher.add("42:album-1", 42, 100);
    await vi.advanceTimersByTimeAsync(600);
    batcher.add("42:album-1", 42, 101);
    batcher.add("42:album-1", 42, 102);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(42, 100, 3);
    batcher.close();
  });

  it("keeps albums from different chats separate", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const batcher = new MediaGroupReplyBatcher(send, vi.fn(), 100);
    batcher.add("42:same-id", 42, 1);
    batcher.add("84:same-id", 84, 2);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    batcher.close();
  });
});
