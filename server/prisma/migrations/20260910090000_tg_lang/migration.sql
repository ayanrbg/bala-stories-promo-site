-- Язык бота.
--
-- Отдельная таблица, а не колонка у участника: переключить язык человек может
-- до всякой регистрации, и заводить ради этого пустую строку в `Participant`
-- нельзя — она попала бы в список участников конкурса и в выгрузку для выплат.

CREATE TABLE "TgPref" (
    "tgUserId" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'ru',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgPref_pkey" PRIMARY KEY ("tgUserId")
);
