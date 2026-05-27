-- CreateEnum
CREATE TYPE "PromoAction" AS ENUM ('ENTERED', 'PURCHASED');

-- CreateTable
CREATE TABLE "Blogger" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promoCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blogger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoUse" (
    "id" TEXT NOT NULL,
    "bloggerId" TEXT NOT NULL,
    "action" "PromoAction" NOT NULL,
    "externalUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumPromo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedBy" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumPromo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Blogger_login_key" ON "Blogger"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Blogger_promoCode_key" ON "Blogger"("promoCode");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumPromo_code_key" ON "PremiumPromo"("code");

-- AddForeignKey
ALTER TABLE "PromoUse" ADD CONSTRAINT "PromoUse_bloggerId_fkey" FOREIGN KEY ("bloggerId") REFERENCES "Blogger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
