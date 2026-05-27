import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { login, password } = req.body;

  if (!login || !password) {
    res.status(400).json({ error: 'Логин и пароль обязательны' });
    return;
  }

  // Check admin credentials
  if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
    const accessToken = jwt.sign(
      { id: 'admin', role: 'admin' },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );
    const refreshToken = jwt.sign(
      { id: 'admin', role: 'admin' },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '7d' }
    );
    res.json({ accessToken, refreshToken, role: 'admin' });
    return;
  }

  // Check blogger credentials
  const blogger = await prisma.blogger.findUnique({ where: { login } });

  if (!blogger) {
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }

  const validPassword = await bcrypt.compare(password, blogger.passwordHash);
  if (!validPassword) {
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }

  const accessToken = jwt.sign(
    { id: blogger.id, role: 'blogger' },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  );
  const refreshToken = jwt.sign(
    { id: blogger.id, role: 'blogger' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '7d' }
  );

  res.json({ accessToken, refreshToken, role: 'blogger' });
});

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token обязателен' });
    return;
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { id: string; role: string };
    const accessToken = jwt.sign(
      { id: payload.id, role: payload.role },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );
    res.json({ accessToken });
  } catch {
    res.status(403).json({ error: 'Невалидный refresh token' });
  }
});

export default router;
