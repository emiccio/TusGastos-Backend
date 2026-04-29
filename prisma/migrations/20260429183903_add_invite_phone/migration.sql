/*
  Warnings:

  - You are about to drop the column `used` on the `household_invites` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- AlterTable
ALTER TABLE "household_invites" DROP COLUMN "used",
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "InviteStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "household_invites_phone_idx" ON "household_invites"("phone");

-- CreateIndex
CREATE INDEX "household_invites_phone_status_idx" ON "household_invites"("phone", "status");
