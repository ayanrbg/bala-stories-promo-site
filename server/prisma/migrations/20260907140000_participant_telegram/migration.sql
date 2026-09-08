-- Вход в конкурс из Telegram-бота.
--
-- Участник из бота — это тот же `Participant` того же конкурса, а не соседняя
-- сущность: рейтинг, порог, призовая сетка, фиксация итогов и админская вкладка
-- «Конкурс» у сайта и у бота общие. Поэтому здесь только колонки, а не таблица.

ALTER TABLE "Participant" ADD COLUMN "tgUserId" TEXT;
ALTER TABLE "Participant" ADD COLUMN "tgUsername" TEXT;
ALTER TABLE "Participant" ADD COLUMN "notifiedActivations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Participant" ADD COLUMN "notifiedRank" INTEGER;

-- Telegram не отдаёт почту, а участник без почты должен быть возможен. NULL в
-- UNIQUE-индексе Postgres не конфликтует сам с собой, поэтому таких строк может
-- быть сколько угодно.
ALTER TABLE "Participant" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "Participant_tgUserId_key" ON "Participant"("tgUserId");

-- Таблицы отменённой механики розыгрыша билетов (заведены в этот же день,
-- пусты). Сроки, порог и призы живут в `Contest` — второй копии этих настроек
-- быть не должно. Дочерние таблицы удаляются первыми из-за внешних ключей.
DROP TABLE IF EXISTS "TgTicketSnapshot";
DROP TABLE IF EXISTS "TgWinner";
DROP TABLE IF EXISTS "TgParticipant";
DROP TABLE IF EXISTS "TgCampaign";
