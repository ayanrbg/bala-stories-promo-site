import { Request, Response } from 'express';
import https from 'https';
import { URL } from 'url';

// Shared BFF proxy to the Fairy-Tales backend admin API. The Fairy admin key
// lives ONLY here (server-side); the browser never sees it. Callers must guard
// their routes with the admin JWT before delegating here.
const FAIRY_API_URL = process.env.FAIRY_API_URL || 'https://127.0.0.1:3000';
const FAIRY_ADMIN_KEY = process.env.FAIRY_ADMIN_KEY || '';

// Target is loopback; its TLS cert is for the public hostname, so we skip the
// hostname check for this local call only (no MITM risk on 127.0.0.1).
const agent = new https.Agent({ rejectUnauthorized: false });

export function fairyProxy(req: Request, res: Response, targetPath: string): void {
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
    headers['Content-Type'] = String(req.headers['content-type']);
    if (req.headers['content-length']) headers['Content-Length'] = String(req.headers['content-length']);
  } else if (req.body && Object.keys(req.body).length) {
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
