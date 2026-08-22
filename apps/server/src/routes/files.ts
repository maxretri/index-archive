import { Readable } from "node:stream";
import type { ArchiveFile, FileType, LibraryFilter } from "@index/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "../types.js";
import { createFilePreviewToken, verifyFilePreviewToken } from "../security/session.js";
import { deleteTelegramMessages, preparePhotoShare, resolveTelegramFile } from "../telegram/api.js";

const idSchema = z.string().uuid();
const listSchema = z.object({
  filter: z.enum(["all", "photos", "videos", "files", "audio", "favorites"]).default("all"),
  q: z.string().trim().max(120).optional(),
  collectionId: z.string().uuid().optional(),
  tag: z.string().trim().max(40).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30)
});

interface FileRow {
  id: string; file_type: FileType; mime_type: string | null; filename: string | null;
  file_size: number | null; width: number | null; height: number | null; duration: number | null;
  created_at: string; is_favorite: boolean;
}

function encodeCursor(row: FileRow) {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(value) && typeof value[0] === "string" && idSchema.safeParse(value[1]).success
      ? [value[0], value[1]] : null;
  } catch { return null; }
}

function mapFile(row: FileRow, tags: string[], collectionIds: string[]): ArchiveFile {
  return {
    id: row.id, type: row.file_type, mimeType: row.mime_type, filename: row.filename,
    fileSize: row.file_size, width: row.width, height: row.height, duration: row.duration,
    createdAt: row.created_at, isFavorite: row.is_favorite, tags, collectionIds
  };
}

export function fileTypesForFilter(filter: LibraryFilter): FileType[] | null {
  if (filter === "photos") return ["photo"];
  if (filter === "videos") return ["video"];
  if (filter === "files") return ["document"];
  if (filter === "audio") return ["audio"];
  return null;
}

function applyTypeFilter<T extends { eq: (column: string, value: unknown) => T; in: (column: string, values: unknown[]) => T }>(query: T, filter: LibraryFilter) {
  const fileTypes = fileTypesForFilter(filter);
  if (fileTypes?.length === 1) return query.eq("file_type", fileTypes[0]);
  if (filter === "favorites") return query.eq("is_favorite", true);
  return query;
}

