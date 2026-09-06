-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limits_updated_at_idx" ON "rate_limits"("updated_at");
