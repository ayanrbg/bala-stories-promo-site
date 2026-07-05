import { Router } from 'express';
import { fairyProxy } from '../lib/fairyProxy';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: proxies the remote log mirror of the Fairy-Tales backend so the
// admin site can read device logs in-page and drive the server-side kill-switch.
// The Fairy admin key stays server-side (in fairyProxy); the browser never sees it.
const router = Router();
router.use(authenticateToken, requireRole('admin'));

// Mirrored Unity log lines (oldest->newest). Filters (userId/session/level/limit)
// are forwarded as the query string by fairyProxy.
router.get('/', (req, res) => fairyProxy(req, res, '/api/debug/logs'));

// Logging policy / kill-switch: list, upsert (global or per-user), delete override.
router.get('/config', (req, res) => fairyProxy(req, res, '/api/admin/debug/log-config'));
router.put('/config', (req, res) => fairyProxy(req, res, '/api/admin/debug/log-config'));
router.delete('/config', (req, res) => fairyProxy(req, res, '/api/admin/debug/log-config'));

export default router;
