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

/**
 * @param queryOverride строка вида "?a=1&b=2". Нужна там, где параметры задаёт
 * сервер, а не браузер: блогер не должен уметь спросить чужую статистику,
 * подставив свой bloggerId в адрес.
 */
export function fairyProxy(req: Request, res: Response, targetPath: string, queryOverride?: string): void {
  const started = Date.now();
  const actor = (req.user && req.user.id) || 'admin';
  const base = new URL(FAIRY_API_URL);
  const qIndex = req.originalUrl.indexOf('?');
  const query = queryOverride !== undefined ? queryOverride : (qIndex >= 0 ? req.originalUrl.slice(qIndex) : '');
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

/**
 * Тот же ключ, но ответ разбирается здесь, а не утекает в браузер как есть.
 * Нужен там, где страница показывает не «что ответил Fairy», а склейку его
 * цифр с нашими кодами — и решать, что из этой склейки публично, должны мы.
 *
 * Ответ не-2xx поднимается ошибкой: витрина лучше покажет «не смогла», чем
 * тихо нарисует нули там, где на самом деле упал апстрим.
 */
export function fairyFetch<T = any>(targetPath: string, query = '', actor = 'public'): Promise<T> {
  const base = new URL(FAIRY_API_URL);
  const fullPath = targetPath + query;
  const started = Date.now();

  return new Promise<T>((resolve, reject) => {
    const upstream = https.request(
      {
        hostname: base.hostname,
        port: base.port,
        path: fullPath,
        method: 'GET',
        headers: { 'X-Admin-Key': FAIRY_ADMIN_KEY, 'X-Admin-Actor': actor },
        agent,
        timeout: 15000,
      },
      (up) => {
        const chunks: Buffer[] = [];
        up.on('data', (c) => chunks.push(c as Buffer));
        up.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          console.log(`[FETCH] GET ${fullPath} actor=${actor} -> ${up.statusCode} ${Date.now() - started}ms`);
          if (!up.statusCode || up.statusCode < 200 || up.statusCode >= 300) {
            reject(new Error(`fairy ${up.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('fairy returned non-JSON'));
          }
        });
      }
    );

    upstream.on('timeout', () => upstream.destroy(new Error('fairy timeout')));
    upstream.on('error', reject);
    upstream.end();
  });
}
