import { Contest } from '@prisma/client';
import { PRIZE_FUND, WINNERS_TOTAL, StandingRow, prizeTable } from '../lib/contestStandings';
import { Lang, acts, almatyDate, money, plural, timeLeft } from '../lib/tgFormat';

/**
 * Все тексты бота на двух языках.
 *
 * Условия конкурса здесь не заданы: фонд, сетка, порог и сроки приходят из
 * `Contest` и `contestStandings.ts`. Второго списка призов быть не должно — на
 * сайте он однажды разъехался с настоящим, и это стоило спора об условиях.
 *
 * Разметка — HTML: <code> в Telegram копируется одним нажатием, а промокод для
 * того и нужен. Казахские строки — рабочий перевод, его стоит вычитать носителю.
 */

export { Lang };

/** Экранирование для мест, куда попадает чужой текст (ник, имя). */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Dict = Record<string, string>;

const RU: Dict = {
  'terms.head': '🎁 <b>{title}</b>',
  'terms.fund': 'Призовой фонд — <b>{fund}</b>, {winners}.',
  'terms.how': '<b>Как это работает</b>\n' +
    '1️⃣ Вы получаете личный промокод\n' +
    '2️⃣ Называете его в своих видео и сторис\n' +
    '3️⃣ Зритель ставит Bala Stories и вводит ваш код — это активация\n' +
    '4️⃣ Чем больше активаций, тем выше вы в рейтинге',
  'terms.gate': 'Для участия в распределении призов нужно минимум <b>{min}</b> {acts}.',
  'terms.until': 'Конкурс идёт до <b>{date}</b> — осталось {left}.',

  'winners.n': '{n} {word}',
  'winners.word.one': 'победитель',
  'winners.word.few': 'победителя',
  'winners.word.many': 'победителей',

  'beforeStart': '🎁 <b>{title}</b>\n\nКонкурс стартует {date}. Возвращайтесь к этому времени.',
  'afterEnd': '⏳ Конкурс завершён.\n\nПриём активаций закрылся {date}. ' +
    'Итоги зафиксированы — свой результат можно посмотреть в кабинете.',

  'notPublic': '🐣 Конкурс скоро откроется для приёма заявок.\n\n' +
    'Загляните чуть позже — здесь появятся условия и ваш личный промокод.',
  'noContest': '🐣 Конкурс сейчас настраивается. Загляните чуть позже.',
  'notRegistered': 'Вы ещё не участвуете в конкурсе.\n\nНажмите /start и кнопку «Участвовать» — это две минуты.',

  'askPhone': '📱 <b>Шаг 1 из 2 — телефон</b>\n\n' +
    'По нему мы выплатим приз, если вы победите, и найдём вас, если возникнет вопрос.\n\n' +
    'Нажмите кнопку внизу — Telegram отправит номер сам. Можно и написать его сообщением.',
  'foreignContact': 'Это контакт другого человека. Нажмите кнопку «Отправить телефон» — Telegram пришлёт ваш собственный номер.',
  'badPhone': 'Не похоже на номер телефона. Пришлите его в виде +7 777 123 45 67 — или нажмите кнопку внизу.',
  'phoneNeedsProof': 'Этот номер уже участвует в конкурсе.\n\n' +
    'Если он ваш — нажмите кнопку «Отправить телефон» внизу, и я покажу ваш промокод. ' +
    'Так я убеждаюсь, что номер действительно ваш.',
  'phoneTakenByOther': 'Этот номер уже привязан к другому аккаунту Telegram.\n\n' +
    'Если это ваш номер и доступ потерян — напишите нам, разберёмся вручную.',
  'phoneMissing': '\n\n⚠️ У вас не указан телефон. Без него мы не сможем связаться с вами по призу — ' +
    'нажмите кнопку ниже, это одно касание.',

  'askSocial': '📸 <b>Шаг 2 из 2 — где вы снимаете</b>\n\n' +
    'Пришлите ссылку на профиль в Instagram, TikTok или YouTube. Можно просто ник в Instagram.',
  'badSocial': 'Не разобрал. Пришлите ссылку на профиль — например instagram.com/username — или ник.',

  'welcomeBack': '✅ Нашёл вас — вы уже зарегистрированы на сайте, второй код не нужен.\n\n' +
    'Ваш промокод: <code>{code}</code>\n\nТеперь я буду присылать сюда новые активации. До конца конкурса: {left}.',
  'codeIssued': '🎉 <b>Готово, вы участвуете!</b>\n\n' +
    'Ваш промокод: <code>{code}</code>\n<i>нажмите на код, чтобы скопировать</i>\n\n' +
    '<b>Что делать дальше</b>\n' +
    'Называйте код в видео и сторис: зритель ставит Bala Stories, вводит код — ' +
    'и получает сказки в подарок, а вам засчитывается активация.\n\n' +
    'Нужно минимум {min} {acts}, чтобы участвовать в распределении призов. До конца конкурса: {left}.\n\n' +
    'Новые активации я буду присылать сюда сам.',

  'status.head': 'Ваш промокод: <code>{code}</code>',
  'status.none': 'Активаций пока нет.\nНазовите код в видео — как только зритель установит приложение и введёт его, я сообщу.',
  'status.rank': '🏆 Место: <b>{rank}</b>\n📈 Активаций: <b>{acts}</b>',
  'status.gateOk': '🟢 Порог пройден — вы участвуете в распределении призов.',
  'status.gateLeft': '🔴 До порога ещё {left}.',
  'status.prize': '💰 Приз за это место — {sum}.',
  'status.left': 'До конца конкурса: {left}.',

  'top.head': '🏆 <b>Рейтинг конкурса</b>',
  'top.empty': 'Активаций пока нет ни у кого. Первое видео решает всё.',
  'top.you': '\nВы: {rank} место, {acts}.',
  'top.note': '<i>Обновляется раз в минуту. Полная таблица — в кабинете.</i>',
  'top.anon': 'Участник',

  'notify.acts': '📈 +{delta} {word}!\nВсего у вас: <b>{total}</b>. {tail}',
  'notify.actsTailLeft': 'До порога ещё {left}.',
  'notify.actsTailDone': 'Порог пройден — вы в распределении призов.',
  'notify.threshold': '🟢 <b>Порог пройден!</b>\n\nУ вас {acts} — это больше {min}, ' +
    'и теперь вы участвуете в распределении призов.\nЧем выше место, тем больше приз, так что не останавливайтесь.',
  'notify.rankUp': '🏆 Вы поднялись на <b>{rank} место</b>!\nАктиваций: {total}.',
  'notify.threeDays': '⏳ <b>Три дня до финиша</b>\n\n{where}\n' +
    'Приём активаций закрывается {date}. Последние дни обычно решают всё — самое время напомнить о коде своей аудитории.',
  'notify.threeDaysWhere': 'Сейчас вы на {rank} месте, активаций: {acts}.',
  'notify.threeDaysNone': 'Активаций пока нет.',
  'notify.resultsNone': '🏁 <b>Конкурс завершён</b>\n\nСпасибо, что участвовали! ' +
    'В этот раз активаций по вашему коду не набралось, но код продолжает работать — сказки по нему по-прежнему открываются.',
  'notify.resultsWin': '🎉 <b>Вы в числе победителей!</b>\n\n' +
    'Итоговое место: <b>{rank}</b>, активаций: {acts}.\nПриз — {sum}. ' +
    'Мы свяжемся с вами по указанному телефону, чтобы договориться о выплате.',
  'notify.resultsPlain': '🏁 <b>Конкурс завершён</b>\n\n' +
    'Ваше итоговое место: <b>{rank}</b>, активаций: {acts}.\nВ призовую часть в этот раз не попали — но спасибо, что были с нами.',

  'help': 'Что я умею:\n\n/start — условия конкурса\n/status — мой промокод, активации и место\n' +
    '/top — рейтинг участников\n/lang — язык бота\n/help — это сообщение\n\n' +
    'Если у вас вопрос по конкурсу — напишите нам в поддержку, я передам.',
  'unknown': 'Я понимаю только кнопки и команды: /start, /status, /top, /help.',
  'langAsk': 'Выберите язык / Тілді таңдаңыз',
  'langChanged': '✅ Язык переключён на русский.',

  'btn.join': '📝 Участвовать',
  'btn.needPhone': '📱 Указать телефон',
  'btn.cabinet': '📊 Кабинет и рейтинг',
  'btn.status': '🏆 Мой результат',
  'btn.top': '🏆 Рейтинг',
  'btn.phone': '📱 Отправить телефон',
  'btn.lang': '🌐 Тілді ауыстыру',
};

