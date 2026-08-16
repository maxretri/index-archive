import { z } from "zod";
import type { Services, TelegramCallbackQuery, TelegramMessage } from "../types.js";
import {
  answerCallback,
  sendCollectionPicker,
  sendCollectionStatus,
  sendNewCollectionPrompt
} from "./api.js";
import { upsertUser } from "./ingest.js";

const collectionIdSchema = z.string().uuid();

export function parseBotCommand(text: string | undefined) {
  if (!text) return null;
  const match = text.match(/^\/([A-Za-z]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), argument: match[2]?.trim() ?? "" };
}

async function collectionsForUser(services: Services, userId: string) {
  const { data, error } = await services.db.from("collections")
    .select("id,name")
    .eq("user_id", userId)
    .order("name")
    .limit(30);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
}

async function setActiveCollection(services: Services, userId: string, collectionId: string | null) {
  const { error } = await services.db.from("users")
    .update({ active_collection_id: collectionId })
    .eq("id", userId);
  if (error) throw error;
}

async function chooseById(services: Services, userId: string, collectionId: string) {
  const { data, error } = await services.db.from("collections")
    .select("id,name")
    .eq("user_id", userId)
    .eq("id", collectionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await setActiveCollection(services, userId, data.id as string);
  return data.name as string;
}

async function chooseByName(services: Services, userId: string, name: string) {
  const { data, error } = await services.db.from("collections")
    .select("id,name")
    .eq("user_id", userId)
    .eq("name", name.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await setActiveCollection(services, userId, data.id as string);
  return data.name as string;
}

async function createAndSelect(services: Services, userId: string, rawName: string) {
  const parsed = z.string().trim().min(1).max(80).safeParse(rawName);
  if (!parsed.success) return null;
  const name = parsed.data.toUpperCase();
  const { data, error } = await services.db.from("collections")
    .insert({ user_id: userId, name })
    .select("id,name")
    .single();
  if (error?.code === "23505") return chooseByName(services, userId, name);
  if (error) throw error;
  await setActiveCollection(services, userId, data.id as string);
  return data.name as string;
}

export async function handleCollectionCommand(services: Services, message: TelegramMessage) {
  const command = parseBotCommand(message.text);
  if (!command || !message.from || message.from.is_bot || message.chat.type !== "private") return false;
  if (!["collection", "collections", "newcollection", "nocollection"].includes(command.name)) return false;

  const user = await upsertUser(services, message.from);
  if (command.name === "nocollection") {
    await setActiveCollection(services, user.id, null);
    await sendCollectionStatus(services.config, message.chat.id, null);
    return true;
  }
  if (command.name === "newcollection") {
    if (!command.argument) {
      await sendNewCollectionPrompt(services.config, message.chat.id);
      return true;
    }
    const name = await createAndSelect(services, user.id, command.argument);
    if (!name) await sendNewCollectionPrompt(services.config, message.chat.id);
    else await sendCollectionStatus(services.config, message.chat.id, name);
    return true;
  }
  if (command.name === "collection" && command.argument) {
    const name = await chooseByName(services, user.id, command.argument);
    if (name) await sendCollectionStatus(services.config, message.chat.id, name);
    else await sendCollectionPicker(services.config, message.chat.id, await collectionsForUser(services, user.id), user.active_collection_id);
    return true;
  }

  await sendCollectionPicker(
    services.config,
    message.chat.id,
    await collectionsForUser(services, user.id),
    user.active_collection_id
  );
  return true;
}

export async function handleCollectionCallback(services: Services, callback: TelegramCallbackQuery) {
  if (!callback.data?.startsWith("index:collection:")) return false;
  const chatId = callback.message?.chat.id ?? callback.from.id;
  const action = callback.data.slice("index:collection:".length);
  const user = await upsertUser(services, callback.from);

  if (action === "new") {
    await answerCallback(services.config, callback.id);
    await sendNewCollectionPrompt(services.config, chatId);
    return true;
  }
  if (action === "none") {
    await setActiveCollection(services, user.id, null);
    await answerCallback(services.config, callback.id, "No active collection");
    await sendCollectionStatus(services.config, chatId, null);
    return true;
  }
  if (!collectionIdSchema.safeParse(action).success) {
    await answerCallback(services.config, callback.id, "Collection unavailable");
    return true;
  }
  const name = await chooseById(services, user.id, action);
  await answerCallback(services.config, callback.id, name ? `Selected: ${name}` : "Collection unavailable");
  if (name) await sendCollectionStatus(services.config, chatId, name);
  return true;
}
