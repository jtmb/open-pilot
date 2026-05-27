-- Add usageCount column to ApiKey table
ALTER TABLE "ApiKey" ADD COLUMN "usageCount" INTEGER NOT NULL DEFAULT 0;
