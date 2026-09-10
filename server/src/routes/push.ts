import { Router } from 'express';
import { fairyProxy } from '../lib/fairyProxy';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: proxies the user push-notification admin API of the Fairy
// backend so the admin site can compose / segment / send push campaigns
// in-page. The human is authenticated by the existing admin login (JWT + role);
// the Fairy admin key is injected server-side by fairyProxy and never reaches
// the browser.
const router = Router();
router.use(authenticateToken, requireRole('admin'));

const base = '/api/admin/push';
const cid = (req: { params: { id: string } }) => encodeURIComponent(req.params.id);

router.get('/tokens/stats', (req, res) => fairyProxy(req, res, base + '/tokens/stats'));
router.get('/campaigns', (req, res) => fairyProxy(req, res, base + '/campaigns'));
router.get('/campaigns/:id', (req, res) => fairyProxy(req, res, base + '/campaigns/' + cid(req)));
router.post('/campaigns', (req, res) => fairyProxy(req, res, base + '/campaigns'));
router.put('/campaigns/:id', (req, res) => fairyProxy(req, res, base + '/campaigns/' + cid(req)));
router.post('/campaigns/:id/send', (req, res) => fairyProxy(req, res, base + '/campaigns/' + cid(req) + '/send'));
router.post('/campaigns/:id/cancel', (req, res) => fairyProxy(req, res, base + '/campaigns/' + cid(req) + '/cancel'));
router.post('/preview-audience', (req, res) => fairyProxy(req, res, base + '/preview-audience'));
router.post('/test', (req, res) => fairyProxy(req, res, base + '/test'));

export default router;
