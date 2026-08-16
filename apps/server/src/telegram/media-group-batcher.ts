interface PendingGroup {
  chatId: number;
  firstMessageId: number;
  itemCount: number;
  collectionName: string | null;
  timer: ReturnType<typeof setTimeout>;
}

type Sender = (chatId: number, messageId: number, itemCount: number, collectionName: string | null) => Promise<unknown>;

export class MediaGroupReplyBatcher {
  private readonly groups = new Map<string, PendingGroup>();

  constructor(
    private readonly send: Sender,
    private readonly onError: (error: unknown) => void,
    private readonly delayMs = 2_500
  ) {}

  add(key: string, chatId: number, messageId: number, collectionName: string | null = null) {
    const current = this.groups.get(key);
    if (current) clearTimeout(current.timer);
    const next = {
      chatId,
      firstMessageId: current?.firstMessageId ?? messageId,
      itemCount: (current?.itemCount ?? 0) + 1,
      collectionName: current?.collectionName ?? collectionName,
      timer: setTimeout(() => { void this.flush(key); }, this.delayMs)
    };
    this.groups.set(key, next);
  }

  close() {
    for (const group of this.groups.values()) clearTimeout(group.timer);
    this.groups.clear();
  }

  private async flush(key: string) {
    const group = this.groups.get(key);
    if (!group) return;
    this.groups.delete(key);
    try {
      await this.send(group.chatId, group.firstMessageId, group.itemCount, group.collectionName);
    } catch (error) {
      this.onError(error);
    }
  }
}
