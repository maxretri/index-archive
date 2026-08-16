import type { Services, TelegramMessage } from "../types.js";
import { hashCollectionShareToken, isCollectionShareToken } from "../security/collection-share.js";
import { copyTelegramMessages, sendSharedCollectionOpen, sendSharedCollectionUnavailable } from "./api.js";

const CHAT_DELIVERY_LIMIT = 100;

export function sharedCollectionTokenFromStart(text: string | undefined) {
  if (!text) return null;
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+collection_([A-Za-z0-9_-]{43})$/);
  return match?.[1] && isCollectionShareToken(match[1]) ? match[1] : null;
}

export async function handleSharedCollectionStart(services: Services, message: TelegramMessage) {
  const token = sharedCollectionTokenFromStart(message.text);
  if (!token || !message.from || message.from.is_bot || message.chat.type !== "private") return false;

  const { data: share, error: shareError } = await services.db.from("collection_shares")
    .select("user_id,collection_id")
    .eq("token_hash", hashCollectionShareToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (shareError) throw shareError;
  if (!share) {
    await sendSharedCollectionUnavailable(services.config, message.chat.id);
    return true;
  }

  const [{ data: collection, error: collectionError }, countResult, { data: memberships, error: membershipsError }] = await Promise.all([
    services.db.from("collections").select("id,name")
      .eq("user_id", share.user_id).eq("id", share.collection_id).maybeSingle(),
    services.db.from("collection_files").select("file_id", { count: "exact", head: true })
      .eq("user_id", share.user_id).eq("collection_id", share.collection_id),
    services.db.from("collection_files")
      .select("created_at,files!inner(telegram_chat_id,telegram_message_id)")
      .eq("user_id", share.user_id)
      .eq("collection_id", share.collection_id)
      .order("created_at", { ascending: true })
      .limit(CHAT_DELIVERY_LIMIT)
  ]);
  if (collectionError) throw collectionError;
  if (countResult.error) throw countResult.error;
  if (membershipsError) throw membershipsError;
  if (!collection) {
    await sendSharedCollectionUnavailable(services.config, message.chat.id);
    return true;
  }

  const messagesByChat = new Map<number, number[]>();
  for (const membership of memberships ?? []) {
    const related = membership.files as unknown as
      | { telegram_chat_id?: number | string; telegram_message_id?: number | string }
      | Array<{ telegram_chat_id?: number | string; telegram_message_id?: number | string }>
      | null;
    const file = Array.isArray(related) ? related[0] : related;
    const sourceChatId = Number(file?.telegram_chat_id);
    const sourceMessageId = Number(file?.telegram_message_id);
    if (!Number.isSafeInteger(sourceChatId) || !Number.isSafeInteger(sourceMessageId)) continue;
    messagesByChat.set(sourceChatId, [...(messagesByChat.get(sourceChatId) ?? []), sourceMessageId]);
  }

  let copiedCount = 0;
  for (const [sourceChatId, messageIds] of messagesByChat) {
    try {
      const copied = await copyTelegramMessages(services.config, message.chat.id, sourceChatId, messageIds);
      copiedCount += copied.length;
    } catch {
      // The collection remains available in the Mini App if Telegram can no longer copy a source message.
    }
  }

  await sendSharedCollectionOpen(services.config, message.chat.id, {
    name: collection.name as string,
    itemCount: countResult.count ?? 0
  }, token, {
    copiedCount,
    truncated: (countResult.count ?? 0) > CHAT_DELIVERY_LIMIT
  });
  return true;
}
