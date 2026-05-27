-- CreateTable
CREATE TABLE "PersonalityVersion" (
    "id" TEXT NOT NULL,
    "personalityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "workerSystem" TEXT NOT NULL,
    "managerSystem" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "promotedAt" BIGINT,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "PersonalityVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunRecord" (
    "id" TEXT NOT NULL,
    "personalityId" TEXT NOT NULL,
    "personalityVersionId" TEXT,
    "title" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "iterationCount" INTEGER NOT NULL,
    "correctionCount" INTEGER NOT NULL DEFAULT 0,
    "tokenPromptTotal" INTEGER NOT NULL DEFAULT 0,
    "tokenCompletionTotal" INTEGER NOT NULL DEFAULT 0,
    "userRating" INTEGER,
    "monitorFindings" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "workerHistory" TEXT NOT NULL,
    "managerHistory" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,
    "completedAt" BIGINT,

    CONSTRAINT "AgentRunRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "PersonalityVersion_personalityId_version_key" ON "PersonalityVersion"("personalityId", "version");

-- AddForeignKey
ALTER TABLE "AgentRunRecord" ADD CONSTRAINT "AgentRunRecord_personalityVersionId_fkey" FOREIGN KEY ("personalityVersionId") REFERENCES "PersonalityVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRunRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
