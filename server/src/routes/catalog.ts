import { Router, Request } from 'express';
import { fairyProxy } from '../lib/fairyProxy';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: proxies the catalog admin API of the Fairy-Tales backend.
// Human is authenticated by the existing admin login (JWT + role); the Fairy
// admin key is injected server-side by fairyProxy.
const router = Router();
router.use(authenticateToken, requireRole('admin'));

const T = '/api/admin/tales';
const tid = (req: Request) => encodeURIComponent(String(req.params.id));
const tpage = (req: Request) => encodeURIComponent(String(req.params.page));

// Read
router.get('/', (req, res) => fairyProxy(req, res, T));
router.get('/:id/content-check', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/content-check`));
router.get('/:id', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}`));

// Catalog metadata
router.post('/', (req, res) => fairyProxy(req, res, T));
router.patch('/:id', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}`));
router.post('/:id/coming-soon', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/coming-soon`));
router.post('/:id/publish', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/publish`));
router.post('/:id/reorder', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/reorder`));
router.put('/:id/pages', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/pages`));

// Content (multipart uploads streamed through)
router.post('/:id/scenario', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/scenario`));
router.post('/:id/cover', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/cover`));
router.post('/:id/illustration/:page', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/illustration/${tpage(req)}`));
router.delete('/:id/illustration/:page', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}/illustration/${tpage(req)}`));

// Soft delete (registered last so it does not shadow the illustration route)
router.delete('/:id', (req, res) => fairyProxy(req, res, `${T}/${tid(req)}`));

export default router;
