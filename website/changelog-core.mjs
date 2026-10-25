// The changelog of openGym, from the pull requests merged on GitHub: one entry per deploy. A
// production deploy is a merge into `main` (Vercel builds every one); a pull request merged into
// another branch first (a stack: #35 into `water`, #36 into #35's branch…) shipped with the next
// merge into `main`, so it is listed under that deploy.
//
// Shared by changelog.html (in the browser, reading the GitHub API at view time) and
// scripts/changelog.mjs (writing changelog.json at build time, what the page shows when the API
// cannot be reached). No dependencies.

export const REPO = 'nandovisc/openGym'
const API = `https://api.github.com/repos/${REPO}/pulls?state=closed&per_page=100&sort=updated&direction=desc`

/** Every merged pull request, newest first: { n, title, at, url, base, head, body }. */
export async function fetchMerged(fetchImpl = fetch, { pages = 3 } = {}) {
  const out = []
  for (let page = 1; page <= pages; page++) {
    const r = await fetchImpl(`${API}&page=${page}`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error('GitHub ' + r.status)
    const xs = await r.json()
    for (const p of xs) if (p.merged_at) out.push({ n: p.number, title: p.title, at: p.merged_at, url: p.html_url, base: p.base?.ref, head: p.head?.ref, body: trimBody(p.body) })
    if (xs.length < 100) break
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}

/**
 * The deploys: each pull request merged into `main`, newest first, with `parts` — the pull requests
 * merged into other branches (a stack) since the deploy before it, which reached `main` with it.
 */
export function deploysOf(prs) {
  const list = Array.isArray(prs) ? prs : []
  const main = list.filter(p => p.base === 'main').sort((a, b) => (a.at < b.at ? -1 : 1))
  const rest = list.filter(p => p.base !== 'main').sort((a, b) => (a.at < b.at ? -1 : 1))
  return main.map((p, i) => ({ ...p, parts: rest.filter(x => x.at <= p.at && (i === 0 || x.at > main[i - 1].at)) }))
    .reverse()
}

/**
 * `prs` with the Portuguese title and notes of the ones written in English (changelog-pt.json,
 * keyed by number), so the page reads in one language. GitHub keeps the originals.
 */
export function inPortuguese(prs, pt) {
  return (Array.isArray(prs) ? prs : []).map(p => (pt && pt[p.n] ? { ...p, title: pt[p.n].title || p.title, body: pt[p.n].body ?? p.body } : p))
}

// What a pull request says, without what is only for the reviewer: the tests it ran, the line the
// tool that wrote it signs with.
export function trimBody(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n')
  const out = []
  let skip = false
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) || /^\*\*Testes?:?\*\*/i.test(line)) skip = /^(#{1,3}\s*|\*\*)(Testes?|Tests?)\b/i.test(line)
    if (skip || /Generated with \[Claude Code\]/.test(line)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/(^|[\s(])#(\d+)\b/g, `$1<a href="https://github.com/${REPO}/pull/$2" rel="noopener">#$2</a>`)
}

/** The Markdown of a pull request as HTML: headings, nested lists, paragraphs, bold, code, links. Escaped. */
export function mdToHtml(md) {
  const out = []
  const stack = []   // open list indents
  const close = to => { while (stack.length > to) { out.push('</li></ul>'); stack.pop() } }
  let para = []
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = [] } }
  for (const raw of String(md || '').split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const li = /^(\s*)[-*]\s+(.*)$/.exec(line)
    if (h) { flush(); close(0); out.push(`<h5>${inline(h[2])}</h5>`); continue }
    if (li) {
      flush()
      const depth = Math.floor(li[1].length / 2) + 1
      if (depth > stack.length) { while (stack.length < depth) { out.push('<ul><li>'); stack.push(depth) } }
      else { close(depth); out.push('</li><li>') }
      out.push(inline(li[2]))
      continue
    }
    if (!line.trim()) { flush(); continue }
    if (stack.length && /^\s+/.test(line)) { out.push(' ' + inline(line.trim())); continue }
    close(0)
    para.push(line.trim())
  }
  flush(); close(0)
  return out.join('')
}
