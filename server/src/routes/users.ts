import { Router } from 'express';
import { fairyProxy } from '../lib/fairyProxy';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: look up child names (from the Fairy backend) by userId.
const router = Router();
router.use(authenticateToken, requireRole('admin'));

router.post('/names', (req, res) => fairyProxy(req, res, '/api/admin/users/names'));

export default router;
