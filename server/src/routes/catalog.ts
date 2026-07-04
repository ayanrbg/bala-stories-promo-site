import { Router, Request, Response } from 'express';
import https from 'https';
import { URL } from 'url';
import { authenticateToken, requireRole } from '../middleware/auth';

// Additive BFF: proxies the catalog admin API of the Fairy-Tales backend.
// The Fairy admin key lives ONLY here (server-side); the browser never sees it.
// The human is authenticated by the existing admin login (JWT + role).
const router = Router();
router.use(authenticateToken, requireRole('admin'));

const FAIRY_API_URL = process.env.FAIRY_API_URL || 'https://127.0.0.1:3000';
const FAIRY_ADMIN_KEY = process.env.FAIRY_ADMIN_KEY || '';

// Target is loopback; its TLS cert is for the public hostname, so we skip the
// hostname check for this local call only (no MITM risk on 127.0.0.1).
const agent = new https.Agent({ rejectUnauthorized: false });

function proxy(req: Request, res: Response, targetPath: string): void {
  const started = Date.now();
  const actor = (req.user && req.user.id) || 'admin';
  const base = new URL(FAIRY_API_URL);
  const qIndex = req.originalUrl.indexOf('?');
  const query = qIndex >= 0 ? req.originalUrl.slice(qIndex) : '';
  const fullPath = targetPath + query;

  const isMultipart = !!req.is('multipart/form-data');
  const headers: Record<string, string> = {
    'X-Admin-Key': FAIRY_ADMIN_KEY,
    'X-Admin-Actor': String(actor),
  };

  let bodyBuf: Buffer | null = null;
  if (isMultipart) {
    // Pass the multipart stream through untouched (express.json ignores it).
    headers['Content-Type'] = String(req.headers['content-type']);
    if (req.headers['content-length']) headers['Content-Length'] = String(req.headers['content-length']);
  } else if (req.body && Object.keys(req.body).length) {
    // express.json already parsed JSON bodies; re-serialize.
    bodyBuf = Buffer.from(JSON.stringify(req.body));
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(bodyBuf.length);
  }

  const upstream = https.request(
    {
      hostname: base.hostname,
      port: base.port,
      path: fullPath,
      method: req.method,
      headers,
      agent,
    },
    (up) => {
      res.status(up.statusCode || 502);
      const ct = up.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct as string);
      up.pipe(res);
      up.on('end', () => {
        console.log(`[PROXY] ${req.method} ${fullPath} actor=${actor} -> ${up.statusCode} ${Date.now() - started}ms`);
      });
    }
  );

  upstream.on('error', (e) => {
    console.error(`[PROXY] ${req.method} ${fullPath} error: ${e.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'upstream_error', detail: e.message });
  });

  if (isMultipart) {
    req.pipe(upstream);
  } else {
    if (bodyBuf) upstream.write(bodyBuf);
    upstream.end();
  }
}

const T = '/api/admin/tales';
const id = (req: Request) => encodeURIComponent(String(req.params.id));
const page = (req: Request) => encodeURIComponent(String(req.params.page));

// Read
router.get('/', (req, res) => proxy(req, res, T));
router.get('/:id/content-check', (req, res) => proxy(req, res, `${T}/${id(req)}/content-check`));

// Catalog metadata
router.post('/', (req, res) => proxy(req, res, T));
router.patch('/:id', (req, res) => proxy(req, res, `${T}/${id(req)}`));
router.post('/:id/coming-soon', (req, res) => proxy(req, res, `${T}/${id(req)}/coming-soon`));
router.post('/:id/publish', (req, res) => proxy(req, res, `${T}/${id(req)}/publish`));
router.post('/:id/reorder', (req, res) => proxy(req, res, `${T}/${id(req)}/reorder`));
router.put('/:id/pages', (req, res) => proxy(req, res, `${T}/${id(req)}/pages`));

// Content (multipart uploads streamed through)
router.post('/:id/cover', (req, res) => proxy(req, res, `${T}/${id(req)}/cover`));
router.post('/:id/illustration/:page', (req, res) => proxy(req, res, `${T}/${id(req)}/illustration/${page(req)}`));
router.delete('/:id/illustration/:page', (req, res) => proxy(req, res, `${T}/${id(req)}/illustration/${page(req)}`));

// Soft delete (registered last so it does not shadow the illustration route)
router.delete('/:id', (req, res) => proxy(req, res, `${T}/${id(req)}`));

export default router;
