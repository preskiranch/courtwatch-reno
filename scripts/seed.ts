import { prisma } from "@courtwatch/db";
import { PrismaStore } from "../apps/api/src/store.js";

async function main() {
  const store = new PrismaStore(prisma);
  const result = await store.syncNow();
  console.log(`Seeded Court Watch AAU: ${result.teamsCount} teams, ${result.gamesCount} games, ${result.changesDetected} new changes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
