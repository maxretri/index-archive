import { Readable } from "node:stream";
import type { ArchiveFile, FileType, ReceivedCollection, SharedCollectionPage } from "@index/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashCollectionShareToken, isCollectionShareToken } from "../security/collection-share.js";
import { resolveTelegramFile } from "../telegram/api.js";
import type { Services } from "../types.js";

const idSchema = z.string().uuid();
const tokenSchema = z.string().refine(isCollectionShareToken);
const pageSchema = z.object({
  token: tokenSchema,
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30)
});

interface MembershipRow { file_id: string; created_at: string }
interface SharedFileRow {
  id: string; file_type: FileType; mime_type: string | null; filename: string | null;
  file_size: number | null; width: number | null; height: number | null; duration: number | null;
  created_at: string; is_favorite: boolean;
}
interface GrantRow {
  id: string; share_id: string; collection_id: string; owner_user_id: string;
  recipient_user_id: string; accepted_at: string;
}

function encodeCursor(row: MembershipRow) {
  return Buffer.from(JSON.stringify([row.created_at, row.file_id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(value) && typeof value[0] === "string" && idSchema.safeParse(value[1]).success
      ? [value[0], value[1]] : null;
  } catch { return null; }
}

async function activeShare(services: Services, token: string) {
  const { data, error } = await services.db.from("collection_shares")
    .select("id,user_id,collection_id")
    .eq("token_hash", hashCollectionShareToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; user_id: string; collection_id: string } | null;
}

async function activeGrant(services: Services, grantId: string, recipientUserId: string) {
  const { data: grant, error: grantError } = await services.db.from("collection_share_recipients")
    .select("id,share_id,collection_id,owner_user_id,recipient_user_id,accepted_at")
    .eq("id", grantId)
    .eq("recipient_user_id", recipientUserId)
    .maybeSingle();
  if (grantError) throw grantError;
  if (!grant) return null;
  const typed = grant as GrantRow;
  const { data: share, error: shareError } = await services.db.from("collection_shares")
    .select("id,user_id,collection_id")
    .eq("id", typed.share_id)
    .eq("user_id", typed.owner_user_id)
    .eq("collection_id", typed.collection_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (shareError) throw shareError;
  return share ? typed : null;
}

function mapSharedFile(row: SharedFileRow): ArchiveFile {
  return {
    id: row.id, type: row.file_type, mimeType: row.mime_type, filename: row.filename,
    fileSize: row.file_size, width: row.width, height: row.height, duration: row.duration,
    createdAt: row.created_at, isFavorite: false, tags: [], collectionIds: []
  };
}

export async function sharedCollectionRoutes(
  app: FastifyInstance,
  services: Services,
  authenticate: ReturnType<typeof import("../security/authenticate.js").authenticator>
) {
  app.get("/api/shared-collections/received", {
    preHandler: authenticate,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const recipientUserId = request.sessionUser!.id;
    const { data: grantData, error: grantError } = await services.db.from("collection_share_recipients")
      .select("id,share_id,collection_id,owner_user_id,recipient_user_id,accepted_at")
      .eq("recipient_user_id", recipientUserId)
      .order("accepted_at", { ascending: false });
    if (grantError) throw grantError;
    const grants = (grantData ?? []) as GrantRow[];
    if (!grants.length) return reply.send([] satisfies ReceivedCollection[]);

    const shareIds = grants.map((grant) => grant.share_id);
    const { data: activeShareData, error: shareError } = await services.db.from("collection_shares")
      .select("id")
      .in("id", shareIds)
      .is("revoked_at", null);
    if (shareError) throw shareError;
    const activeShareIds = new Set((activeShareData ?? []).map((share) => share.id as string));
    const activeGrants = grants.filter((grant) => activeShareIds.has(grant.share_id));
    if (!activeGrants.length) return reply.send([] satisfies ReceivedCollection[]);

    const collectionIds = [...new Set(activeGrants.map((grant) => grant.collection_id))];
    const ownerIds = [...new Set(activeGrants.map((grant) => grant.owner_user_id))];
    const [collectionResult, ownerResult, membershipResult] = await Promise.all([
      services.db.from("collections").select("id,name").in("id", collectionIds),
      services.db.from("users").select("id,first_name,username").in("id", ownerIds),
      services.db.from("collection_files").select("collection_id,file_id,files(created_at,file_type)")
        .in("collection_id", collectionIds).in("user_id", ownerIds)
    ]);
    if (collectionResult.error) throw collectionResult.error;
    if (ownerResult.error) throw ownerResult.error;
    if (membershipResult.error) throw membershipResult.error;

    const collections = new Map((collectionResult.data ?? []).map((collection) => [collection.id as string, collection]));
    const owners = new Map((ownerResult.data ?? []).map((owner) => [owner.id as string, owner]));
    const membershipsByCollection = new Map<string, Array<{ fileId: string; createdAt: string; fileType: FileType }>>();
    for (const membership of membershipResult.data ?? []) {
      const related = membership.files as unknown as { created_at?: string; file_type?: FileType } | Array<{ created_at?: string; file_type?: FileType }> | null;
      const file = Array.isArray(related) ? related[0] : related;
      if (!file?.created_at || !file.file_type) continue;
      const collectionId = membership.collection_id as string;
      membershipsByCollection.set(collectionId, [...(membershipsByCollection.get(collectionId) ?? []), {
        fileId: membership.file_id as string,
        createdAt: file.created_at,
        fileType: file.file_type
      }]);
    }

    const response = activeGrants.flatMap((grant): ReceivedCollection[] => {
      const collection = collections.get(grant.collection_id);
      const owner = owners.get(grant.owner_user_id);
      if (!collection || !owner) return [];
      const memberships = membershipsByCollection.get(grant.collection_id) ?? [];
      const cover = memberships.filter((item) => item.fileType === "photo")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return [{
        id: grant.id,
        name: collection.name as string,
        ownerName: owner.username ? `@${owner.username as string}` : owner.first_name as string,
        acceptedAt: grant.accepted_at,
        itemCount: memberships.length,
        coverFileId: cover?.fileId ?? null
      }];
    });
    return reply.send(response);
  });

  app.post("/api/shared-collections/open", {
    preHandler: authenticate,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const body = pageSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid collection link" });
    const share = await activeShare(services, body.data.token);
    if (!share) return reply.code(404).send({ error: "Collection link is unavailable" });

    const [{ data: collection, error: collectionError }, countResult] = await Promise.all([
      services.db.from("collections").select("id,name").eq("user_id", share.user_id).eq("id", share.collection_id).maybeSingle(),
      services.db.from("collection_files").select("file_id", { count: "exact", head: true })
        .eq("user_id", share.user_id).eq("collection_id", share.collection_id)
    ]);
    if (collectionError) throw collectionError;
    if (countResult.error) throw countResult.error;
    if (!collection) return reply.code(404).send({ error: "Collection link is unavailable" });

    let membershipQuery = services.db.from("collection_files")
      .select("file_id,created_at")
      .eq("user_id", share.user_id)
      .eq("collection_id", share.collection_id)
      .order("created_at", { ascending: false })
      .order("file_id", { ascending: false })
      .limit(body.data.limit + 1);
    if (body.data.cursor) {
      const cursor = decodeCursor(body.data.cursor);
      if (!cursor) return reply.code(400).send({ error: "Invalid collection cursor" });
      membershipQuery = membershipQuery.or(`created_at.lt.${cursor[0]},and(created_at.eq.${cursor[0]},file_id.lt.${cursor[1]})`);
    }
    const { data: membershipData, error: membershipError } = await membershipQuery;
    if (membershipError) throw membershipError;
    const memberships = (membershipData ?? []) as MembershipRow[];
    const hasMore = memberships.length > body.data.limit;
    const page = memberships.slice(0, body.data.limit);
    const fileIds = page.map((row) => row.file_id);

    let rows: SharedFileRow[] = [];
    if (fileIds.length) {
      const { data, error } = await services.db.from("files")
        .select("id,file_type,mime_type,filename,file_size,width,height,duration,created_at,is_favorite")
        .eq("user_id", share.user_id)
        .in("id", fileIds);
      if (error) throw error;
      rows = (data ?? []) as SharedFileRow[];
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const response: SharedCollectionPage = {
      collection: { name: collection.name as string, itemCount: countResult.count ?? 0 },
      items: page.flatMap((membership) => {
        const file = byId.get(membership.file_id);
        return file ? [mapSharedFile(file)] : [];
      }),
      nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null
    };
    return reply.send(response);
  });

  app.get("/api/shared-collections/received/:grantId", {
    preHandler: authenticate,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ grantId: idSchema }).safeParse(request.params);
    const query = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(60).default(30) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid shared collection" });
    const grant = await activeGrant(services, params.data.grantId, request.sessionUser!.id);
    if (!grant) return reply.code(404).send({ error: "Shared collection is unavailable" });

    const [{ data: collection, error: collectionError }, countResult] = await Promise.all([
      services.db.from("collections").select("id,name").eq("user_id", grant.owner_user_id).eq("id", grant.collection_id).maybeSingle(),
      services.db.from("collection_files").select("file_id", { count: "exact", head: true })
        .eq("user_id", grant.owner_user_id).eq("collection_id", grant.collection_id)
    ]);
    if (collectionError) throw collectionError;
    if (countResult.error) throw countResult.error;
    if (!collection) return reply.code(404).send({ error: "Shared collection is unavailable" });

    let membershipQuery = services.db.from("collection_files")
      .select("file_id,created_at")
      .eq("user_id", grant.owner_user_id)
      .eq("collection_id", grant.collection_id)
      .order("created_at", { ascending: false })
      .order("file_id", { ascending: false })
      .limit(query.data.limit + 1);
    if (query.data.cursor) {
      const cursor = decodeCursor(query.data.cursor);
      if (!cursor) return reply.code(400).send({ error: "Invalid collection cursor" });
      membershipQuery = membershipQuery.or(`created_at.lt.${cursor[0]},and(created_at.eq.${cursor[0]},file_id.lt.${cursor[1]})`);
    }
    const { data: membershipData, error: membershipError } = await membershipQuery;
    if (membershipError) throw membershipError;
    const memberships = (membershipData ?? []) as MembershipRow[];
    const hasMore = memberships.length > query.data.limit;
    const page = memberships.slice(0, query.data.limit);
    const fileIds = page.map((row) => row.file_id);
    let rows: SharedFileRow[] = [];
    if (fileIds.length) {
      const { data, error } = await services.db.from("files")
        .select("id,file_type,mime_type,filename,file_size,width,height,duration,created_at,is_favorite")
        .eq("user_id", grant.owner_user_id).in("id", fileIds);
      if (error) throw error;
      rows = (data ?? []) as SharedFileRow[];
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const response: SharedCollectionPage = {
      collection: { name: collection.name as string, itemCount: countResult.count ?? 0 },
      items: page.flatMap((membership) => {
        const file = byId.get(membership.file_id);
        return file ? [mapSharedFile(file)] : [];
      }),
      nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null
    };
    return reply.send(response);
  });

  app.get("/api/shared-collections/files/:id/content", {
    preHandler: authenticate,
    config: { rateLimit: { max: 180, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ id: idSchema }).safeParse(request.params);
    const query = z.object({
      variant: z.enum(["thumbnail", "original"]).default("original"),
      download: z.coerce.boolean().default(false)
    }).safeParse(request.query);
    const rawToken = request.headers["x-index-share-token"];
    const token = typeof rawToken === "string" ? rawToken : "";
    if (!params.success || !query.success || !isCollectionShareToken(token)) {
      return reply.code(400).send({ error: "Invalid shared file request" });
    }
    const share = await activeShare(services, token);
    if (!share) return reply.code(404).send({ error: "Collection link is unavailable" });

    const { data: membership, error: membershipError } = await services.db.from("collection_files")
      .select("file_id")
      .eq("user_id", share.user_id)
      .eq("collection_id", share.collection_id)
      .eq("file_id", params.data.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return reply.code(404).send({ error: "File is not in this shared collection" });

    const { data, error } = await services.db.from("files")
      .select("telegram_file_id,telegram_thumbnail_file_id,mime_type,filename")
      .eq("user_id", share.user_id)
      .eq("id", params.data.id)
      .maybeSingle();
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

  app.get("/api/shared-collections/received/:grantId/files/:id/content", {
    preHandler: authenticate,
    config: { rateLimit: { max: 180, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const params = z.object({ grantId: idSchema, id: idSchema }).safeParse(request.params);
    const query = z.object({
      variant: z.enum(["thumbnail", "original"]).default("original"),
      download: z.coerce.boolean().default(false)
    }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid shared file request" });
    const grant = await activeGrant(services, params.data.grantId, request.sessionUser!.id);
    if (!grant) return reply.code(404).send({ error: "Shared collection is unavailable" });

    const { data: membership, error: membershipError } = await services.db.from("collection_files")
      .select("file_id")
      .eq("user_id", grant.owner_user_id)
      .eq("collection_id", grant.collection_id)
      .eq("file_id", params.data.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return reply.code(404).send({ error: "File is not in this shared collection" });

    const { data, error } = await services.db.from("files")
      .select("telegram_file_id,telegram_thumbnail_file_id,mime_type,filename")
      .eq("user_id", grant.owner_user_id)
      .eq("id", params.data.id)
      .maybeSingle();
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
}
