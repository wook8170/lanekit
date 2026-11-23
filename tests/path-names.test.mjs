// 파일 이름 테스트 — 유니코드 정규화(NFC · NFD)가 다른 이름, 따옴표 · 탭 · 역슬래시가 든 이름, `++ ` 로 시작하는 줄을 검사가 놓치지 않는지 본다.
// 대상: kit/lib/git.mjs · kit/lib/history.mjs · kit/checks/security/gitleaks.mjs · kit/checks/structure/source.mjs.
// 먼저 읽을 파일: ../kit/lib/git.mjs(경로 목록을 NUL 구분으로 받는 곳).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { run } from '../kit/checks/security/secrets.mjs'
import { listProjectFiles, selectSources } from '../kit/checks/structure/source.mjs'
import { createGit } from '../kit/lib/git.mjs'
import { parseAddedLines, unquoteGitPath } from '../kit/lib/history.mjs'
import { callCheck, fakeTool, withBarePath } from './check-helpers.mjs'
import { commitAll, gate, git, makeProject, POSIX_ONLY, writeFiles } from './helpers.mjs'

// 비밀값의 모양은 조각을 이어 만든다. 이 파일 자체가 비밀값 검사에 걸리지 않게 하기 위해서다.
const TOKEN = ['gh', 'p_', 'a'.repeat(36)].join('')
const builtinProject = (files) => makeProject({ checks: { secrets: { tool: 'builtin' } } }, files)
const ODD_NAMES = ['say"hi.txt', 'tab\there.txt', 'back\\slash.txt']
const KOREAN_NAME = '비밀.txt'

// 가짜 gitleaks: 한글 이름을 풀어 쓴 꼴(NFD)로 보고한다. macOS 의 디스크 이름이 이 꼴이다.
const NFD_GITLEAKS = `
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const source = args[args.indexOf('--source') + 1]
const file = source + '/' + ${JSON.stringify(KOREAN_NAME)}.normalize('NFD')
const leaks = args.includes('--no-git') ? [{ RuleID: 'generic-api-key', File: file, StartLine: 1, Commit: '' }] : []
writeFileSync(args[args.indexOf('--report-path') + 1], JSON.stringify(leaks))
process.exit(1)
`

test('gitleaks 가 풀어 쓴 꼴(NFD)의 한글 이름으로 보고해도 추적 중인 파일로 알아본다', async () => {
  assert.notEqual(KOREAN_NAME.normalize('NFD'), KOREAN_NAME.normalize('NFC'))
  const dir = makeProject({}, { [KOREAN_NAME.normalize('NFC')]: 'x\n' })
  commitAll(dir)
  const result = await withBarePath([fakeTool('gitleaks', NFD_GITLEAKS)], () => callCheck(run, 'security', dir))
  assert.deepEqual(result.findings.map((found) => [found.file, found.line]), [[KOREAN_NAME.normalize('NFC'), 1]])
})

test('따옴표 · 탭 · 역슬래시가 든 이름의 파일도 읽어서 본다', { skip: POSIX_ONLY }, async () => {
  const dir = builtinProject(Object.fromEntries(ODD_NAMES.map((name) => [name, `${TOKEN}\n`])))
  commitAll(dir)
  assert.deepEqual(createGit(dir).trackedFiles().filter((file) => ODD_NAMES.includes(file)).sort(), [...ODD_NAMES].sort())
  const result = await withBarePath([], () => callCheck(run, 'security', dir))
  assert.deepEqual(result.findings.map((found) => found.file).sort(), [...ODD_NAMES].sort())
})

test('바뀐 파일 목록에도 따옴표가 든 이름이 그대로 나온다', { skip: POSIX_ONLY }, () => {
  const dir = builtinProject({ 'a.txt': 'a\n' })
  commitAll(dir)
  writeFiles(dir, { 'new"file.txt': 'x\n', 'a.txt': 'changed\n' })
  git(dir, 'commit', '-q', '-am', 'change')
  git(dir, 'branch', 'base', 'HEAD~1')
  assert.deepEqual(createGit(dir).changedFiles('base'), ['a.txt', 'new"file.txt'])
})

test('이력 검사: 지운 뒤에도 따옴표가 든 이름의 파일에 있던 비밀값을 찾는다', { skip: POSIX_ONLY }, async () => {
  const dir = builtinProject({ 'say"hi.txt': `${TOKEN}\n` })
  const leaked = commitAll(dir)
  git(dir, 'rm', '-q', 'say"hi.txt')
  git(dir, 'commit', '-q', '-m', 'remove')
  const full = await withBarePath([], () => callCheck(run, 'security', dir, { profile: 'full' }))
  assert.deepEqual(full.findings.map((found) => found.file), [`say"hi.txt@${leaked.slice(0, 8)}`])
})

test('이력 검사: `++ ` 로 시작하는 줄이 있어도 그 파일의 나머지 줄을 버리지 않는다', async () => {
  const dir = builtinProject({ 'notes.md': `++ changelog\n${TOKEN}\n++ b/fake.txt\n${TOKEN}\n` })
  const leaked = commitAll(dir)
  writeFiles(dir, { 'notes.md': 'clean\n' })
  git(dir, 'commit', '-q', '-am', 'remove')
  const full = await withBarePath([], () => callCheck(run, 'security', dir, { profile: 'full' }))
  assert.deepEqual(full.findings.map((found) => found.file), [`notes.md@${leaked.slice(0, 8)}`, `notes.md@${leaked.slice(0, 8)}`])
})

