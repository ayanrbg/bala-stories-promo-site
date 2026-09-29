import { Router } from 'express';
import { fairyProxy } from '../lib/fairyProxy';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: proxies the (read-only) analytics mirror of the Fairy-Tales
// backend so the admin site can show app analytics in-page. The human is
// authenticated by the existing admin login (JWT + role); the Fairy admin key
// is injected server-side by fairyProxy and never reaches the browser.
const router = Router();
router.use(authenticateToken, requireRole('admin'));

// Воронка, дочитывание и здоровье данных — всё, что нужно вкладке «Аналитика»,
// чтобы отвечать на вопрос «где отсеиваются люди», а не только «сколько событий».
router.get('/funnel', (req, res) => fairyProxy(req, res, '/api/analytics/funnel'));
router.get('/reading', (req, res) => fairyProxy(req, res, '/api/analytics/reading'));
router.get('/health', (req, res) => fairyProxy(req, res, '/api/analytics/health'));
router.get('/retention', (req, res) => fairyProxy(req, res, '/api/analytics/retention'));
router.get('/summary', (req, res) => fairyProxy(req, res, '/api/analytics/summary'));
router.get('/events', (req, res) => fairyProxy(req, res, '/api/analytics/events'));
router.get('/insights', (req, res) => fairyProxy(req, res, '/api/analytics/insights'));
router.get('/tale/:id', (req, res) => fairyProxy(req, res, '/api/analytics/tale/' + encodeURIComponent(req.params.id)));

export default router;
