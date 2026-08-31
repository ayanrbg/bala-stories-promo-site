import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

/**
 * Вход по одноразовой ссылке — запасной путь для тех, у кого Google не
 * открывается: аккаунта нет, вход блокирует встроенный браузер, корпоративная
 * политика. Без него такой человек упирается в стену, а на конкурсе это
 * потерянный участник.
 *
 * Ссылку выдаёт админ из панели (работает всегда) либо она уходит письмом
 * (включается, когда в .env появятся SMTP-доступы). Механизм один и тот же —
 * значит, письмо не придётся отлаживать отдельно от того, что уже проверено.
 */

const prisma = new PrismaClient();

const SECRET = process.env.CONTEST_SESSION_SECRET || '';
const TTL_HOURS = 72;
const SITE_URL = process.env.SITE_URL || 'https://promocode-stories.apiapp.kz';

export interface InviteLink {
  url: string;
  expiresAt: string;
}

/**
 * Выдать ссылку. Прежняя перестаёт работать в тот же миг: идентификатор
 * хранится один, и сверка с ним и делает ссылку одноразовой.
 */
export async function issueInviteLink(participantId: string): Promise<InviteLink> {
  if (!SECRET) throw new Error('CONTEST_SESSION_SECRET не задан');

  const jti = crypto.randomBytes(12).toString('hex');
  await prisma.participant.update({
    where: { id: participantId },
    data: { inviteTokenId: jti },
  });

  const token = jwt.sign({ pid: participantId, jti, kind: 'invite' }, SECRET, {
    expiresIn: `${TTL_HOURS}h`,
  });

  return {
    url: `${SITE_URL}/ugc?invite=${encodeURIComponent(token)}`,
    expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000).toISOString(),
  };
}

/**
 * Проверить ссылку и погасить её. Возвращает id участника либо null —
 * причину наружу не отдаём: подсказка «ссылка уже использована» помогает
 * только тому, кто перебирает чужие.
 */
export async function consumeInvite(token: string): Promise<string | null> {
  if (!SECRET || !token) return null;

  let payload: { pid?: string; jti?: string; kind?: string };
  try {
    payload = jwt.verify(token, SECRET) as typeof payload;
  } catch {
    return null;
  }
  if (payload.kind !== 'invite' || !payload.pid || !payload.jti) return null;

  // Гасим по совпадению идентификатора: если ссылку уже использовали или
  // выдали новую, обновится ноль строк — и вход не состоится.
  const used = await prisma.participant.updateMany({
    where: { id: payload.pid, inviteTokenId: payload.jti },
    data: { inviteTokenId: null, lastSeenAt: new Date() },
  });

  return used.count === 1 ? payload.pid : null;
}

// ─────────────────────────── письмо ───────────────────────────

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Отправить ссылку письмом. Пока SMTP не настроен, честно отвечаем «нельзя»:
 * поднимать локальный почтовый демон на этой машине бессмысленно — письма с
 * непрогретого адреса уедут в спам, и человек решит, что сайт сломан.
 */
export async function sendInviteMail(to: string, link: InviteLink): Promise<void> {
  if (!mailConfigured()) throw new Error('smtp_not_configured');

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER as string, pass: process.env.SMTP_PASS as string },
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || `Bala Stories <${process.env.SMTP_USER}>`,
    to,
    subject: 'Вход в кабинет конкурса Bala',
    text:
      'Здравствуйте!\n\n' +
      'Чтобы войти в кабинет участника конкурса, откройте ссылку:\n' +
      link.url + '\n\n' +
      'Ссылка работает один раз и действует трое суток.\n' +
      'Если вы её не запрашивали — просто не открывайте, ничего не произойдёт.\n',
    html:
      '<p>Здравствуйте!</p>' +
      '<p>Чтобы войти в кабинет участника конкурса, откройте ссылку:</p>' +
      `<p><a href="${link.url}">Войти в кабинет</a></p>` +
      '<p style="color:#666;font-size:13px">Ссылка работает один раз и действует трое суток. ' +
      'Если вы её не запрашивали — просто не открывайте, ничего не произойдёт.</p>',
  });
}
