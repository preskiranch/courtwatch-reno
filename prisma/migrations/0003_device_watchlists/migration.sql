ALTER TABLE "users" ADD COLUMN "client_id" TEXT;

CREATE UNIQUE INDEX "users_client_id_key" ON "users"("client_id");