export async function fileRoutes(app: FastifyInstance, services: Services, authenticate: ReturnType<typeof import("../security/authenticate.js").authenticator>) {
  app.get("/api/files", { preHandler: authenticate }, async (request, reply) => {
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid library query" });
    const userId = request.sessionUser!.id;
    const input = parsed.data;
    let constrainedIds: string[] | null = null;

    if (input.q) {
      const { data, error } = await services.db.rpc("search_index_file_ids", { p_user_id: userId, p_query: input.q });
      if (error) throw error;
      constrainedIds = (data ?? []).map((row: { file_id: string }) => row.file_id);
    }

    if (input.collectionId) {
      const { data, error } = await services.db.from("collection_files").select("file_id")
        .eq("user_id", userId).eq("collection_id", input.collectionId);
      if (error) throw error;
      const collectionIds = new Set((data ?? []).map((row) => row.file_id as string));
      constrainedIds = constrainedIds ? constrainedIds.filter((id) => collectionIds.has(id)) : [...collectionIds];
    }
    if (input.tag) {
      const { data, error } = await services.db.from("file_tags").select("file_id,tags!inner(name)")
        .eq("user_id", userId).eq("tags.name", input.tag);
      if (error) throw error;
      const tagIds = new Set((data ?? []).map((row) => row.file_id as string));
      constrainedIds = constrainedIds ? constrainedIds.filter((id) => tagIds.has(id)) : [...tagIds];
    }
    if (constrainedIds?.length === 0) return reply.send({ items: [], nextCursor: null });

    let query = services.db.from("files")
      .select("id,file_type,mime_type,filename,file_size,width,height,duration,created_at,is_favorite")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(input.limit + 1);
    query = applyTypeFilter(query, input.filter);
    if (input.from) query = query.gte("created_at", input.from);
    if (input.to) query = query.lte("created_at", input.to);
    if (constrainedIds) query = query.in("id", constrainedIds);
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      if (!cursor) return reply.code(400).send({ error: "Invalid cursor" });
      query = query.or(`created_at.lt.${cursor[0]},and(created_at.eq.${cursor[0]},id.lt.${cursor[1]})`);
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as FileRow[];
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const ids = page.map((row) => row.id);
    const tagsByFile = new Map<string, string[]>();
    const collectionsByFile = new Map<string, string[]>();
    if (ids.length) {
      const [tagResult, collectionResult] = await Promise.all([
        services.db.from("file_tags").select("file_id,tags(name)").eq("user_id", userId).in("file_id", ids),
        services.db.from("collection_files").select("file_id,collection_id").eq("user_id", userId).in("file_id", ids)
      ]);
      if (tagResult.error) throw tagResult.error;
      if (collectionResult.error) throw collectionResult.error;
      for (const relation of tagResult.data ?? []) {
        const tag = relation.tags as unknown as { name: string } | null;
        if (tag) tagsByFile.set(relation.file_id as string, [...(tagsByFile.get(relation.file_id as string) ?? []), tag.name]);
      }
      for (const relation of collectionResult.data ?? []) {
        collectionsByFile.set(relation.file_id as string, [...(collectionsByFile.get(relation.file_id as string) ?? []), relation.collection_id as string]);
      }
    }
    const items = page.map((row) => mapFile(row, tagsByFile.get(row.id) ?? [], collectionsByFile.get(row.id) ?? []));
    return reply.send({ items, nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null });
  });

  app.get("/api/files/:id/content", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const query = z.object({ variant: z.enum(["thumbnail", "original"]).default("original"), download: z.coerce.boolean().default(false) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid file request" });
    const { data, error } = await services.db.from("files")
      .select("telegram_file_id,telegram_thumbnail_file_id,mime_type,filename")
      .eq("user_id", request.sessionUser!.id).eq("id", params.data.id).maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: "File not found" });
    const telegramFileId = query.data.variant === "thumbnail" && data.telegram_thumbnail_file_id
      ? data.telegram_thumbnail_file_id as string : data.telegram_file_id as string;
    const telegramUrl = await resolveTelegramFile(services.config, telegramFileId);
    const upstream = await fetch(telegramUrl);
    if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: "Telegram file unavailable" });
    reply.header("content-type", data.mime_type ?? upstream.headers.get("content-type") ?? "application/octet-stream");
    reply.header("cache-control", query.data.variant === "thumbnail" ? "private, max-age=86400" : "private, max-age=3600");
    if (query.data.download) {
      const safeName = String(data.filename ?? `index-${params.data.id}`).replace(/["\r\n]/g, "_");
      reply.header("content-disposition", `attachment; filename="${safeName}"`);
    }
    return reply.send(Readable.fromWeb(upstream.body as never));
  });

  app.post("/api/files/delete", {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const body = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(200) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Select files to delete" });
    const userId = request.sessionUser!.id;
    const fileIds = [...new Set(body.data.fileIds)];
    const { data: ownedFiles, error: readError } = await services.db.from("files")
      .select("id,telegram_chat_id,telegram_message_id")
      .eq("user_id", userId)
      .in("id", fileIds);
    if (readError) throw readError;
    if ((ownedFiles?.length ?? 0) !== fileIds.length) {
      return reply.code(404).send({ error: "One or more files were not found" });
    }

    const { data: deleted, error: deleteError } = await services.db.from("files")
      .delete()
      .eq("user_id", userId)
      .in("id", fileIds)
      .select("id");
    if (deleteError) throw deleteError;
    if ((deleted?.length ?? 0) !== fileIds.length) throw new Error("File deletion was incomplete");

    let telegramCleanup = true;
    const messagesByChat = new Map<number, number[]>();
    for (const file of ownedFiles ?? []) {
      const chatId = Number(file.telegram_chat_id);
      const messageId = Number(file.telegram_message_id);
      if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) {
        telegramCleanup = false;
        continue;
      }
      messagesByChat.set(chatId, [...(messagesByChat.get(chatId) ?? []), messageId]);
    }
    for (const [chatId, messageIds] of messagesByChat) {
      for (let offset = 0; offset < messageIds.length; offset += 100) {
        try {
          await deleteTelegramMessages(services.config, chatId, messageIds.slice(offset, offset + 100));
        } catch {
          telegramCleanup = false;
        }
      }
    }
    return reply.send({ deletedIds: fileIds, telegramCleanup });
  });

  app.post("/api/files/:id/preview-token", {
    preHandler: authenticate,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ id: idSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid file request" });
    const token = await createFilePreviewToken(request.sessionUser!.id, params.data.id, services.config.SESSION_SECRET);
    return reply.send({ token, expiresIn: 600 });
  });

  app.get("/api/files/:id/preview", {
    logLevel: "silent",
    config: { rateLimit: { max: 180, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ id: idSchema }).safeParse(request.params);
    const query = z.object({ access: z.string().min(20).max(4096) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid preview request" });

    let preview: { userId: string; fileId: string };
    try {
      preview = await verifyFilePreviewToken(query.data.access, services.config.SESSION_SECRET);
    } catch {
      return reply.code(401).send({ error: "Invalid or expired preview" });
    }
    if (preview.fileId !== params.data.id) return reply.code(401).send({ error: "Invalid preview file" });

    const { data, error } = await services.db.from("files")
      .select("telegram_file_id,mime_type,filename")
      .eq("user_id", preview.userId)
      .eq("id", params.data.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: "File not found" });

    const telegramUrl = await resolveTelegramFile(services.config, data.telegram_file_id as string);
    const range = typeof request.headers.range === "string" && /^bytes=\d*-\d*$/.test(request.headers.range)
      ? request.headers.range : undefined;
    const upstream = await fetch(telegramUrl, { headers: range ? { range } : undefined });
    if ((!upstream.ok && upstream.status !== 206) || !upstream.body) {
      return reply.code(upstream.status === 416 ? 416 : 502).send({ error: "Telegram file unavailable" });
    }

    reply.code(upstream.status === 206 ? 206 : 200);
    reply.header("content-type", data.mime_type ?? upstream.headers.get("content-type") ?? "application/octet-stream");
    reply.header("accept-ranges", upstream.headers.get("accept-ranges") ?? "bytes");
    reply.header("cache-control", "private, max-age=600");
    reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(data.filename ?? `index-${params.data.id}`))}`);
    for (const header of ["content-length", "content-range", "etag", "last-modified"] as const) {
      const value = upstream.headers.get(header);
      if (value) reply.header(header, value);
    }
    return reply.send(Readable.fromWeb(upstream.body as never));
  });

  app.post("/api/files/:id/share", {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid share request" });
    const { data, error } = await services.db.from("files")
      .select("telegram_file_id,file_type")
      .eq("user_id", request.sessionUser!.id)
      .eq("id", params.data.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: "File not found" });
    if (data.file_type !== "photo") return reply.code(400).send({ error: "Only photos can be forwarded" });

    const telegramUserId = Number(request.sessionUser!.telegramUserId);
    if (!Number.isSafeInteger(telegramUserId)) return reply.code(400).send({ error: "Invalid Telegram user" });
    const prepared = await preparePhotoShare(services.config, telegramUserId, data.telegram_file_id as string);
    return reply.send({ messageId: prepared.id, expiresAt: prepared.expiration_date });
  });

  app.patch("/api/files/:id/favorite", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ favorite: z.boolean() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid favorite request" });
    const { data, error } = await services.db.from("files").update({ is_favorite: body.data.favorite })
      .eq("user_id", request.sessionUser!.id).eq("id", params.data.id).select("id,is_favorite").maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: "File not found" });
    return reply.send({ id: data.id, isFavorite: data.is_favorite });
  });

  app.put("/api/files/:id/collections", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ collectionIds: z.array(z.string().uuid()).max(100) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid collection request" });
    const userId = request.sessionUser!.id;
    const [{ data: file }, { data: collections, error: collectionsError }] = await Promise.all([
      services.db.from("files").select("id").eq("user_id", userId).eq("id", params.data.id).maybeSingle(),
      services.db.from("collections").select("id").eq("user_id", userId).in("id", body.data.collectionIds)
    ]);
    if (collectionsError) throw collectionsError;
    if (!file) return reply.code(404).send({ error: "File not found" });
    if ((collections?.length ?? 0) !== new Set(body.data.collectionIds).size) return reply.code(400).send({ error: "Unknown collection" });
    const { error: deleteError } = await services.db.from("collection_files").delete().eq("user_id", userId).eq("file_id", params.data.id);
    if (deleteError) throw deleteError;
    if (body.data.collectionIds.length) {
      const { error } = await services.db.from("collection_files").insert(body.data.collectionIds.map((collectionId) => ({ collection_id: collectionId, file_id: params.data.id, user_id: userId })));
      if (error) throw error;
    }
    return reply.send({ collectionIds: body.data.collectionIds });
  });

  app.put("/api/files/:id/tags", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(20) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid tag request" });
    const userId = request.sessionUser!.id;
    const names = [...new Set(body.data.tags.map((tag) => tag.toUpperCase()))];
    const { data: file } = await services.db.from("files").select("id").eq("user_id", userId).eq("id", params.data.id).maybeSingle();
    if (!file) return reply.code(404).send({ error: "File not found" });
    const { error: deleteError } = await services.db.from("file_tags").delete().eq("user_id", userId).eq("file_id", params.data.id);
    if (deleteError) throw deleteError;
    if (names.length) {
      const { data: tags, error: tagError } = await services.db.from("tags").upsert(names.map((name) => ({ name, user_id: userId })), { onConflict: "user_id,name" }).select("id");
      if (tagError) throw tagError;
      const { error } = await services.db.from("file_tags").insert((tags ?? []).map((tag) => ({ file_id: params.data.id, tag_id: tag.id, user_id: userId })));
      if (error) throw error;
    }
    return reply.send({ tags: names });
  });
}