test('이력 읽기: 파일 머리줄은 diff --git 과 첫 @@ 사이에서만 받는다', () => {
  const log = [
    'lanekit-commit abc',
    'diff --git a/notes.md b/notes.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/notes.md',
    '@@ -0,0 +1,3 @@',
    '+++ changelog',
    '++++ /dev/null',
    '+secret',
    'diff --git a/gone.txt b/gone.txt',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-old',
  ].join('\n')
  assert.deepEqual(parseAddedLines(log), [
    { commit: 'abc', file: 'notes.md', text: '++ changelog' },
    { commit: 'abc', file: 'notes.md', text: '+++ /dev/null' },
    { commit: 'abc', file: 'notes.md', text: 'secret' },
  ])
})

test('이력 읽기: 따옴표로 감싼 머리줄과 공백 뒤의 탭을 푼다', () => {
  const blockOf = (header) => ['lanekit-commit abc', 'diff --git a/x b/x', '--- /dev/null', header, '@@ -0,0 +1 @@', '+new'].join('\n')
  const fileOf = (header) => parseAddedLines(blockOf(header))[0].file
  assert.equal(fileOf('+++ "b/say\\"hi.txt"'), 'say"hi.txt')
  assert.equal(fileOf('+++ "b/tab\\there.txt"'), 'tab\there.txt')
  assert.equal(fileOf('+++ b/with space.txt\t'), 'with space.txt')
  assert.equal(unquoteGitPath('"back\\\\slash \\355\\225\\234.txt"'), 'back\\slash 한.txt')
  assert.equal(unquoteGitPath('plain.txt'), 'plain.txt')
})

test('이름에 줄바꿈 같은 제어 문자가 있어도 출력의 줄이 갈라지지 않는다', { skip: POSIX_ONLY }, async () => {
  const forged = 'a\n  ✓ secrets     fail     통과\u001b[2K.txt'
  const dir = builtinProject({ [forged]: `${TOKEN}\n` })
  commitAll(dir)
  const { code, output } = await gate(dir, ['--only', 'secrets', '--no-evidence'])
  assert.equal(code, 1)
  assert.ok(!output.includes('\n  ✓ secrets'), '파일 이름으로 통과 줄을 흉내 낼 수 없다')
  assert.ok(!output.includes('\u001b'))
  assert.match(output, /a\\x0a {2}✓ secrets {5}fail {5}통과\\x1b\[2K\.txt:1 \[git-host-token\]/)
})

test('이력 검사: 저장소의 diff 접두 설정(noprefix · mnemonicPrefix)이 달라도 더해진 줄을 읽는다', async () => {
  for (const setting of ['diff.noprefix', 'diff.mnemonicPrefix']) {
    const dir = builtinProject({ 'notes.md': `${TOKEN}\n` })
    const leaked = commitAll(dir)
    git(dir, 'config', setting, 'true')
    writeFiles(dir, { 'notes.md': 'clean\n' })
    git(dir, 'commit', '-q', '-am', 'remove')
    const full = await withBarePath([], () => callCheck(run, 'security', dir, { profile: 'full' }))
    assert.deepEqual(full.findings.map((found) => found.file), [`notes.md@${leaked.slice(0, 8)}`], setting)
  }
})

test('structure 의 파일 목록은 따옴표 · 탭이 든 이름의 소스도 그대로 받는다', { skip: POSIX_ONLY }, () => {
  const dir = makeProject({}, { 'src/big"q.ts': 'export const a = 1\n', 'src/tab\there.ts': 'export const b = 1\n', 'src/untracked"new.ts': 'export const c = 1\n' })
  commitAll(dir)
  writeFiles(dir, { 'src/later"new.ts': 'export const d = 1\n' })
  const listed = listProjectFiles(dir, createGit(dir))
  const sources = selectSources(listed, { include: ['src/**'], exclude: [], extensions: ['ts'] })
  assert.deepEqual(sources, ['src/big"q.ts', 'src/later"new.ts', 'src/tab\there.ts', 'src/untracked"new.ts'])
})

// 경로 목록을 내는 git 명령은 listPaths 로만 부른다. 줄 단위로 받으면 따옴표가 든 이름이 바뀌어 와서 그 파일을 건너뛴다.
const PATH_LISTING = /'ls-files'|'--name-only'|'--name-status'|'diff-tree'|'diff-index'|'diff-files'/
const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => join(entry.parentPath, entry.name))

test('kit · lib · modules 에서 경로 목록을 내는 git 호출은 모두 listPaths 를 거친다', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const files = ['kit', 'lib', 'modules'].flatMap((folder) => sourceFiles(join(repoRoot, folder)))
  assert.ok(files.length > 50)
  const offenders = files.flatMap((file) =>
    readFileSync(file, 'utf8').split('\n').flatMap((line, index) => (PATH_LISTING.test(line) && !line.includes('listPaths(') ? [`${file}:${index + 1}`] : [])),
  )
  assert.deepEqual(offenders, [])
})
