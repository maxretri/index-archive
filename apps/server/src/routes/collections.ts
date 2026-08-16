import type { Collection } from "@index/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "../types.js";

export async function collectionRoutes(app: FastifyInstance, services: Services, authenticate: ReturnType<typeof import("../security/authenticate.js").authenticator>) {
  app.get("/api/collections", { preHandler: authenticate }, async (request) => {
    const userId = request.sessionUser!.id;
    const [{ data: collections, error }, { data: memberships, error: membershipError }] = await Promise.all([
      services.db.from("collections").select("id,name,created_at").eq("user_id", userId).order("name"),
      services.db.from("collection_files").select("collection_id,file_id,files(created_at,file_type)").eq("user_id", userId)
    ]);
    if (error) throw error;
    if (membershipError) throw membershipError;
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
        coverFileId: files.find((file) => file.type === "photo")?.fileId ?? null
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
    return reply.code(201).send({ id: data.id, name: data.name, createdAt: data.created_at, itemCount: 0, coverFileId: null });
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