const KK: Dict = {
  'terms.head': '🎁 <b>{title}</b>',
  'terms.fund': 'Жүлде қоры — <b>{fund}</b>, {winners}.',
  'terms.how': '<b>Бұл қалай жұмыс істейді</b>\n' +
    '1️⃣ Сіз жеке промокод аласыз\n' +
    '2️⃣ Оны видео мен сторизде айтасыз\n' +
    '3️⃣ Көрермен Bala Stories орнатып, кодыңызды енгізеді — бұл белсендіру\n' +
    '4️⃣ Белсендіру неғұрлым көп болса, рейтингте соғұрлым жоғарысыз',
  'terms.gate': 'Жүлде бөлісіне қатысу үшін кемінде <b>{min}</b> {acts} қажет.',
  'terms.until': 'Байқау <b>{date}</b> дейін — {left} қалды.',

  'winners.n': '{n} {word}',
  'winners.word.one': 'жеңімпаз',
  'winners.word.few': 'жеңімпаз',
  'winners.word.many': 'жеңімпаз',

  'beforeStart': '🎁 <b>{title}</b>\n\nБайқау {date} басталады. Сол уақытта оралыңыз.',
  'afterEnd': '⏳ Байқау аяқталды.\n\nБелсендірулерді қабылдау {date} жабылды. ' +
    'Қорытынды тіркелді — нәтижеңізді кабинеттен көруге болады.',

  'notPublic': '🐣 Байқау жақында өтінімдерді қабылдай бастайды.\n\n' +
    'Сәл кейінірек қараңыз — мұнда шарттар мен жеке промокодыңыз пайда болады.',
  'noContest': '🐣 Байқау әзірге бапталуда. Сәл кейінірек қараңыз.',
  'notRegistered': 'Сіз әзірге байқауға қатыспайсыз.\n\n/start басып, «Қатысу» түймесін таңдаңыз — бұл екі минут.',

  'askPhone': '📱 <b>1-қадам, барлығы 2 — телефон</b>\n\n' +
    'Жеңсеңіз, жүлдені сол нөмір арқылы тапсырамыз, сұрақ туса — сізді табамыз.\n\n' +
    'Төмендегі түймені басыңыз — Telegram нөмірді өзі жібереді. Хабарламамен жазуға да болады.',
  'foreignContact': 'Бұл басқа адамның контактісі. «Телефонды жіберу» түймесін басыңыз — Telegram сіздің нөміріңізді жібереді.',
  'badPhone': 'Телефон нөміріне ұқсамайды. +7 777 123 45 67 түрінде жіберіңіз — немесе төмендегі түймені басыңыз.',
  'phoneNeedsProof': 'Бұл нөмір байқауға қатысып жатыр.\n\n' +
    'Егер ол сіздікі болса — төмендегі «Телефонды жіберу» түймесін басыңыз, промокодыңызды көрсетемін. ' +
    'Осылай нөмірдің шынымен сіздікі екеніне көз жеткіземін.',
  'phoneTakenByOther': 'Бұл нөмір басқа Telegram аккаунтына тіркелген.\n\n' +
    'Егер бұл сіздің нөміріңіз болып, кіру мүмкіндігі жоғалса — бізге жазыңыз, қолмен шешеміз.',
  'phoneMissing': '\n\n⚠️ Телефоныңыз көрсетілмеген. Онсыз жүлде бойынша хабарласа алмаймыз — ' +
    'төмендегі түймені басыңыз, бұл бір ғана түрту.',

  'askSocial': '📸 <b>2-қадам, барлығы 2 — қайда түсіресіз</b>\n\n' +
    'Instagram, TikTok немесе YouTube профиліңізге сілтеме жіберіңіз. Instagram нигін жазсаңыз да болады.',
  'badSocial': 'Түсінбедім. Профильге сілтеме жіберіңіз — мысалы instagram.com/username — немесе ник.',

  'welcomeBack': '✅ Таптым — сіз сайтта тіркелгенсіз, екінші код қажет емес.\n\n' +
    'Промокодыңыз: <code>{code}</code>\n\nЕнді жаңа белсендірулерді осында жіберіп тұрамын. Байқау аяқталуына: {left}.',
  'codeIssued': '🎉 <b>Дайын, сіз қатысасыз!</b>\n\n' +
    'Промокодыңыз: <code>{code}</code>\n<i>көшіру үшін кодты басыңыз</i>\n\n' +
    '<b>Әрі қарай не істеу керек</b>\n' +
    'Кодты видео мен сторизде айтыңыз: көрермен Bala Stories орнатып, кодты енгізеді — ' +
    'ол сыйға ертегілер алады, ал сізге белсендіру жазылады.\n\n' +
    'Жүлде бөлісіне қатысу үшін кемінде {min} {acts} қажет. Байқау аяқталуына: {left}.\n\n' +
    'Жаңа белсендірулерді өзім хабарлап тұрамын.',

  'status.head': 'Промокодыңыз: <code>{code}</code>',
  'status.none': 'Әзірге белсендіру жоқ.\nКодты видеода айтыңыз — көрермен қолданбаны орнатып, енгізген бойда хабарлаймын.',
  'status.rank': '🏆 Орын: <b>{rank}</b>\n📈 Белсендіру: <b>{acts}</b>',
  'status.gateOk': '🟢 Шарт орындалды — жүлде бөлісіне қатысасыз.',
  'status.gateLeft': '🔴 Шартқа дейін тағы {left}.',
  'status.prize': '💰 Осы орынның жүлдесі — {sum}.',
  'status.left': 'Байқау аяқталуына: {left}.',

  'top.head': '🏆 <b>Байқау рейтингі</b>',
  'top.empty': 'Әзірге ешкімде белсендіру жоқ. Бәрін бірінші видео шешеді.',
  'top.you': '\nСіз: {rank}-орын, {acts}.',
  'top.note': '<i>Минут сайын жаңарады. Толық кесте — кабинетте.</i>',
  'top.anon': 'Қатысушы',

  'notify.acts': '📈 +{delta} {word}!\nБарлығы: <b>{total}</b>. {tail}',
  'notify.actsTailLeft': 'Шартқа дейін тағы {left}.',
  'notify.actsTailDone': 'Шарт орындалды — жүлде бөлісіндесіз.',
  'notify.threshold': '🟢 <b>Шарт орындалды!</b>\n\nСізде {acts} — бұл {min}-дан көп, ' +
    'енді жүлде бөлісіне қатысасыз.\nОрын жоғары болған сайын жүлде де үлкен, сондықтан тоқтамаңыз.',
  'notify.rankUp': '🏆 Сіз <b>{rank}-орынға</b> көтерілдіңіз!\nБелсендіру: {total}.',
  'notify.threeDays': '⏳ <b>Финишке үш күн</b>\n\n{where}\n' +
    'Белсендірулерді қабылдау {date} жабылады. Соңғы күндер бәрін шешеді — аудиторияңызға кодты еске салатын кез.',
  'notify.threeDaysWhere': 'Қазір сіз {rank}-орындасыз, белсендіру: {acts}.',
  'notify.threeDaysNone': 'Әзірге белсендіру жоқ.',
  'notify.resultsNone': '🏁 <b>Байқау аяқталды</b>\n\nҚатысқаныңызға рахмет! ' +
    'Бұл жолы кодыңыз бойынша белсендіру жиналмады, бірақ код жұмыс істей береді — ертегілер бұрынғыдай ашылады.',
  'notify.resultsWin': '🎉 <b>Сіз жеңімпаздар қатарындасыз!</b>\n\n' +
    'Қорытынды орын: <b>{rank}</b>, белсендіру: {acts}.\nЖүлде — {sum}. ' +
    'Төлем туралы келісу үшін көрсеткен телефоныңызға хабарласамыз.',
  'notify.resultsPlain': '🏁 <b>Байқау аяқталды</b>\n\n' +
    'Қорытынды орныңыз: <b>{rank}</b>, белсендіру: {acts}.\nБұл жолы жүлдеге ілікпедіңіз — бірақ бізбен бірге болғаныңызға рахмет.',

  'help': 'Не істей аламын:\n\n/start — байқау шарттары\n/status — промокодым, белсендірулер және орын\n' +
    '/top — қатысушылар рейтингі\n/lang — бот тілі\n/help — осы хабарлама\n\n' +
    'Байқау бойынша сұрағыңыз болса — қолдау қызметіне жазыңыз, жеткіземін.',
  'unknown': 'Мен тек түймелер мен командаларды түсінемін: /start, /status, /top, /help.',
  'langAsk': 'Тілді таңдаңыз / Выберите язык',
  'langChanged': '✅ Тіл қазақшаға ауыстырылды.',

  'btn.join': '📝 Қатысу',
  'btn.needPhone': '📱 Телефонды көрсету',
  'btn.cabinet': '📊 Кабинет пен рейтинг',
  'btn.status': '🏆 Менің нәтижем',
  'btn.top': '🏆 Рейтинг',
  'btn.phone': '📱 Телефонды жіберу',
  'btn.lang': '🌐 Сменить язык',
};

