import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { verifySession } from "./session.js";

export function authenticator(config: Config) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "Authentication required" });
    try {
      request.sessionUser = await verifySession(header.slice(7), config.SESSION_SECRET);
    } catch {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }
  };
}
