-- Ники в нескольких соцсетях вместо одной пары «ник + ссылка».
--
-- Автор снимает не в одной сети: у одного основной TikTok, у другого Instagram,
-- у третьего канал на YouTube. Одно поле заставляло выбирать, а нам нужен тот
-- контакт, по которому человека реально найти при выплате приза.
--
-- Ссылка остаётся только у YouTube: там @-ник опознать труднее, чем канал.

ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "instagram" TEXT;
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "tiktok"    TEXT;
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "youtube"   TEXT;
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "telegram"  TEXT;

-- Раскладываем то, что уже заполнено: гадать по ссылке надёжнее, чем потерять.
UPDATE "Participant" SET "tiktok"   = "nickname" WHERE "nickname" IS NOT NULL AND "socialUrl" ILIKE '%tiktok%';
UPDATE "Participant" SET "telegram" = "nickname" WHERE "nickname" IS NOT NULL AND "socialUrl" ILIKE '%t.me%';
UPDATE "Participant" SET "youtube"  = "socialUrl" WHERE "socialUrl" ILIKE '%youtube%' OR "socialUrl" ILIKE '%youtu.be%';
-- Остальное считаем инстаграмом: это самый частый случай, и человек поправит сам.
UPDATE "Participant" SET "instagram" = "nickname"
 WHERE "nickname" IS NOT NULL
   AND "tiktok" IS NULL AND "telegram" IS NULL AND "youtube" IS NULL;

ALTER TABLE "Participant" DROP COLUMN IF EXISTS "nickname";
ALTER TABLE "Participant" DROP COLUMN IF EXISTS "socialUrl";
