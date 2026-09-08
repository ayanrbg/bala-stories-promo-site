import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { webhookCallback } from 'grammy';
import { bot, MINIAPP_URL } from './bot';

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

const handleUpdate = webhookCallback(bot, 'express', {
  secretToken: SECRET,
  // Медленный обработчик не должен превращаться в брошенный запрос: Telegram
  // ждёт ответа и при молчании присылает то же обновление снова.
  onTimeout: 'return',
  timeoutMilliseconds: 8000,
});

// Секрет и в адресе, и в заголовке: адрес отсекает случайный шум из интернета,
// заголовок — того, кто адрес всё-таки узнал (из логов nginx, например).
//
// Обёртка обязательна: при вебхуке grammy НЕ отправляет ошибки в bot.catch —
// тот работает только у long polling. Ошибка всплывает в Express, а он не ловит
// отказы асинхронных обработчиков, и запрос повисает навсегда. Проверено:
// неудачная отправка ответа (человек не начинал чат) вешала соединение.
//
// Отвечаем 200 даже на сбой: иначе Telegram будет вечно повторять то же самое
// обновление, и одна битая кнопка забьёт очередь всем остальным.
app.post(`/tg/webhook/${SECRET}`, async (req, res) => {
  try {
    await handleUpdate(req, res);
  } catch (e) {
    console.error(`[TG] обновление не обработано: ${(e as Error).message}`);
    if (!res.headersSent) res.sendStatus(200);
  }
});

async function main(): Promise<void> {
  // Явная инициализация до listen: она проверяет токен и заполняет ctx.me —
  // из него берётся имя бота для реферальных ссылок.
  await bot.init();

  // Кнопка меню рядом со строкой ввода: кабинет должен открываться из любого
  // места переписки, а не только из последнего сообщения бота.
  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: MINIAPP_URL } },
  }).catch((e: Error) => console.error(`[TG] кнопка меню не установлена: ${e.message}`));

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
