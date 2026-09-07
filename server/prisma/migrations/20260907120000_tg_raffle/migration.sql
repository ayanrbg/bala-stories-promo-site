-- Розыгрыш в Telegram-боте: кампания, участники, снимок билетов, победители.
-- Конкурс UGC (Contest/Participant) не трогаем — это соседняя механика с другим
-- участником (там автор, здесь зритель) и другим способом определить победителя.

-- CreateTable
CREATE TABLE "TgCampaign" (
    "id" TEXT NOT NULL DEFAULT 'tg-2026-09',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "rules" JSONB NOT NULL,
    "prizeGrid" JSONB NOT NULL,
    "taleIds" TEXT[],
    "channelId" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "seedHash" TEXT,
    "seed" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgParticipant" (
    "campaignId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "tgUserId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "languageCode" TEXT,
    "source" TEXT,
    "invitedById" TEXT,
    "code" TEXT,
    "talePromoId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "channelOk" BOOLEAN NOT NULL DEFAULT false,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "dqReason" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeIssuedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgTicketSnapshot" (
    "campaignId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tickets" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgTicketSnapshot_pkey" PRIMARY KEY ("campaignId","participantId")
);

-- CreateTable
CREATE TABLE "TgWinner" (
    "campaignId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "prizeTier" INTEGER NOT NULL,
    "prizeAmount" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgWinner_pkey" PRIMARY KEY ("campaignId","participantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TgParticipant_code_key" ON "TgParticipant"("code");
CREATE UNIQUE INDEX "TgParticipant_talePromoId_key" ON "TgParticipant"("talePromoId");
CREATE UNIQUE INDEX "TgParticipant_campaignId_tgUserId_key" ON "TgParticipant"("campaignId", "tgUserId");
CREATE INDEX "TgParticipant_campaignId_activatedAt_idx" ON "TgParticipant"("campaignId", "activatedAt");
CREATE INDEX "TgParticipant_invitedById_idx" ON "TgParticipant"("invitedById");
CREATE INDEX "TgTicketSnapshot_campaignId_idx" ON "TgTicketSnapshot"("campaignId");
CREATE INDEX "TgWinner_campaignId_prizeTier_idx" ON "TgWinner"("campaignId", "prizeTier");

-- AddForeignKey
ALTER TABLE "TgParticipant" ADD CONSTRAINT "TgParticipant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "TgCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TgParticipant" ADD CONSTRAINT "TgParticipant_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "TgParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TgTicketSnapshot" ADD CONSTRAINT "TgTicketSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "TgCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TgTicketSnapshot" ADD CONSTRAINT "TgTicketSnapshot_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TgParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TgWinner" ADD CONSTRAINT "TgWinner_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "TgCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TgWinner" ADD CONSTRAINT "TgWinner_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TgParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Черновик кампании. Даты, призы и набор сказок заказчик ещё не назвал, поэтому
-- строка заводится НЕопубликованной: бот с ней отвечает только админам из
-- TG_ADMIN_IDS и не может случайно объявить людям выдуманный призовой фонд.
-- Правила билетов: на старте включена только активация — остальные включаются
-- настройкой, без миграции (см. DEV_PLAN_TG_BOT_RAFFLE.md §6).
INSERT INTO "TgCampaign" ("id", "title", "startsAt", "endsAt", "rules", "prizeGrid", "taleIds", "published", "updatedAt")
VALUES ('tg-2026-09', 'Розыгрыш Bala Stories',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days',
        '[{"id":"install","tickets":1,"enabled":true},
          {"id":"subscription","tickets":5,"enabled":false},
          {"id":"friend","tickets":2,"enabled":false,"cap":5},
          {"id":"channel","tickets":1,"enabled":false}]'::jsonb,
        '[]'::jsonb, ARRAY[]::TEXT[], false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
