CREATE TABLE "presence_sessions" (
  "client_id" TEXT NOT NULL,
  "page" TEXT,
  "last_seen_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "presence_sessions_pkey" PRIMARY KEY ("client_id")
);

CREATE INDEX "presence_sessions_last_seen_at_idx"
  ON "presence_sessions"("last_seen_at");

CREATE INDEX "presence_sessions_page_last_seen_at_idx"
  ON "presence_sessions"("page", "last_seen_at");
