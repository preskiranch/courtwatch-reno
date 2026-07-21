import { prisma } from "@courtwatch/db";
import { config, isDatabaseConfigured } from "./config.js";
import { createApp } from "./app.js";
import { CoalescedTask } from "./coalesced-task.js";
import { NotificationService } from "./notification-service.js";
import { MockStore, PrismaStore } from "./store.js";
import { recoverInterruptedSyncRuns } from "./sync-run-recovery.js";

const useDatabase = isDatabaseConfigured();
const store = useDatabase ? new PrismaStore(prisma) : new MockStore();
const app = createApp(store, useDatabase ? prisma : null);
const notifications = app.locals.notificationService as NotificationService;

if (useDatabase) {
  try {
    const recoveredCount = await recoverInterruptedSyncRuns(
      prisma,
      config.SYNC_RUN_STALE_AFTER_MS,
    );
    if (recoveredCount > 0) {
      console.warn("Recovered interrupted tournament sync runs", {
        recoveredCount,
      });
    }
  } catch (error) {
    console.error("Interrupted sync recovery failed", error);
  }
}

const notificationDispatcher = new CoalescedTask(async () => {
  try {
    const result = await notifications.sendPending();
    if (
      result.queued > 0 ||
      result.sent > 0 ||
      result.retried > 0 ||
      result.deadLettered > 0
    ) {
      console.info("Notification dispatch completed", result);
    }
  } catch (error) {
    console.error("Notification dispatch failed", error);
  }
});

void notificationDispatcher.run();
const notificationDispatchTimer = setInterval(
  () => void notificationDispatcher.run(),
  config.NOTIFICATION_DISPATCH_INTERVAL_MS,
);
notificationDispatchTimer.unref();

const server = app.listen(config.PORT, () => {
  console.log(`Court Watch AAU API listening on ${config.PORT}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing Court Watch AAU API`);
  clearInterval(notificationDispatchTimer);

  const forcedExit = setTimeout(() => {
    console.error("API shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  server.close(async (error) => {
    try {
      await notificationDispatcher.drain();
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
