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

const app = express();

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../client')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/blogger', bloggerRoutes);
app.use('/api/promo', promoRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/analytics', analyticsRoutes);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

export default app;
