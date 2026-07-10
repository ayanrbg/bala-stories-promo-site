-- Multi-use / reusable premium promo codes (reviewer codes)
ALTER TABLE "PremiumPromo" ADD COLUMN "label" TEXT;
ALTER TABLE "PremiumPromo" ADD COLUMN "maxUses" INTEGER;
ALTER TABLE "PremiumPromo" ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;

-- Existing codes were single-use: cap them at 1 and reflect prior redemption.
UPDATE "PremiumPromo" SET "maxUses" = 1, "useCount" = CASE WHEN "used" THEN 1 ELSE 0 END;
