import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import bloggerRoutes from './routes/blogger';
import promoRoutes from './routes/promo';
import catalogRoutes from './routes/catalog';
import alertsRoutes from './routes/alerts';
import usersRoutes from './routes/users';
import analyticsRoutes from './routes/analytics';
import logsRoutes from './routes/logs';
import pushRoutes from './routes/push';
import publicStatsRoutes from './routes/publicStats';
import contestRoutes from './routes/contest';
import adminContestRoutes from './routes/adminContest';

const app = express();

app.use(cors());
app.use(express.json());

// Кабинет участника стоит за nginx, а лимиты и логи смотрят на IP клиента,
// а не на 127.0.0.1. Доверяем только своему прокси, не цепочке из интернета.
app.set('trust proxy', 1);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../client')));

// API routes
app.use('/api/auth', authRoutes);
// Стоит выше общего /api/admin: свой файл, свой список участников, свои кнопки
// фиксации — в admin.ts им нечего делать рядом с выдачей премиум-кодов.
app.use('/api/admin/contest', adminContestRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/blogger', bloggerRoutes);
app.use('/api/promo', promoRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/push', pushRoutes);

// Открытая витрина промокодов блогеров: без логина, только счётчики. Отдельный
// префикс, а не ветка внутри /api/admin, — чтобы «публично» читалось из адреса
// и нельзя было по неосторожности выставить наружу админскую ручку.
app.use('/api/public', publicStatsRoutes);

// Кабинет участника конкурса: свой вход (Google + кука), свои данные. Админский
// Bearer-токен сюда не ходит и не должен.
app.use('/api/contest', contestRoutes);

// Своя страница, а не вкладка админского SPA: у неё нет ни токена, ни доступа
// к его коду. Диктовать блогерам /blogers проще, чем ссылку с параметрами.
app.get('/blogers', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/blogers.html'));
});

// Кабинет участника конкурса. Ссылку кладут в шапку профиля — она должна быть
// короткой и без расширения.
app.get('/ugc', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/ugc.html'));
});

// Правовые страницы: на них ссылается экран согласия Google, поэтому адреса
// должны пережить любую перестройку кабинета.
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/privacy.html'));
});
app.get('/terms', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/terms.html'));
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

export default app;
