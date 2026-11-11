import type { Sql } from '../../app/Symbols/store'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprint } from '../../app/Errors/fingerprint'
import { generateUploadToken, hashUploadToken } from '../../app/Errors/uploadTokens'
import {
  decodeVlq,
  jsStackFiles,
  matchScript,
  originalPosition,
  parseJsFrame,
  parseSourceMap,
  scriptPath,
  symbolicateJsStack,
} from '../../app/Symbols/sourcemap'
import { detectDebugFileKind, forgetProject, sourceMapDebugId, sourceMapFileName, symbolicateJs } from '../../app/Symbols/store'
import { handleDebugFileUpload } from '../../app/Symbols/upload'

// ---------------------------------------------------------------------------
// A real minified build
// ---------------------------------------------------------------------------
//
// Two source files bundled and minified by Bun.build, the way a desktop app's
// webview and agent bundles are. The fault is in cart.ts, line 7: a negative
// price throws. The stack comes from actually running the minified bundle, so
// the lines and columns under test are the ones a runtime prints, not ones
// computed by the code they are checking.

const CART = `export interface Item { name: string, price: number }

export function totalFor(items: Item[]): number {
  let total = 0
  for (const item of items) {
    if (item.price < 0)
      throw new RangeError(\`negative price for \${item.name}\`)
    total += item.price
  }
  return total
}
`

const APP = `import { totalFor } from './cart'

class Checkout {
  constructor(private names: string[]) {}

  render(): string {
    const items = this.names.map((name, i) => ({ name, price: i === 2 ? -1 : 10 * (i + 1) }))
    return \`Total: \${totalFor(items)}\`
  }
}

function renderCheckout(names: string[]): string {
  const view = new Checkout(names)
  const html = view.render()
  return html.trim()
}

export async function boot(): Promise<string> {
  await Promise.resolve()
  const out = renderCheckout(['tea', 'cup', 'spoon'])
  return \`\${out}!\`
}
`

let dir = ''
let mapText = ''
let minified = ''
/** The stack Bun printed when the minified bundle threw. */
let bunStack = ''
/** Its frames inside the bundle: minified name, line, column. */
let frames: Array<{ fn: string, line: number, column: number }> = []

beforeAll(async () => {
  // realpath: macOS's temp dir is a symlink, and the bundler would otherwise
  // write each source as a climb out of it and back in.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'bughq-sourcemap-')))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/cart.ts'), CART)
  writeFileSync(join(dir, 'src/app.ts'), APP)
  const built = await Bun.build({
    entrypoints: [join(dir, 'src/app.ts')],
    outdir: join(dir, 'out'),
    sourcemap: 'external',
    minify: true,
    target: 'browser',
  })
  expect(built.success).toBe(true)
  minified = readFileSync(join(dir, 'out/app.js'), 'utf8')
  mapText = readFileSync(join(dir, 'out/app.js.map'), 'utf8')

  const bundle = await import(join(dir, 'out/app.js'))
  try {
    await bundle.boot()
  }
  catch (err) {
    bunStack = String((err as Error).stack)
  }
  frames = bunStack.split('\n').flatMap((line) => {
    const f = parseJsFrame(line)
    return f && f.file.endsWith('out/app.js') ? [{ fn: f.function, line: f.line, column: f.column }] : []
  })
})

afterAll(() => {
  if (dir)
    rmSync(dir, { recursive: true, force: true })
})

/** The same frames as another runtime, in another place, would print them. */
function stackAs(shape: 'v8' | 'webkit', file: string): string {
  const lines = frames.map(f => shape === 'v8'
    ? `    at ${f.fn} (${file}:${f.line}:${f.column})`
    : `${f.fn}@${file}:${f.line}:${f.column}`)
  return ['RangeError: negative price for spoon', ...lines].join('\n')
}

const READABLE = [
  '    at totalFor (src/cart.ts:7:',
  '    at render (src/app.ts:8:',
  '    at renderCheckout (src/app.ts:14:',
]

function expectReadable(stack: string): void {
  const lines = stack.split('\n')
  expect(lines[0]).toBe('RangeError: negative price for spoon')
  READABLE.forEach((want, i) => expect(lines[i + 1].startsWith(want)).toBe(true))
}

