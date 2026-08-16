import type { Services, TelegramMessage } from "../types.js";
import { hashCollectionShareToken, isCollectionShareToken } from "../security/collection-share.js";
import { sendSharedCollectionOpen, sendSharedCollectionUnavailable } from "./api.js";

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

  const [{ data: collection, error: collectionError }, countResult] = await Promise.all([
    services.db.from("collections").select("id,name")
      .eq("user_id", share.user_id).eq("id", share.collection_id).maybeSingle(),
    services.db.from("collection_files").select("file_id", { count: "exact", head: true })
      .eq("user_id", share.user_id).eq("collection_id", share.collection_id)
  ]);
  if (collectionError) throw collectionError;
  if (countResult.error) throw countResult.error;
  if (!collection) {
    await sendSharedCollectionUnavailable(services.config, message.chat.id);
    return true;
  }

  await sendSharedCollectionOpen(services.config, message.chat.id, {
    name: collection.name as string,
    itemCount: countResult.count ?? 0
  }, token);
  return true;
}
