// 설정 스키마 — lanekit.config.json 이 가질 수 있는 키와 기본값을 선언한다.
// 부르는 곳: config.mjs 의 validateConfig. 검사는 이 선언대로 채워진 설정에서 자기 칸만 읽는다.
// 먼저 읽을 파일: config.mjs(이 선언을 해석하는 쪽).

export const MODES = ['off', 'warn', 'ratchet', 'fail']
export const MODULE_NAMES = ['ts', 'ts-fastify']
export const SOURCE_KINDS = ['count-files', 'count-matches', 'json-length', 'json-value', 'command']

// 선언 도우미. 종류마다 config.mjs 에 해석 함수가 하나씩 있다.
export const text = (fallback = '') => ({ kind: 'text', fallback })
export const count = (fallback = 0) => ({ kind: 'count', fallback })
export const flag = (fallback = false) => ({ kind: 'flag', fallback })
export const choice = (options, fallback) => ({ kind: 'choice', options, fallback })
export const list = (item, fallback = []) => ({ kind: 'list', item, fallback })
export const dict = (item, fallback = {}) => ({ kind: 'dict', item, fallback })
export const record = (keys, required = []) => ({ kind: 'record', keys, required })

const mode = (fallback) => choice(MODES, fallback)
const warnFail = (warn, fail) => record({ warn: count(warn), fail: count(fail) })

const structure = record({
  mode: mode('warn'),
  source: record({
    include: list(text(), ['src/**', 'apps/*/src/**', 'packages/*/src/**']),
    exclude: list(text(), ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/dist/**', '**/generated/**']),
    extensions: list(text(), ['ts', 'tsx', 'mts', 'js', 'mjs', 'vue']),
  }),
  typescriptFrom: text(),
  limits: record({
    fileLines: count(500),
    fn: warnFail(60, 100),
    component: warnFail(150, 300),
    componentHooks: count(20),
    complexity: count(15),
    depth: count(4),
  }),
  slack: record({ fileLines: count(20), fnLines: count(10) }),
  console: record({ exempt: list(text(), ['**/cli/**', 'scripts/**']) }),
  readable: record({
    enabled: flag(true),
    maxParams: count(7),
    maxProps: count(12),
    bannedNames: list(text(), ['tmp', 'temp', 'cfg', 'obj', 'val']),
    historyPatterns: list(text()),
    historyExempt: list(text(), ['@since', '@deprecated']),
  }),
  routes: record({
    files: list(text(), ['apps/*/src/routes/**/*.ts', 'src/routes/**/*.ts']),
    routesPerFile: count(15),
    route: warnFail(80, 150),
    owners: list(text(), ['app', 'fastify', 'server', 'instance', 'router']),
    dbOwners: list(text(), ['db', 'tx', 'trx']),
    dbMethods: list(text(), ['get', 'all', 'run', 'exec', 'prepare', 'withTransaction']),
    appDbPattern: text('app\\.db\\.'),
    serverTop: text(),
  }),
})

const driftFact = record(
  {
    id: text(),
    doc: text(),
    pattern: text(),
    source: record(
      { kind: choice(SOURCE_KINDS), glob: text(), pattern: text(), file: text(), path: text(), command: text() },
      ['kind'],
    ),
  },
  ['id', 'doc', 'pattern', 'source'],
)

const checks = record({
  structure,
  'docs-drift': record({ mode: mode('warn'), facts: list(driftFact) }),
  writing: record({
    mode: mode('warn'),
    globs: list(text(), ['docs/**/*.md', 'README*.md']),
    extraBanned: list(record({ rule: text(), pattern: text() }, ['rule', 'pattern'])),
    allow: list(text()),
  }),
  secrets: record({
    mode: mode('fail'),
    tool: choice(['auto', 'builtin', 'gitleaks'], 'auto'),
    allow: list(record({ file: text(), rule: text(), reason: text() }, ['file', 'reason'])),
  }),
  audit: record({
    mode: mode('fail'),
    failOn: choice(['low', 'moderate', 'high', 'critical'], 'high'),
    allow: list(record({ id: text(), reason: text(), expires: text() }, ['id', 'reason', 'expires'])),
  }),
  sbom: record({ mode: mode('warn'), command: text() }),
  provenance: record({ mode: mode('warn') }),
  exposure: record({
    mode: choice([...MODES, 'auto'], 'auto'),
    allow: list(record({ file: text(), rule: count(), reason: text() }, ['file', 'reason'])),
  }),
  wiki: record({ mode: mode('warn'), indexMeta: text('.wiki/index/bundle/manifest.json') }),
  guidance: record({
    mode: mode('warn'),
    files: list(text(), ['CLAUDE.md', 'AGENTS.md']),
    maxLines: dict(count(), { 'CLAUDE.md': 30 }),
    maxBytes: dict(count(), { 'AGENTS.md': 40000 }),
  }),
  tests: record({ mode: mode('fail'), full: text(), changed: text() }),
})

export const CONFIG_SCHEMA = record({
  version: choice([1], 1),
  lang: choice(['ko', 'en'], 'ko'),
  repo: record({ visibility: choice(['private', 'public'], 'private') }),
  modules: list(choice(MODULE_NAMES)),
  remote_gate: choice(['git-hook', 'github', 'gitlab', 'none'], 'git-hook'),
  build: record({ command: text() }),
  checks,
})

export const CHECK_IDS = Object.keys(checks.keys)