describe('base64 VLQ', () => {
  test('decodes single and multi-digit values, with sign', () => {
    expect(decodeVlq('AAAA')).toEqual([0, 0, 0, 0])
    expect(decodeVlq('C')).toEqual([1])
    expect(decodeVlq('D')).toEqual([-1])
    expect(decodeVlq('gB')).toEqual([16])
    expect(decodeVlq('hB')).toEqual([-16])
    expect(decodeVlq('gqjG')).toEqual([100000])
    expect(decodeVlq('IACEA')).toEqual([4, 0, 1, 2, 0])
  })

  test('survives values past 32 bits of shifting', () => {
    // 2^31 - 1, the largest value the format's own test suite uses.
    expect(decodeVlq('+/////D')).toEqual([2147483647])
  })

  test('refuses what is not VLQ', () => {
    expect(() => decodeVlq('A*')).toThrow()
    expect(() => decodeVlq('g')).toThrow() // a continuation bit with nothing after it
  })
})

describe('sourcemap lookup', () => {
  // Generated line 1: column 0 is a.ts 1:1; column 4 onwards is a.ts 2:3,
  // named `hello`. Generated line 2 is empty, line 3 maps to b.ts 1:1.
  const map = parseSourceMap({
    version: 3,
    sources: ['./src/a.ts', '../lib/b.ts'],
    names: ['hello'],
    mappings: 'AAAA,IACEA;;ACDF',
  })!

  test('reads sources, names and positions', () => {
    expect(map.sources).toEqual(['src/a.ts', 'lib/b.ts'])
    expect(originalPosition(map, 1, 1)).toEqual({ source: 'src/a.ts', line: 1, column: 1, name: undefined })
    expect(originalPosition(map, 1, 5)).toEqual({ source: 'src/a.ts', line: 2, column: 3, name: 'hello' })
  })

  test('a column between two segments belongs to the one before it', () => {
    expect(originalPosition(map, 1, 4)?.line).toBe(1)
    expect(originalPosition(map, 1, 400)?.line).toBe(2)
  })

  test('deltas carry across lines; the generated column does not', () => {
    expect(originalPosition(map, 3, 1)).toEqual({ source: 'lib/b.ts', line: 1, column: 1, name: undefined })
  })

  test('misses on an empty line and past the end', () => {
    expect(originalPosition(map, 2, 1)).toBeNull()
    expect(originalPosition(map, 99, 1)).toBeNull()
  })

  test('applies sourceRoot', () => {
    const rooted = parseSourceMap({ version: 3, sourceRoot: 'webpack://app/', sources: ['src/a.ts'], names: [], mappings: 'AAAA' })!
    expect(rooted.sources).toEqual(['webpack://app/src/a.ts'])
  })

  test('flattens an index map, shifting each section into place', () => {
    const index = parseSourceMap({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], names: ['one'], mappings: 'AAAAA' } },
        { offset: { line: 0, column: 100 }, map: { version: 3, sources: ['b.ts'], names: ['two'], mappings: 'AAAAA;AACA' } },
      ],
    })!
    expect(originalPosition(index, 1, 1)).toEqual({ source: 'a.ts', line: 1, column: 1, name: 'one' })
    expect(originalPosition(index, 1, 101)).toEqual({ source: 'b.ts', line: 1, column: 1, name: 'two' })
    // The section's second line starts at column 0, not at its column offset.
    expect(originalPosition(index, 2, 1)).toEqual({ source: 'b.ts', line: 2, column: 1, name: undefined })
  })

  test('refuses what is not a sourcemap', () => {
    expect(parseSourceMap('not json')).toBeNull()
    expect(parseSourceMap('{"version":2,"sources":[],"mappings":"AAAA"}')).toBeNull()
    expect(parseSourceMap('{"version":3,"sources":["a.ts"],"mappings":""}')).toBeNull()
    expect(parseSourceMap('{"hello":"world"}')).toBeNull()
  })
})

