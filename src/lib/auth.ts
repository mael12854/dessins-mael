// Code d'accès de l'admin (variable ADMIN_PASSWORD), comparé en temps constant.
import { createHash, timingSafeEqual } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s).digest();
export function codeOk(given: string | null) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !given) return false;
  return timingSafeEqual(sha(given), sha(expected));
}
