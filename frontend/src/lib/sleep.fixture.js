// Samples shared by the sleep tests (sleep.test.js, sleep-parity.test.js).
// A night of an Apple Watch as the Shortcut sends it from a phone set to Portuguese.
export const WATCH_NIGHT = [
  ['2026-10-21T23:05:00-03:00', '2026-10-22T06:55:00-03:00', 'Na cama', 'Apple Watch de Fernando'],
  ['2026-10-21T23:20:00-03:00', '2026-10-22T00:50:00-03:00', 'Essencial', 'Apple Watch de Fernando'],
  ['2026-10-22T00:50:00-03:00', '2026-10-22T02:00:00-03:00', 'Profundo', 'Apple Watch de Fernando'],
  ['2026-10-22T02:00:00-03:00', '2026-10-22T02:10:00-03:00', 'Acordado', 'Apple Watch de Fernando'],
  ['2026-10-22T02:10:00-03:00', '2026-10-22T05:00:00-03:00', 'Essencial', 'Apple Watch de Fernando'],
  ['2026-10-22T05:00:00-03:00', '2026-10-22T06:40:00-03:00', 'REM', 'Apple Watch de Fernando']
].map(([start, end, value, source]) => ({ start, end, value, source }))