describe('stack frames', () => {
  test('reads the V8 shape Bun, Node and WebView2 print', () => {
    expect(parseJsFrame('    at render (https://fettler.localhost/assets/app.js:1:234)')).toEqual({ function: 'render', file: 'https://fettler.localhost/assets/app.js', line: 1, column: 234 })
    expect(parseJsFrame('    at async boot (/Users/me/app/dist/agent.js:2:10)')?.function).toBe('async boot')
    expect(parseJsFrame('    at https://fettler.localhost/app.js:1:234')).toEqual({ function: '', file: 'https://fettler.localhost/app.js', line: 1, column: 234 })
    expect(parseJsFrame('    at n (B:\\~BUN\\root\\agent.js:1:58)')?.file).toBe('B:\\~BUN\\root\\agent.js')
  })

  test('reads the WebKit shape WKWebView and WebKitGTK print', () => {
    expect(parseJsFrame('render@https://fettler.localhost/app.js:1:234')).toEqual({ function: 'render', file: 'https://fettler.localhost/app.js', line: 1, column: 234 })
    expect(parseJsFrame('@https://fettler.localhost/app.js:1:234')?.function).toBe('')
    expect(parseJsFrame('https://fettler.localhost/app.js:1:234')?.line).toBe(1)
  })

  test('leaves headers and native frames alone', () => {
    expect(parseJsFrame('RangeError: negative price for spoon')).toBeNull()
    expect(parseJsFrame('    at Array.map (<anonymous>)')).toBeNull()
    expect(parseJsFrame('    at processTicksAndRejections (native)')).toBeNull()
    expect(parseJsFrame('map@[native code]')).toBeNull()
  })

  test('matches an upload name to wherever the runtime loaded the script from', () => {
    expect(scriptPath('https://fettler.localhost/assets/app.js?v=3#x')).toBe('assets/app.js')
    expect(scriptPath('B:\\~BUN\\root\\agent.js')).toBe('~BUN/root/agent.js')
    const names = ['app.js', 'assets/app.js', 'agent.js']
    expect(matchScript(names, 'https://fettler.localhost/assets/app.js')).toBe('assets/app.js')
    expect(matchScript(names, 'https://fettler.localhost/other/app.js')).toBe('app.js')
    expect(matchScript(names, '/Applications/Fettler.app/Contents/Resources/agent.js')).toBe('agent.js')
    expect(matchScript(names, 'B:\\~BUN\\root\\agent.js')).toBe('agent.js')
    // A tail match stops at a path boundary: myapp.js is not app.js.
    expect(matchScript(names, 'https://fettler.localhost/myapp.js')).toBeNull()
  })
})

