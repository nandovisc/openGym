// Writes website/changelog.json: every merged pull request of the repository, what changelog.html
// shows when the GitHub API cannot be reached from the browser (rate limit, offline). Run by the
// Vercel build of this folder on every deploy, and by hand:
//
//   node website/scripts/changelog.mjs
//
// A failed fetch keeps the file there is and exits 0, so a build never fails over the changelog.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchMerged } from '../changelog-core.mjs'

const OUT = fileURLToPath(new URL('../changelog.json', import.meta.url))
try {
  const prs = await fetchMerged()
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), prs }, null, 1) + '\n')
  console.log(`changelog.json: ${prs.length} pull requests`)
} catch (e) {
  console.warn('changelog.json kept as it is:', e.message)
}
