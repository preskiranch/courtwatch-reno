CREATE TABLE "sync_leases" (
  "key" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sync_leases_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "sync_leases_expires_at_idx" ON "sync_leases"("expires_at");

CREATE INDEX "sync_runs_running_started_at_idx"
  ON "sync_runs"("started_at")
  WHERE "status" = 'running';