describe('symbolicating a real minified stack', () => {
  test('the build really is minified and the map carries no names', () => {
    // The premise of the name recovery below: Bun writes an empty `names`.
    expect(minified).not.toContain('renderCheckout')
    expect(minified).not.toContain('totalFor')
    expect(JSON.parse(mapText).names).toEqual([])
    expect(frames.length).toBeGreaterThanOrEqual(3)
    expect(frames[0].fn).not.toBe('totalFor')
  })

  test('a Bun stack resolves to the original functions, files and lines', () => {
    const map = parseSourceMap(mapText)!
    const result = symbolicateJsStack(bunStack, file => file.endsWith('out/app.js') ? map : null)
    expectReadable(result.stack)
    expect(result.symbolicated).toBe(frames.length)
  })

  test('a webview stack in the V8 shape resolves the same way', () => {
    const map = parseSourceMap(mapText)!
    const stack = stackAs('v8', 'https://fettler.localhost/assets/app.js')
    expect(jsStackFiles(stack)).toEqual(['https://fettler.localhost/assets/app.js'])
    expectReadable(symbolicateJsStack(stack, () => map).stack)
  })

  test('a WebKit stack is rewritten into the same V8 shape', () => {
    const map = parseSourceMap(mapText)!
    expectReadable(symbolicateJsStack(stackAs('webkit', 'https://fettler.localhost/assets/app.js'), () => map).stack)
  })

  test('a frame entered from native code does not take its name from the frame below', () => {
    const map = parseSourceMap(mapText)!
    const [top, second] = frames
    const stack = [
      'RangeError: negative price for spoon',
      `    at ${top.fn} (app.js:${top.line}:${top.column})`,
      '    at Array.map (<anonymous>)',
      `    at ${second.fn} (app.js:${second.line}:${second.column})`,
    ].join('\n')
    const lines = symbolicateJsStack(stack, () => map).stack.split('\n')
    // The position is still right; the name is the one the runtime printed.
    expect(lines[1]).toStartWith(`    at ${top.fn} (src/cart.ts:7:`)
    expect(lines[2]).toBe('    at Array.map (<anonymous>)')
  })

  test('scripts without a map are left as they came and named as missing', () => {
    const stack = 'Error: x\n    at a (https://fettler.localhost/vendor.js:1:10)\n    at b (/Users/me/dev/agent.ts:4:2)\n    at c (node:internal/timers:1:1)'
    const result = symbolicateJsStack(stack, () => null)
    expect(result.stack).toBe(stack)
    expect(result.symbolicated).toBe(0)
    // Only built JavaScript can be missing a map: not source run directly, not the runtime.
    expect(result.missing).toEqual(['vendor.js'])
  })

  test('two builds of one bug group together once symbolicated', () => {
    const map = parseSourceMap(mapText)!
    const first = symbolicateJsStack(stackAs('v8', 'https://fettler.localhost/app.js'), () => map).stack
    // A rebuild renames every minified function and moves every column.
    const rebuilt = stackAs('v8', 'https://fettler.localhost/app.js').replace(/at \S+ \(/g, 'at zz (')
    const second = symbolicateJsStack(rebuilt, () => map).stack
    expect(fingerprint('RangeError', 'negative price for spoon', second)).toBe(fingerprint('RangeError', 'negative price for spoon', first))
    expect(fingerprint('RangeError', 'negative price for spoon', rebuilt)).not.toBe(fingerprint('RangeError', 'negative price for spoon', stackAs('v8', 'https://fettler.localhost/app.js')))
  })
})

// ---------------------------------------------------------------------------
// Upload through the upload token, then ingest-side symbolication
// ---------------------------------------------------------------------------

/** The four statements the upload and lookup paths run, against arrays. */
function memoryDatabase() {
  const tokens: Array<{ id: string, project_id: string, token_hash: string, revoked: boolean, last_used: boolean }> = []
  const files: Array<Record<string, any>> = []
  const sql: Sql = async (query, params = []) => {
    if (query.includes('FROM upload_tokens t JOIN projects'))
      return tokens.filter(t => t.token_hash === params[0] && !t.revoked).map(t => ({ id: t.id, project_id: t.project_id }))
    if (query.startsWith('UPDATE upload_tokens')) {
      tokens.filter(t => t.id === params[0]).forEach(t => t.last_used = true)
      return []
    }
    if (query.includes(`VALUES ($1, $2, 'sourcemap'`)) {
      const [id, project_id, debug_id, code_name, release, symbol_count, size_bytes, content, uploaded_by] = params as any[]
      const row = { id, project_id, kind: 'sourcemap', debug_id, code_name, release, symbol_count, size_bytes, content, uploaded_by }
      const at = files.findIndex(f => f.project_id === project_id && f.kind === 'sourcemap' && f.debug_id === debug_id)
      if (at >= 0)
        files[at] = row
      else
        files.push(row)
      return []
    }
    if (query.includes('SELECT debug_id, code_name FROM debug_files'))
      return files.filter(f => f.project_id === params[0] && f.kind === 'sourcemap' && f.release === params[1])
    if (query.includes(`SELECT content FROM debug_files WHERE project_id = $1 AND kind = 'sourcemap'`))
      return files.filter(f => f.project_id === params[0] && f.debug_id === params[1])
    throw new Error(`unexpected query: ${query}`)
  }
  return { sql, tokens, files }
}

const allow = async () => ({ ok: true, retryAfter: 0 })

function upload(query: string, body: string | Uint8Array, token: string | null): Request {
  return new Request(`https://bughq.org/api/debug-files${query}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  })
}

describe('sourcemap upload', () => {
  const PROJECT = 'proj_fettler'
  const RELEASE = '1.0.0+41'
  const query = `?kind=sourcemap&release=${encodeURIComponent(RELEASE)}&file=assets/app.js`

  function setup() {
    const store = memoryDatabase()
    const token = generateUploadToken()
    store.tokens.push({ id: 'upt_1', project_id: PROJECT, token_hash: hashUploadToken(token), revoked: false, last_used: false })
    forgetProject(PROJECT)
    return { ...store, token, deps: { sql: store.sql, rateLimit: allow } }
  }

  test('the upload token stores a gzipped map under its release and script', async () => {
    const { deps, token, files, tokens } = setup()
    const res = await handleDebugFileUpload(upload(query, Bun.gzipSync(Buffer.from(mapText)), token), deps)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.files[0]).toMatchObject({ kind: 'sourcemap', release: RELEASE, code_name: 'assets/app.js', symbol_count: 2 })
    expect(body.files[0].debug_id).toBe(sourceMapDebugId(RELEASE, 'assets/app.js'))
    expect(files).toHaveLength(1)
    expect(files[0].project_id).toBe(PROJECT)
    expect(files[0].uploaded_by).toBe('upt_1')
    expect(tokens[0].last_used).toBe(true)
    // Nothing in the response carries the map or the token back.
    expect(JSON.stringify(body)).not.toContain(token)
    expect(body.files[0].content).toBeUndefined()
  })

  test('a plain body works and the kind is recognised without ?kind', async () => {
    const { deps, token, files } = setup()
    expect(detectDebugFileKind(mapText)).toBe('sourcemap')
    const res = await handleDebugFileUpload(upload(`?release=${encodeURIComponent(RELEASE)}&file=app.js.map`, mapText, token), deps)
    expect(res.status).toBe(201)
    // `app.js.map` is filed under the script it maps.
    expect(files[0].code_name).toBe('app.js')
  })

  test('a second upload for the same release and script replaces the first', async () => {
    const { deps, token, files } = setup()
    await handleDebugFileUpload(upload(query, mapText, token), deps)
    await handleDebugFileUpload(upload(query, mapText, token), deps)
    expect(files).toHaveLength(1)
  })

  test('refuses the ingest key, a revoked token and a missing token', async () => {
    const { deps, token, tokens, files } = setup()
    expect((await handleDebugFileUpload(upload(query, mapText, null), deps)).status).toBe(401)
    expect((await handleDebugFileUpload(upload(query, mapText, 'bughq_5f3a19b7c4d2e8091ab12cd34ef56ab7'), deps)).status).toBe(401)
    expect((await handleDebugFileUpload(upload(query, mapText, generateUploadToken()), deps)).status).toBe(401)
    tokens[0].revoked = true
    expect((await handleDebugFileUpload(upload(query, mapText, token), deps)).status).toBe(401)
    expect(files).toHaveLength(0)
  })

  test('refuses an upload with no release, no script name, or no sourcemap', async () => {
    const { deps, token, files } = setup()
    expect((await handleDebugFileUpload(upload('?kind=sourcemap&file=app.js', mapText, token), deps)).status).toBe(422)
    expect((await handleDebugFileUpload(upload(`?kind=sourcemap&release=${encodeURIComponent(RELEASE)}`, mapText, token), deps)).status).toBe(422)
    expect((await handleDebugFileUpload(upload(query, '{"version":3,"sources":[],"mappings":""}', token), deps)).status).toBe(422)
    expect((await handleDebugFileUpload(upload('?kind=pdb', mapText, token), deps)).status).toBe(400)
    expect(files).toHaveLength(0)
  })

  test('is rate limited per token before the database is asked anything', async () => {
    const { token } = setup()
    const sql: Sql = async () => {
      throw new Error('the database must not be reached')
    }
    const res = await handleDebugFileUpload(upload(query, mapText, token), { sql, rateLimit: async () => ({ ok: false, retryAfter: 30 }) })
    expect(res.status).toBe(429)
  })

  test('an uploaded map symbolicates the stacks of its release, and only that release', async () => {
    const { deps, token, sql } = setup()
    await handleDebugFileUpload(upload(query, Bun.gzipSync(Buffer.from(mapText)), token), deps)
    forgetProject(PROJECT)

    const webview = stackAs('webkit', 'https://fettler.localhost/assets/app.js')
    const hit = await symbolicateJs(PROJECT, RELEASE, webview, { expectMaps: true }, sql)
    expectReadable(hit.stack)
    expect(hit.symbolicated).toBe(frames.length)
    expect(hit.missing).toEqual([])

    // The agent bundle of the same release has no map yet: named as missing.
    const agent = await symbolicateJs(PROJECT, RELEASE, 'Error: x\n    at n (/Applications/Fettler.app/Contents/Resources/agent.js:1:58)', { expectMaps: true }, sql)
    expect(agent.symbolicated).toBe(0)
    expect(agent.missing).toEqual([`sourcemap for agent.js (${RELEASE})`])

    // Another release, and another project, never borrow this map.
    const other = await symbolicateJs(PROJECT, '1.0.0+42', webview, {}, sql)
    expect(other.stack).toBe(webview)
    expect(other.missing).toEqual([])
    forgetProject('proj_other')
    expect((await symbolicateJs('proj_other', RELEASE, webview, {}, sql)).stack).toBe(webview)
  })

  test('a failing database leaves the stack as it came', async () => {
    forgetProject('proj_down')
    const sql: Sql = async () => {
      throw new Error('connection refused')
    }
    const stack = stackAs('v8', 'https://fettler.localhost/app.js')
    expect(await symbolicateJs('proj_down', RELEASE, stack, { expectMaps: true }, sql)).toEqual({ stack, symbolicated: 0, missing: [] })
  })

  test('names a script the way a frame does', () => {
    expect(sourceMapFileName('./dist/app.js.map')).toBe('dist/app.js')
    expect(sourceMapFileName('/assets/app.js?v=3')).toBe('assets/app.js')
    expect(sourceMapFileName('out\\agent.js')).toBe('out/agent.js')
  })
})
