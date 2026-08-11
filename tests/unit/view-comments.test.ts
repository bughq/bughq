import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Comments that leak onto the page.
 *
 * Three separate production defects in one day came from this, two of them in
 * comments written to warn about it:
 *
 *   - `<!-- … <main> … -->` in issue/[id].stx and account.stx. The server
 *     extracts an SPA fragment by counting main tags as plain strings and does
 *     not skip comments, so the count went unbalanced, the extractor gave up and
 *     returned the whole document, and the router injected that document's head
 *     into the live page — a main inside a main, 23 head metas, 12 re-executed
 *     scripts per navigation.
 *   - `<!-- … <head> … -->` in dashboard.stx. The fragment swap re-scans the
 *     incoming markup and the literal tag closed the comment early, so ten lines
 *     of developer commentary painted as body text above the header on every SPA
 *     arrival — including the redirect straight after signing in.
 *   - the replacement for that one spelled the stx closing delimiter inside its
 *     own prose, which ended the comment there and spilled the rest onto the
 *     page. Same bug, one layer up.
 *
 * None of it is visible in a screenshot review, a status code, or a console
 * error. It is only visible if you read the rendered text, which is why this is
 * a test and not a habit.
 *
 * The rule: describe tags and delimiters in prose, never type them inside a
 * comment. Write "the head element", not the tag.
 */

const VIEWS = join(import.meta.dir, '../../resources')

function stxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory())
      out.push(...stxFiles(full))
    else if (entry.endsWith('.stx'))
      out.push(full)
  }
  return out
}

/** HTML comments, which survive into the response and are re-scanned on a swap. */
function htmlComments(src: string): string[] {
  return src.match(/<!--[\s\S]*?-->/g) ?? []
}

/** stx comments, kept for the terminator-balance check below. */
function stxComments(src: string): string[] {
  return src.match(/\{\{--[\s\S]*?--\}\}/g) ?? []
}

// Tags the fragment extractor and the swap both scan for as plain strings.
const STRUCTURAL_TAG = /<\/?\s*(html|head|body|main|script)\b/i

const files = stxFiles(VIEWS)

describe('view comments cannot leak into the page', () => {
  test('finds the .stx files it is meant to be guarding', () => {
    // A refactor that moves resources/ must not turn this suite into a no-op
    // that passes by checking nothing.
    expect(files.length).toBeGreaterThan(20)
  })

  test.each(files.map(f => [f.replace(`${VIEWS}/`, ''), f]))(
    '%s: no structural tag written literally inside an HTML comment',
    (_name, file) => {
      const offenders = htmlComments(readFileSync(file, 'utf8'))
        .filter(c => STRUCTURAL_TAG.test(c))
        .map(c => c.slice(0, 120))
      expect(offenders).toEqual([])
    },
  )

  // Deliberately NOT asserted: a structural tag inside an *stx* comment. That
  // rule was written first and had to go — it fails on layouts/default.stx,
  // whose SPA rules comment names the tags it is describing, and that comment
  // is correct and worth keeping. Checked before deleting the rule rather than
  // after: the layout comment appears zero times in /dashboard, /login and
  // /settings, and zero times in a fragment response, so stx strips it on every
  // path including the swap. Banning it would have meant rewriting accurate
  // documentation to satisfy a test that was guarding nothing.

  test.each(files.map(f => [f.replace(`${VIEWS}/`, ''), f]))(
    '%s: no stx comment terminator inside an stx comment',
    (_name, file) => {
      // The terminator is matched non-greedily, so the FIRST one ends the
      // comment. Spelling it in the prose ends the block early and prints
      // everything after it. Detected by counting terminators between the
      // opener and where the comment is deemed to end: the capture already
      // stops at the first, so anything after it in the source up to the real
      // intended end is loose text — which shows up as an odd number of
      // openers and terminators overall.
      const src = readFileSync(file, 'utf8')
      const opens = (src.match(/\{\{--/g) ?? []).length
      const closes = (src.match(/--\}\}/g) ?? []).length
      expect({ file: file.replace(`${VIEWS}/`, ''), opens, closes })
        .toEqual({ file: file.replace(`${VIEWS}/`, ''), opens, closes: opens })
    },
  )
})
