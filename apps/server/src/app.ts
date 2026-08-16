import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "./config.js";
import { createDatabase } from "./db.js";
import { authenticator } from "./security/authenticate.js";
import { authRoutes } from "./routes/auth.js";
import { collectionRoutes } from "./routes/collections.js";
import { fileRoutes } from "./routes/files.js";
import { uploadRoutes } from "./routes/upload.js";
import { webhookRoutes } from "./routes/webhook.js";

export async function buildApp(config: Config, database = createDatabase(config)) {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", "req.headers.x-telegram-bot-api-secret-token", "req.body.initData"]
    },
    trustProxy: true,
    bodyLimit: 1_048_576
  });
  const origins = config.WEB_ORIGIN.split(",").map((origin) => origin.trim());
  await app.register(cors, { origin: origins, methods: ["GET", "POST", "PATCH", "PUT", "DELETE"], allowedHeaders: ["authorization", "content-type"] });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { files: 1, fileSize: config.MAX_UPLOAD_BYTES, fields: 2 } });

  const services = { config, db: database };
  const authenticate = authenticator(config);
  app.get("/health", async () => ({ ok: true, service: "index-server" }));
  await authRoutes(app, services);
  await webhookRoutes(app, services);
  await fileRoutes(app, services, authenticate);
  await collectionRoutes(app, services, authenticate);
  await uploadRoutes(app, services, authenticate);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode === 413 || error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({ error: "File is larger than the upload limit" });
    }
    request.log.error({ err: error }, "Request failed");
    return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500)
      .send({ error: error.statusCode && error.statusCode < 500 ? error.message : "Internal server error" });
  });
  return app;
}
