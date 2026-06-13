CREATE TABLE "favorite_team_watches" (
    "id" TEXT NOT NULL,
    "owner_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "source_team_id" TEXT,
    "source_team_name" TEXT,
    "event_name" TEXT,
    "division_name" TEXT,
    "gender" TEXT,
    "grade_level" TEXT,
    "level" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "favorite_team_watches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "favorite_team_watches_owner_hash_idx" ON "favorite_team_watches"("owner_hash");
CREATE INDEX "favorite_team_watches_normalized_name_idx" ON "favorite_team_watches"("normalized_name");
CREATE INDEX "favorite_team_watches_source_team_id_idx" ON "favorite_team_watches"("source_team_id");
