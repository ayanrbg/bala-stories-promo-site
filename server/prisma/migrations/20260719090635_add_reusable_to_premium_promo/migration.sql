-- Add reusable flag to PremiumPromo (multi-use promo codes, e.g. app-store review codes)
ALTER TABLE "PremiumPromo" ADD COLUMN "reusable" BOOLEAN NOT NULL DEFAULT false;
