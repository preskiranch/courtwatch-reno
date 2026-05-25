import { prisma } from "@courtwatch/db";
import { config, isDatabaseConfigured } from "./config.js";
import { createApp } from "./app.js";
import { MockStore, PrismaStore } from "./store.js";

const useDatabase = isDatabaseConfigured();
const store = useDatabase ? new PrismaStore(prisma) : new MockStore();
const app = createApp(store, useDatabase ? prisma : null);

app.listen(config.PORT, () => {
  console.log(`Court Watch AAU API listening on ${config.PORT}`);
});
