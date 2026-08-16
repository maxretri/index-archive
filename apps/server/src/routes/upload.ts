import type { FastifyInstance } from "fastify";
import type { Services, TelegramMessage } from "../types.js";
import { sendUploadToTelegram } from "../telegram/api.js";
import { ingestMessage } from "../telegram/ingest.js";

function safeFilename(value: string) {
  return value.replace(/[\\/\0\r\n]/g, "_").slice(0, 180) || "INDEX-UPLOAD";
}

export async function uploadRoutes(app: FastifyInstance, services: Services, authenticate: ReturnType<typeof import("../security/authenticate.js").authenticator>) {
  app.post("/api/uploads", {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const part = await request.file({ limits: { files: 1, fileSize: services.config.MAX_UPLOAD_BYTES } });
    if (!part) return reply.code(400).send({ error: "Choose a file to upload" });
    const bytes = await part.toBuffer();
    if (!bytes.length) return reply.code(400).send({ error: "Empty files are not supported" });
    const userId = request.sessionUser!.id;
    const { data: user, error } = await services.db.from("users")
      .select("telegram_user_id,first_name,last_name,username,language_code")
      .eq("id", userId).maybeSingle();
    if (error) throw error;
    if (!user) return reply.code(401).send({ error: "User not found" });

    try {
      const telegramMessage = await sendUploadToTelegram(services.config, Number(user.telegram_user_id), {
        bytes,
        filename: safeFilename(part.filename),
        mimeType: part.mimetype || "application/octet-stream"
      });
      const userMessage: TelegramMessage = {
        ...telegramMessage,
        chat: { id: Number(user.telegram_user_id), type: "private" },
        from: {
          id: Number(user.telegram_user_id),
          first_name: user.first_name as string,
          last_name: user.last_name as string | undefined,
          username: user.username as string | undefined,
          language_code: user.language_code as string | undefined
        }
      };
      const indexed = await ingestMessage(services, userMessage, false);
      if (!indexed) throw new Error("Telegram upload was not indexable");
      return reply.code(201).send({ id: indexed.id });
    } catch (uploadError) {
      request.log.warn({ err: uploadError instanceof Error ? uploadError.message : "upload failed" }, "Telegram upload failed");
      return reply.code(409).send({ error: "Open the INDEX bot and press Start before uploading from the Mini App" });
    }
  });
}
