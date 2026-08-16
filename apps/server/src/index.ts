import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
