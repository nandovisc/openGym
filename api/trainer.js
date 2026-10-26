// A personal trainer and their students (the Personal module). An admin marks an account as a
// trainer (user.trainer); the trainer hands a student a code (user.trainerCode); the student, who
// sees what they share, enters it and the link is made — the student agrees, never the trainer
// alone. Either side can end it, and the access goes with it at once.
//
//   db.trainerLinks [{ id, trainerId, clientId, scope: { body }, created }]
//     scope.body: weigh-ins and measurements shared too (off unless the student turns it on).
//     What a link always shares is the training: routines, workouts (without their photos and
//     videos), custom exercises, the unit. Nothing of the health modules, ever.
//   user.trainerCode { code, exp }   one code at a time, a week long, for any number of students
import crypto from 'node:crypto';

const list = v => (Array.isArray(v) ? v : []);
export const CODE_DAYS = 7;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: read aloud or typed off a screen

/** A new code: 'PT-' and 8 characters a person can read to someone else. */
export function newCode() {
  const b = crypto.randomBytes(8);
  return 'PT-' + [...b].map(x => ALPHABET[x % ALPHABET.length]).join('');
}
export const cleanCode = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PT/, '');
const sameCode = (a, b) => !!a && !!b && cleanCode(a) === cleanCode(b);

/** The trainer whose live code `code` is, or null. */
export function trainerByCode(users, code, now = Date.now()) {
  return list(users).find(u => u?.trainer && !u.disabled && u.trainerCode && Number(u.trainerCode.exp) > now && sameCode(u.trainerCode.code, code)) || null;
}

/**
 * `links` with the link of `trainer` and `client` made (or its scope changed, when there is one):
 * { links, link, error }. error: 'self' (a trainer is not their own student).
 */
export function linkWith(links, trainer, client, { body = false, now = Date.now() } = {}) {
  if (trainer.id === client.id) return { links: list(links), link: null, error: 'self' };
  const out = list(links).slice();
  const i = out.findIndex(l => l?.trainerId === trainer.id && l.clientId === client.id);
  const link = i >= 0 ? { ...out[i], scope: { body: !!body } } : { id: crypto.randomBytes(8).toString('hex'), trainerId: trainer.id, clientId: client.id, scope: { body: !!body }, created: now };
  if (i >= 0) out[i] = link; else out.push(link);
  return { links: out, link, error: null };
}

/** `links` without the link `id` when `user` is one of its two sides: { links, link } (null: none). */
export function unlink(links, id, user) {
  const link = list(links).find(l => l?.id === id && (l.trainerId === user.id || l.clientId === user.id)) || null;
  return { links: link ? list(links).filter(l => l !== link) : list(links), link };
}

/** `links` without any link of user `uid` (an account deleted, or no longer a trainer). */
export const dropLinksOf = (links, uid, side = 'both') =>
  list(links).filter(l => !((side !== 'client' && l?.trainerId === uid) || (side !== 'trainer' && l?.clientId === uid)));

/** The students of `trainer`, as the trainer sees them. */
export function studentsOf(links, users, trainer) {
  const by = new Map(list(users).map(u => [u.id, u]));
  return list(links).filter(l => l?.trainerId === trainer.id && by.has(l.clientId))
    .map(l => ({ id: l.id, student: { id: l.clientId, name: by.get(l.clientId).name, disabled: !!by.get(l.clientId).disabled }, scope: l.scope || { body: false }, created: l.created }));
}

/** The trainers of `client`, as the student sees them. */
export function trainersOf(links, users, client) {
  const by = new Map(list(users).map(u => [u.id, u]));
  return list(links).filter(l => l?.clientId === client.id && by.has(l.trainerId))
    .map(l => ({ id: l.id, trainer: { id: l.trainerId, name: by.get(l.trainerId).name }, scope: l.scope || { body: false }, created: l.created }));
}
