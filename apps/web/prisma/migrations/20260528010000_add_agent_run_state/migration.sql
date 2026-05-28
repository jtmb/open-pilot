-- CreateTable
CREATE TABLE "AgentRunState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,

    CONSTRAINT "AgentRunState_pkey" PRIMARY KEY ("id")
);
