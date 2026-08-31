-- Кабинет участника UGC-конкурса: участники, сроки и зафиксированные итоги.

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL DEFAULT 'ugc-2026-09',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "minActivations" INTEGER NOT NULL DEFAULT 30,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "nickname" TEXT,
    "socialUrl" TEXT,
    "phone" TEXT,
    "code" TEXT,
    "talePromoId" TEXT,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "dqReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeIssuedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestResult" (
    "contestId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "activations" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "qualified" BOOLEAN NOT NULL,
    "prizeTier" INTEGER,
    "prizeAmount" INTEGER,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestResult_pkey" PRIMARY KEY ("contestId","participantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_googleSub_key" ON "Participant"("googleSub");
CREATE UNIQUE INDEX "Participant_email_key" ON "Participant"("email");
CREATE UNIQUE INDEX "Participant_code_key" ON "Participant"("code");
CREATE UNIQUE INDEX "Participant_talePromoId_key" ON "Participant"("talePromoId");
CREATE INDEX "ContestResult_contestId_rank_idx" ON "ContestResult"("contestId", "rank");

-- AddForeignKey
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Сам конкурс. Время в UTC; 3 сентября 00:00 и 14 сентября 23:59:59 по Алматы (UTC+5).
INSERT INTO "Contest" ("id", "title", "startsAt", "endsAt", "minActivations", "updatedAt")
VALUES ('ugc-2026-09', 'Мама UGC — розыгрыш 200 000 ₸',
        '2026-09-02 19:00:00', '2026-09-14 18:59:59', 30, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
