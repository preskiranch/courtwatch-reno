-- Persist authenticated sessions so logout and password resets can revoke
-- credentials immediately. Existing signed tokens remain usable during the
-- migration window and new logins receive a server-backed session id.

ALTER TABLE "users"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "account_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "account_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_sessions_user_active_idx"
  ON "account_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "account_sessions_expires_at_idx"
  ON "account_sessions"("expires_at");

ALTER TABLE "account_sessions"
  ADD CONSTRAINT "account_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
