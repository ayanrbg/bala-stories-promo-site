import { Router } from 'express';
import { fairyProxy } from '../lib/fairyProxy';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: proxies the admin activity feed of the Fairy-Tales backend.
const router = Router();
router.use(authenticateToken, requireRole('admin'));

router.get('/', (req, res) => fairyProxy(req, res, '/api/admin/alerts'));
router.post('/read', (req, res) => fairyProxy(req, res, '/api/admin/alerts/read'));

export default router;
