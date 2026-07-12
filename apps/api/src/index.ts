import { prisma } from "@courtwatch/db";
import { config, isDatabaseConfigured } from "./config.js";
import { createApp } from "./app.js";
import { MockStore, PrismaStore } from "./store.js";

const useDatabase = isDatabaseConfigured();
const store = useDatabase ? new PrismaStore(prisma) : new MockStore();
const app = createApp(store, useDatabase ? prisma : null);

const server = app.listen(config.PORT, () => {
  console.log(`Court Watch AAU API listening on ${config.PORT}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing Court Watch AAU API`);

  const forcedExit = setTimeout(() => {
    console.error("API shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();
    } finally {
      clearTimeout(forcedExit);
      if (error) console.error("API server close failed", error);
      process.exit(error ? 1 : 0);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
