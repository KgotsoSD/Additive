-- Append-only provider usage and cost ledger for every rendered project.
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UsageRecord_projectId_createdAt_idx" ON "UsageRecord"("projectId", "createdAt");
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