const DICT: Record<Lang, Dict> = { ru: RU, kk: KK };

/** Недостающий ключ падает на русский, а не на пустоту: текст важнее чистоты. */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICT[lang]?.[key] ?? RU[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

function winnersWord(lang: Lang, n: number): string {
  const key = lang === 'kk'
    ? 'winners.word.one'
    : `winners.word.${plural(n, 'one', 'few', 'many')}`;
  return t(lang, 'winners.n', { n, word: t(lang, key) });
}

function prizeLines(lang: Lang): string {
  const medals = ['🥇', '🥈', '🥉'];
  return prizeTable()
    .map((row, i) => {
      const place = row.fromRank === row.toRank
        ? (lang === 'kk' ? `${row.fromRank}-орын` : `${row.fromRank} место`)
        : (lang === 'kk' ? `${row.fromRank}–${row.toRank} орын` : `${row.fromRank}–${row.toRank} места`);
      const sum = row.winners === 1
        ? money(row.amount)
        : (lang === 'kk' ? `${money(row.amount)} әрқайсысына` : `по ${money(row.amount)}`);
      return `${medals[i] || '🎁'} ${place} — ${sum}`;
    })
    .join('\n');
}

// ─────────────────────────── экраны ───────────────────────────

export function terms(lang: Lang, contest: Contest): string {
  return (
    t(lang, 'terms.head', { title: esc(contest.title) }) + '\n\n' +
    t(lang, 'terms.fund', { fund: money(PRIZE_FUND), winners: winnersWord(lang, WINNERS_TOTAL) }) + '\n' +
    prizeLines(lang) + '\n\n' +
    t(lang, 'terms.how') + '\n\n' +
    t(lang, 'terms.gate', { min: contest.minActivations, acts: lang === 'kk' ? 'белсендіру' : plural(contest.minActivations, 'активация', 'активации', 'активаций') }) + '\n' +
    t(lang, 'terms.until', { date: almatyDate(contest.endsAt, lang), left: timeLeft(contest.endsAt, lang) })
  );
}

export function beforeStart(lang: Lang, contest: Contest): string {
  return t(lang, 'beforeStart', { title: esc(contest.title), date: almatyDate(contest.startsAt, lang) });
}

export function afterEnd(lang: Lang, contest: Contest): string {
  return t(lang, 'afterEnd', { date: almatyDate(contest.endsAt, lang) });
}

export const notPublic = (lang: Lang) => t(lang, 'notPublic');
export const noContest = (lang: Lang) => t(lang, 'noContest');
export const notRegisteredYet = (lang: Lang) => t(lang, 'notRegistered');
export const askPhone = (lang: Lang) => t(lang, 'askPhone');
export const foreignContact = (lang: Lang) => t(lang, 'foreignContact');
export const badPhone = (lang: Lang) => t(lang, 'badPhone');
export const phoneNeedsProof = (lang: Lang) => t(lang, 'phoneNeedsProof');
export const phoneTakenByOther = (lang: Lang) => t(lang, 'phoneTakenByOther');
export const phoneMissing = (lang: Lang) => t(lang, 'phoneMissing');
export const askSocial = (lang: Lang) => t(lang, 'askSocial');
export const badSocial = (lang: Lang) => t(lang, 'badSocial');
export const help = (lang: Lang) => t(lang, 'help');
export const unknown = (lang: Lang) => t(lang, 'unknown');
export const langAsk = (lang: Lang) => t(lang, 'langAsk');
export const langChanged = (lang: Lang) => t(lang, 'langChanged');
export const btn = (lang: Lang, key: string) => t(lang, `btn.${key}`);

export function welcomeBack(lang: Lang, contest: Contest, code: string): string {
  return t(lang, 'welcomeBack', { code, left: timeLeft(contest.endsAt, lang) });
}

export function codeIssued(lang: Lang, contest: Contest, code: string): string {
  return t(lang, 'codeIssued', {
    code,
    min: contest.minActivations,
    acts: lang === 'kk' ? 'белсендіру' : plural(contest.minActivations, 'активация', 'активации', 'активаций'),
    left: timeLeft(contest.endsAt, lang),
  });
}

export function status(lang: Lang, contest: Contest, code: string, row: StandingRow | null): string {
  const head = t(lang, 'status.head', { code }) + '\n\n';
  const left = t(lang, 'status.left', { left: timeLeft(contest.endsAt, lang) });

  if (!row || row.rank === null) {
    return `${head}${t(lang, 'status.none')}\n\n${left}`;
  }

  const remaining = Math.max(0, contest.minActivations - row.activations);
  const gate = row.qualified
    ? t(lang, 'status.gateOk')
    : t(lang, 'status.gateLeft', { left: acts(remaining, lang) });
  const prize = row.prizeAmount ? '\n' + t(lang, 'status.prize', { sum: money(row.prizeAmount) }) : '';

  return (
    head +
    t(lang, 'status.rank', { rank: row.rank, acts: row.activations }) + '\n' +
    gate + prize + '\n\n' + left
  );
}

/** Открытый рейтинг: те же строки, что на сайте, с никами. */
export function top(lang: Lang, rows: StandingRow[], mine: StandingRow | null): string {
  if (!rows.length) return `${t(lang, 'top.head')}\n\n${t(lang, 'top.empty')}`;

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const place = medals[i] || `${r.rank}.`;
    const nick = esc(r.nick || t(lang, 'top.anon'));
    return `${place} ${nick} — <b>${r.activations}</b>`;
  });

  const you = mine && mine.rank && !rows.some((r) => r.participantId === mine.participantId)
    ? t(lang, 'top.you', { rank: mine.rank, acts: acts(mine.activations, lang) })
    : '';

  return `${t(lang, 'top.head')}\n\n${lines.join('\n')}\n${you}\n${t(lang, 'top.note')}`;
}

