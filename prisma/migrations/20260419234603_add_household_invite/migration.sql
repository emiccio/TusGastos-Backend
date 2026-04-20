-- CreateTable
CREATE TABLE "household_invites" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "usedById" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_invites_token_key" ON "household_invites"("token");

-- CreateIndex
CREATE INDEX "household_invites_token_idx" ON "household_invites"("token");

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
