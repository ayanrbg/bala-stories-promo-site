import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { webhookCallback } from 'grammy';
import { bot } from './bot';

/**
 * Отдельный процесс бота (pm2 `bala-tgbot`).
 *
 * Живёт рядом с промо-сайтом и делит с ним базу и Prisma, но не процесс: бот
 * принимает поток обновлений из интернета, и его падение не должно уносить с
 * собой админку и приём промокодов.
 *
 * Webhook, а не polling: на сервере уже есть nginx с TLS, а long polling из
 * pm2-процесса пришлось бы отдельно лечить при каждом рестарте.
 */

const PORT = Number(process.env.TG_BOT_PORT || 3006);
const SECRET = process.env.TG_WEBHOOK_SECRET || '';
/** Полный внешний адрес вебхука; пусто = не переустанавливать (например, локально). */
const WEBHOOK_URL = process.env.TG_WEBHOOK_URL || '';

if (!process.env.TG_BOT_TOKEN) {
  console.error('[TG] нет TG_BOT_TOKEN в server/.env — бот не запущен');
  process.exit(1);
}
if (!SECRET) {
  // Адрес вебхука — это и есть пароль: без секрета кто угодно отправит боту
  // поддельное обновление от имени любого человека.
  console.error('[TG] нет TG_WEBHOOK_SECRET в server/.env — бот не запущен');
  process.exit(1);
}

const app = express();
app.use(express.json());

app.get('/tg/health', (_req, res) => {
  res.json({ ok: true, bot: bot.botInfo?.username || null });
});

// Секрет и в адресе, и в заголовке: адрес отсекает случайный шум из интернета,
// заголовок — того, кто адрес всё-таки узнал (из логов nginx, например).
app.post(`/tg/webhook/${SECRET}`, webhookCallback(bot, 'express', { secretToken: SECRET }));

async function main(): Promise<void> {
  // Явная инициализация до listen: она проверяет токен и заполняет ctx.me —
  // из него берётся имя бота для реферальных ссылок.
  await bot.init();

  if (WEBHOOK_URL) {
    await bot.api.setWebhook(`${WEBHOOK_URL.replace(/\/$/, '')}/tg/webhook/${SECRET}`, {
      secret_token: SECRET,
      // Лишние типы обновлений — лишний трафик и лишние ошибки в логах.
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: false,
    });
    console.log(`[TG] вебхук установлен на ${WEBHOOK_URL}/tg/webhook/***`);
  }

  const server = app.listen(PORT, () => {
    console.log(`[TG] бот @${bot.botInfo.username} слушает порт ${PORT}`);
  });

  // pm2 restart шлёт SIGINT/SIGTERM: дать доиграть текущие обновления, иначе
  // Telegram посчитает их недоставленными и пришлёт повторно.
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((e) => {
  console.error(`[TG] не смог запуститься: ${(e as Error).message}`);
  process.exit(1);
});
