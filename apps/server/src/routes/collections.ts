import type { Collection } from "@index/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "../types.js";
import { createCollectionShareToken, hashCollectionShareToken } from "../security/collection-share.js";
import { createCollectionExportToken, verifyCollectionExportToken } from "../security/session.js";
import { prepareCollectionShare } from "../telegram/api.js";
import {
  collectionZipFilename,
  MAX_COLLECTION_EXPORT_ITEMS,
  streamCollectionZip,
  type CollectionExportFile
} from "./collection-export.js";

export async function collectionRoutes(app: FastifyInstance, services: Services, authenticate: ReturnType<typeof import("../security/authenticate.js").authenticator>) {
  app.get("/api/collections", { preHandler: authenticate }, async (request) => {
    const userId = request.sessionUser!.id;
    const [{ data: collections, error }, { data: memberships, error: membershipError }, { data: shares, error: shareError }] = await Promise.all([
      services.db.from("collections").select("id,name,created_at").eq("user_id", userId).order("name"),
      services.db.from("collection_files").select("collection_id,file_id,files(created_at,file_type)").eq("user_id", userId),
      services.db.from("collection_shares").select("collection_id").eq("user_id", userId).is("revoked_at", null)
    ]);
    if (error) throw error;
    if (membershipError) throw membershipError;
    if (shareError) throw shareError;
    const sharedCollections = new Set((shares ?? []).map((share) => share.collection_id as string));
    const byCollection = new Map<string, Array<{ fileId: string; createdAt: string; type: string }>>();
    for (const membership of memberships ?? []) {
      const file = membership.files as unknown as { created_at: string; file_type: string } | null;
      if (!file) continue;
      const key = membership.collection_id as string;
      byCollection.set(key, [...(byCollection.get(key) ?? []), { fileId: membership.file_id as string, createdAt: file.created_at, type: file.file_type }]);
    }
    return (collections ?? []).map((collection): Collection => {
      const files = (byCollection.get(collection.id as string) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        id: collection.id as string,
        name: collection.name as string,
        createdAt: collection.created_at as string,
        itemCount: files.length,
        coverFileId: files.find((file) => file.type === "photo")?.fileId ?? null,
        isShared: sharedCollections.has(collection.id as string)
      };
    });
  });

  app.post("/api/collections", { preHandler: authenticate }, async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Collection name is required" });
    const { data, error } = await services.db.from("collections").insert({
      user_id: request.sessionUser!.id,
      name: body.data.name.toUpperCase()
    }).select("id,name,created_at").single();
    if (error?.code === "23505") return reply.code(409).send({ error: "Collection already exists" });
    if (error) throw error;
    return reply.code(201).send({ id: data.id, name: data.name, createdAt: data.created_at, itemCount: 0, coverFileId: null, isShared: false });
  });

  app.patch("/api/collections/:id", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: "Invalid collection" });
    if (!body.success) return reply.code(400).send({ error: "Collection name is required" });
    const { data, error } = await services.db.from("collections")
      .update({ name: body.data.name.toUpperCase() })
      .eq("user_id", request.sessionUser!.id)
      .eq("id", params.data.id)
      .select("id,name")
      .maybeSingle();
    if (error?.code === "23505") return reply.code(409).send({ error: "Collection already exists" });
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: "Collection not found" });
    return reply.send({ id: data.id, name: data.name });
  });

  app.post("/api/collections/:id/share", {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid collection" });
    const userId = request.sessionUser!.id;
    const [{ data: collection, error }, countResult, { data: coverMembership, error: coverError }] = await Promise.all([
      services.db.from("collections").select("id,name").eq("user_id", userId).eq("id", params.data.id).maybeSingle(),
      services.db.from("collection_files").select("file_id", { count: "exact", head: true })
        .eq("user_id", userId).eq("collection_id", params.data.id),
      services.db.from("collection_files").select("files!inner(telegram_file_id,file_type)")
        .eq("user_id", userId).eq("collection_id", params.data.id).eq("files.file_type", "photo")
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (error) throw error;
    if (countResult.error) throw countResult.error;
    if (coverError) throw coverError;
    if (!collection) return reply.code(404).send({ error: "Collection not found" });
    const telegramUserId = Number(request.sessionUser!.telegramUserId);
    if (!Number.isSafeInteger(telegramUserId)) return reply.code(400).send({ error: "Invalid Telegram user" });

    const token = createCollectionShareToken();
    const { data: share, error: insertError } = await services.db.from("collection_shares").insert({
      user_id: userId,
      collection_id: params.data.id,
      token_hash: hashCollectionShareToken(token)
    }).select("id").single();
    if (insertError) throw insertError;

    const link = `https://t.me/${services.config.BOT_USERNAME}?start=collection_${token}`;
    const relatedCover = coverMembership?.files as unknown as { telegram_file_id?: string } | Array<{ telegram_file_id?: string }> | null;
    const coverTelegramFileId = (Array.isArray(relatedCover) ? relatedCover[0] : relatedCover)?.telegram_file_id ?? null;
    try {
      const prepared = await prepareCollectionShare(services.config, telegramUserId, {
        name: collection.name as string,
        itemCount: countResult.count ?? 0
      }, link, coverTelegramFileId);
      return reply.send({ messageId: prepared.id, expiresAt: prepared.expiration_date, link });
    } catch (shareError) {
      await services.db.from("collection_shares").delete().eq("id", share.id).eq("user_id", userId);
      throw shareError;
    }
  });

  app.delete("/api/collections/:id/shares", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid collection" });
    const userId = request.sessionUser!.id;
    const { data: collection, error: collectionError } = await services.db.from("collections")
      .select("id").eq("user_id", userId).eq("id", params.data.id).maybeSingle();
    if (collectionError) throw collectionError;
    if (!collection) return reply.code(404).send({ error: "Collection not found" });
    const { error } = await services.db.from("collection_shares").update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId).eq("collection_id", params.data.id).is("revoked_at", null);
    if (error) throw error;
    return reply.code(204).send();
  });

  app.post("/api/collections/:id/export", {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } }
  }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid collection" });
    const userId = request.sessionUser!.id;
    const [{ data: collection, error }, countResult] = await Promise.all([
      services.db.from("collections").select("id,name")
        .eq("user_id", userId).eq("id", params.data.id).maybeSingle(),
      services.db.from("collection_files").select("file_id", { count: "exact", head: true })
        .eq("user_id", userId).eq("collection_id", params.data.id)
    ]);
    if (error) throw error;
    if (countResult.error) throw countResult.error;
    if (!collection) return reply.code(404).send({ error: "Collection not found" });
    if ((countResult.count ?? 0) > MAX_COLLECTION_EXPORT_ITEMS) {
      return reply.code(413).send({ error: `Collection ZIP is limited to ${MAX_COLLECTION_EXPORT_ITEMS} items` });
    }
    const expiresIn = 600;
    const token = await createCollectionExportToken(userId, params.data.id, services.config.SESSION_SECRET, expiresIn);
    const filename = collectionZipFilename(collection.name as string);
    return reply.send({
      url: `/api/collections/${params.data.id}/download?access=${encodeURIComponent(token)}`,
      filename,
      expiresIn
    });
  });

  app.get("/api/collections/:id/download", {
    logLevel: "silent",
    config: { rateLimit: { max: 6, timeWindow: "10 minutes" } }
  }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const query = z.object({ access: z.string().min(20).max(4096) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid collection export" });

    let exportAccess: { userId: string; collectionId: string };
    try {
      exportAccess = await verifyCollectionExportToken(query.data.access, services.config.SESSION_SECRET);
    } catch {
      return reply.code(401).send({ error: "Invalid or expired collection export" });
    }
    if (exportAccess.collectionId !== params.data.id) {
      return reply.code(401).send({ error: "Invalid collection export" });
    }

    const [{ data: collection, error: collectionError }, { data: memberships, error: membershipError }] = await Promise.all([
      services.db.from("collections").select("id,name")
        .eq("user_id", exportAccess.userId).eq("id", params.data.id).maybeSingle(),
      services.db.from("collection_files")
        .select("files!inner(telegram_file_id,filename,mime_type,file_type,file_size,created_at)")
        .eq("user_id", exportAccess.userId)
        .eq("collection_id", params.data.id)
        .order("created_at", { ascending: true })
        .limit(MAX_COLLECTION_EXPORT_ITEMS + 1)
    ]);
    if (collectionError) throw collectionError;
    if (membershipError) throw membershipError;
    if (!collection) return reply.code(404).send({ error: "Collection not found" });
    if ((memberships?.length ?? 0) > MAX_COLLECTION_EXPORT_ITEMS) {
      return reply.code(413).send({ error: `Collection ZIP is limited to ${MAX_COLLECTION_EXPORT_ITEMS} items` });
    }

    const files = (memberships ?? []).flatMap((membership): CollectionExportFile[] => {
      const related = membership.files as unknown as Record<string, unknown> | Array<Record<string, unknown>> | null;
      const file = Array.isArray(related) ? related[0] : related;
      if (!file || typeof file.telegram_file_id !== "string" || typeof file.file_type !== "string" || typeof file.created_at !== "string") return [];
      return [{
        telegramFileId: file.telegram_file_id,
        filename: typeof file.filename === "string" ? file.filename : null,
        mimeType: typeof file.mime_type === "string" ? file.mime_type : null,
        fileType: file.file_type as CollectionExportFile["fileType"],
        fileSize: typeof file.file_size === "number" ? file.file_size : file.file_size ? Number(file.file_size) : null,
        createdAt: file.created_at
      }];
    });
    const filename = collectionZipFilename(collection.name as string);
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    reply.header("cache-control", "private, no-store");
    reply.header("access-control-allow-origin", "https://web.telegram.org");
    return reply.send(streamCollectionZip(services.config, files));
  });

  app.post("/api/collections/files", { preHandler: authenticate }, async (request, reply) => {
    const body = z.object({
      fileIds: z.array(z.string().uuid()).min(1).max(200),
      collectionIds: z.array(z.string().uuid()).min(1).max(20)
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Select files and collections" });

    const userId = request.sessionUser!.id;
    const fileIds = [...new Set(body.data.fileIds)];
    const collectionIds = [...new Set(body.data.collectionIds)];
    const [{ data: files, error: fileError }, { data: collections, error: collectionError }] = await Promise.all([
      services.db.from("files").select("id").eq("user_id", userId).in("id", fileIds),
      services.db.from("collections").select("id").eq("user_id", userId).in("id", collectionIds)
    ]);
    if (fileError) throw fileError;
    if (collectionError) throw collectionError;
    if ((files?.length ?? 0) !== fileIds.length || (collections?.length ?? 0) !== collectionIds.length) {
      return reply.code(400).send({ error: "Unknown file or collection" });
    }

    const memberships = collectionIds.flatMap((collectionId) => fileIds.map((fileId) => ({
      collection_id: collectionId,
      file_id: fileId,
      user_id: userId
    })));
    const { error } = await services.db.from("collection_files")
      .upsert(memberships, { onConflict: "collection_id,file_id", ignoreDuplicates: true });
    if (error) throw error;
    return reply.send({ fileCount: fileIds.length, collectionIds });
  });

  app.delete("/api/collections/:id", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid collection" });
    const { data, error } = await services.db.from("collections").delete()
      .eq("user_id", request.sessionUser!.id).eq("id", params.data.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: "Collection not found" });
    return reply.code(204).send();
  });
}
