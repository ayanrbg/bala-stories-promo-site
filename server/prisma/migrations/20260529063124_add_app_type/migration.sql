-- CreateEnum
CREATE TYPE "AppType" AS ENUM ('BALA_STORIES', 'ISLAMIC_TALES');

-- AlterTable
ALTER TABLE "Blogger" ADD COLUMN     "apps" "AppType"[];

-- AlterTable: add column with default for existing rows, then drop default
ALTER TABLE "PromoUse" ADD COLUMN     "app" "AppType" NOT NULL DEFAULT 'BALA_STORIES';
ALTER TABLE "PromoUse" ALTER COLUMN "app" DROP DEFAULT;