// ─────────────────────────── уведомления ───────────────────────────

export function notifyActivations(lang: Lang, delta: number, total: number, contest: Contest): string {
  const remaining = Math.max(0, contest.minActivations - total);
  const tail = remaining > 0
    ? t(lang, 'notify.actsTailLeft', { left: acts(remaining, lang) })
    : t(lang, 'notify.actsTailDone');
  const word = lang === 'kk' ? 'белсендіру' : plural(delta, 'активация', 'активации', 'активаций');
  return t(lang, 'notify.acts', { delta, word, total, tail });
}

export function notifyThreshold(lang: Lang, total: number, contest: Contest): string {
  return t(lang, 'notify.threshold', { acts: acts(total, lang), min: contest.minActivations });
}

export function notifyRankUp(lang: Lang, rank: number, total: number, prizeAmount: number | null): string {
  const prize = prizeAmount ? '\n' + t(lang, 'status.prize', { sum: money(prizeAmount) }) : '';
  return t(lang, 'notify.rankUp', { rank, total }) + prize;
}

export function notifyThreeDays(lang: Lang, contest: Contest, total: number, rank: number | null): string {
  const where = rank
    ? t(lang, 'notify.threeDaysWhere', { rank, acts: total })
    : t(lang, 'notify.threeDaysNone');
  return t(lang, 'notify.threeDays', { where, date: almatyDate(contest.endsAt, lang) });
}

export function notifyResults(lang: Lang, row: StandingRow | null): string {
  if (!row || row.rank === null) return t(lang, 'notify.resultsNone');
  if (row.prizeAmount) {
    return t(lang, 'notify.resultsWin', { rank: row.rank, acts: row.activations, sum: money(row.prizeAmount) });
  }
  return t(lang, 'notify.resultsPlain', { rank: row.rank, acts: row.activations });
}
