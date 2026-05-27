-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "messages" TEXT NOT NULL DEFAULT '[]'
);
