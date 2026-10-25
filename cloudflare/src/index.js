// Cloudflare Worker in front of the SUMOVA container.
//  - www.sumova.org → https://sumova.org (301, path and query kept)
//  - forwards every request to one container instance (SQLite has a single writer)
//  - passes the visitor IP as X-Forwarded-For so the app (TRUST_PROXY=1) rate-limits real visitors
//  - cron every 5 minutes: checks /healthz and keeps the container awake (always-on)
import { Container, getContainer } from '@cloudflare/containers';
import { canonicalRedirect } from './redirect.js';

const SECRETS = ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'RESTORE_BACKUP'];

export class SumovaSite extends Container {
  defaultPort = 3000;
  sleepAfter = '30m'; // the 5-minute cron renews this, so the site never sleeps
  enableInternet = true; // SMTP (Outlook) and R2

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production', PORT: '3000', DATA_DIR: '/data',
      COOKIE_SECURE: '1', TRUST_PROXY: '1', SITE_URL: env.SITE_URL || 'https://sumova.org',
      R2_BUCKET: env.R2_BUCKET || 'sumova-data',
      ...Object.fromEntries(SECRETS.filter((k) => env[k]).map((k) => [k, String(env[k])])),
    };
  }
}

const site = (env) => getContainer(env.SITE, 'main');
// Never start the container without persistence: its disk is wiped on restart, so data written then would be lost.
const REQUIRED = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missing = (env) => REQUIRED.filter((k) => !env[k]);

export default {
  async fetch(request, env) {
    const to = canonicalRedirect(request.url, env.APEX || 'sumova.org');
    if (to) return Response.redirect(to, 301);
    if (missing(env).length) return new Response('الموقع قيد الإعداد. Site setup in progress.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '600' } });
    const h = new Headers(request.headers);
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) h.set('x-forwarded-for', ip); else h.delete('x-forwarded-for');
    h.set('x-forwarded-proto', new URL(request.url).protocol.replace(':', ''));
    return site(env).fetch(new Request(request, { headers: h }));
  },

  async scheduled(_event, env) {
    if (missing(env).length) return console.error('secrets missing, container not started:', missing(env).join(', '));
    const r = await site(env).fetch(new Request(`https://${env.APEX || 'sumova.org'}/healthz`)).catch((e) => ({ ok: false, status: String(e) }));
    if (!r.ok) console.error('healthz failed', r.status); // visible in Workers logs; external email alerts: see DEPLOY.md
  },
};
