import type { Services, TelegramMessage } from "../types.js";
import { hashCollectionShareToken, isCollectionShareToken } from "../security/collection-share.js";
import { copyTelegramMessages, sendSharedCollectionOpen, sendSharedCollectionUnavailable } from "./api.js";
import { upsertUser } from "./ingest.js";

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
    .select("id,user_id,collection_id")
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

  const recipient = await upsertUser(services, message.from);
  let grantId: string | undefined;
  let alreadyAccepted = recipient.id === share.user_id;
  if (recipient.id !== share.user_id) {
    const grantInput = {
      share_id: share.id,
      collection_id: share.collection_id,
      owner_user_id: share.user_id,
      recipient_user_id: recipient.id,
      accepted_at: new Date().toISOString()
    };
    const { data: createdGrant, error: createGrantError } = await services.db.from("collection_share_recipients")
      .insert(grantInput).select("id").single();
    if (!createGrantError && createdGrant) {
      grantId = createdGrant.id as string;
    } else if ((createGrantError as { code?: string } | null)?.code === "23505") {
      const { data: existingGrant, error: existingGrantError } = await services.db.from("collection_share_recipients")
        .select("id")
        .eq("collection_id", share.collection_id)
        .eq("recipient_user_id", recipient.id)
        .maybeSingle();
      if (existingGrantError) throw existingGrantError;
      if (!existingGrant) throw createGrantError;
      const { data: refreshedGrant, error: refreshGrantError } = await services.db.from("collection_share_recipients")
        .update({ share_id: share.id, owner_user_id: share.user_id })
        .eq("id", existingGrant.id)
        .eq("recipient_user_id", recipient.id)
        .select("id")
        .single();
      if (refreshGrantError) throw refreshGrantError;
      grantId = refreshedGrant.id as string;
      alreadyAccepted = true;
    } else {
      throw createGrantError;
    }
  }

  let copiedCount = 0;
  if (!alreadyAccepted) {
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
    for (const [sourceChatId, messageIds] of messagesByChat) {
      try {
        const sortedMessageIds = [...new Set(messageIds)].sort((left, right) => left - right);
        const copied = await copyTelegramMessages(services.config, message.chat.id, sourceChatId, sortedMessageIds);
        copiedCount += copied.length;
      } catch {
        // The collection remains available in the Mini App if Telegram can no longer copy a source message.
      }
    }
  }

  await sendSharedCollectionOpen(services.config, message.chat.id, {
    name: collection.name as string,
    itemCount: countResult.count ?? 0
  }, token, {
    copiedCount,
    truncated: (countResult.count ?? 0) > CHAT_DELIVERY_LIMIT,
    grantId,
    alreadyAccepted
  });
  return true;
}
