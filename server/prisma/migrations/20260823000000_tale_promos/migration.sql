-- Referral tale promos: a free blogger code that unlocks a set of tales and
-- binds the user to the blogger (the binding itself lives in the Fairy backend).

-- CreateTable
CREATE TABLE "TalePromo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "taleIds" TEXT[],
    "bloggerId" TEXT,
    "app" "AppType" NOT NULL DEFAULT 'BALA_STORIES',
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalePromo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalePromoUse" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "app" "AppType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalePromoUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "attributionDays" INTEGER,
    "showRenewals" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSettings_pkey" PRIMARY KEY ("id")
);

-- AlterTable: transaction id for server-attributed purchases (dedup).
ALTER TABLE "PromoUse" ADD COLUMN "transactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TalePromo_code_key" ON "TalePromo"("code");
CREATE UNIQUE INDEX "TalePromoUse_promoId_externalUserId_key" ON "TalePromoUse"("promoId", "externalUserId");
CREATE UNIQUE INDEX "PromoUse_transactionId_key" ON "PromoUse"("transactionId");

-- AddForeignKey
ALTER TABLE "TalePromo" ADD CONSTRAINT "TalePromo_bloggerId_fkey" FOREIGN KEY ("bloggerId") REFERENCES "Blogger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TalePromoUse" ADD CONSTRAINT "TalePromoUse_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "TalePromo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
