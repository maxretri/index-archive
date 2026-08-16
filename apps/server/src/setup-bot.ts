import "dotenv/config";
import { loadConfig } from "./config.js";
import { configureTelegramBot } from "./telegram/api.js";

const config = loadConfig();
const publicServerUrl = process.argv[2];
if (!publicServerUrl || !URL.canParse(publicServerUrl) || !publicServerUrl.startsWith("https://")) {
  throw new Error("Usage: pnpm --filter @index/server bot:setup https://api.example.com");
}
await configureTelegramBot(config, `${publicServerUrl.replace(/\/$/, "")}/telegram/webhook`);
process.stdout.write("INDEX bot webhook and menu button configured.\n");
