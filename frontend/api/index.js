// The openGym API as one Vercel function (docs/VERCEL.md). Every /api/* request is rewritten here
// by vercel.json and answered by api/server.js, which runs with STORE=supabase on Vercel: the
// data lives in a Supabase database, not on a disk this function does not keep.
export { handler as default } from '../../api/server.js'
