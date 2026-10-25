// Two-step verification: RFC 6238 TOTP (SHA-1, 6 digits, 30 s) + one-time recovery codes
import crypto from 'node:crypto';
import qrcode from 'qrcode-generator';
import { one, run, tx } from './db.js';
import { sha } from './auth.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
export const MFA_ROLES = ['owner', 'admin']; // two-step verification is mandatory for these roles

export function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

export const newSecret = () => b32encode(crypto.randomBytes(20));
export const stepNow = (t = Date.now()) => Math.floor(t / 1000 / STEP);

export function hotp(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Accepts the previous, current or next 30-second code. A step at or before `lastStep` is
// refused so an intercepted code cannot be replayed. Returns the matched step or null.
export function verifyTotp(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !secret) return null;
  const now = stepNow();
  for (const s of [now - 1, now, now + 1]) {
    if (s <= lastStep) continue;
    const a = Buffer.from(hotp(secret, s)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return null;
}

export const otpauthUri = (secret, email, issuer = 'SUMOVA') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

// QR as a self-contained SVG string (dark modules on white, 4-module quiet zone)
export function qrSvg(text, size = 220) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = n + 8;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m} ${m}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="رمز QR لإضافة الحساب إلى تطبيق المصادقة"><rect width="${m}" height="${m}" fill="#fff"/><path d="${d}" fill="#051427"/></svg>`;
}

// ── recovery codes: 10 × "xxxxx-xxxxx", stored as SHA-256, each usable once
const RC_ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const normCode = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function newRecoveryCodes(userId, n = 10) {
  const codes = Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10);
    const s = [...b].map((x) => RC_ALPHA[x % RC_ALPHA.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  tx(() => {
    run('DELETE FROM recovery_codes WHERE user_id=?', userId);
    for (const c of codes) run('INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)', userId, sha(normCode(c)));
  });
  return codes;
}
export function useRecoveryCode(userId, code) {
  const c = normCode(code);
  if (c.length !== 10) return false;
  const row = one('SELECT id FROM recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL', userId, sha(c));
  if (!row) return false;
  return run("UPDATE recovery_codes SET used_at=datetime('now') WHERE id=? AND used_at IS NULL", row.id).changes === 1;
}
export const recoveryLeft = (userId) => one('SELECT COUNT(*) n FROM recovery_codes WHERE user_id=? AND used_at IS NULL', userId).n;

// Checks a 6-digit app code or a recovery code for a user with 2FA on; records the used step.
export function checkSecondFactor(user, input) {
  const s = verifyTotp(user.totp_secret, input, user.totp_step);
  if (s) { run('UPDATE users SET totp_step=? WHERE id=?', s, user.id); return 'totp'; }
  if (useRecoveryCode(user.id, input)) return 'recovery';
  return null;
}

export function disableTotp(userId) {
  run('UPDATE users SET totp_on=0, totp_secret=NULL, totp_step=0 WHERE id=?', userId);
  run('DELETE FROM recovery_codes WHERE user_id=?', userId);
}
