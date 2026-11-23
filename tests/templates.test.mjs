// 틀 · 메시지 · 문서 테스트 — ko 와 en 두 벌의 구성이 같은지, 틀에 자리표시와 지침 규칙 위반이 남지 않는지 본다.
// 대상: templates/{ko,en}/ · lib/messages.{ko,en}.json · docs/{ko,en}/ · skills/ · kit/git-hooks/pre-push.
// 먼저 읽을 파일: ../lib/template-map.mjs.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { findDuplicateHeadings, findMachineBoundPaths, findOversize, findSelfViolations } from '../kit/checks/guidance/rules.mjs'
import { RULES_KO } from '../kit/checks/writing/rules-ko.mjs'
import { validateConfig } from '../kit/lib/config.mjs'
import { headings } from '../kit/lib/markdown.mjs'
import { hasModeBits } from '../kit/lib/platform.mjs'
import { lanekeeperValues } from '../lib/lanekeeper-link.mjs'
import { listFiles } from '../lib/lock.mjs'
import { listPlaceholders, renderTemplate } from '../lib/render.mjs'
import { OFFERED_TEMPLATES, TEMPLATE_TARGETS, templateValues } from '../lib/template-map.mjs'
import { REPO_ROOT } from './scaffold-helpers.mjs'

const LANGS = ['ko', 'en']
const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8')
const readJson = (...parts) => JSON.parse(read(...parts))
const VALUES = templateValues({ projectName: 'acme-app', packageManager: 'pnpm' })
const render = (lang, source) => renderTemplate(read('templates', lang, source), VALUES)
// 제목의 깊이만 견준다. 본문의 언어는 달라도 절의 구성은 같아야 한다. 코드 블록 안의 # 줄은 제목이 아니다.
function headingShape(source) {
  let isFenced = false
  const depths = []
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('```')) isFenced = !isFenced
    const marks = isFenced ? null : line.match(/^(#{1,6})\s/)
    if (marks) depths.push(marks[1].length)
  }
  return depths
}
const asDoc = (file, text) => ({ file, text, bytes: Buffer.byteLength(text) })

test('ko 와 en 의 틀은 파일 구성이 같다', () => {
  assert.deepEqual(listFiles(join(REPO_ROOT, 'templates/ko')), listFiles(join(REPO_ROOT, 'templates/en')))
})

test('짝 표에 적힌 틀이 두 언어에 모두 있고, 표에 없는 틀 파일은 없다', () => {
  const mapped = [...new Set([...TEMPLATE_TARGETS, ...OFFERED_TEMPLATES].map((entry) => entry.source))].sort()
  for (const lang of LANGS) assert.deepEqual(listFiles(join(REPO_ROOT, 'templates', lang)), mapped, lang)
})

test('ko 와 en 의 틀은 절 구성(제목의 수와 깊이)이 같다', () => {
  const markdown = listFiles(join(REPO_ROOT, 'templates/ko')).filter((path) => path.endsWith('.md'))
  assert.ok(markdown.length >= 10)
  for (const path of markdown) {
    assert.deepEqual(headingShape(read('templates/en', path)), headingShape(read('templates/ko', path)), path)
    const lineCounts = LANGS.map((lang) => read('templates', lang, path).split('\n').length)
    assert.equal(lineCounts[0], lineCounts[1], `${path} 의 줄 수`)
  }
})

test('AGENTS.md 틀에는 정해진 절 아홉 개가 있다', () => {
  const titlesOf = (lang) => headings(read('templates', lang, 'AGENTS.md')).slice(1).map((heading) => heading.title)
  assert.deepEqual(titlesOf('ko'), ['시작 문서', '저장소 모양', '코드 작성 기준', '탐색 순서', '완료 기준', '테스트 동기화', '문서 크로스체크', '게이트', 'Git'])
  assert.equal(titlesOf('en').length, 9)
  assert.ok(titlesOf('en').includes('Code standards'))
})

test('레인키퍼에 넣는 코드 기준 문서의 앵커가 AGENTS.md 틀의 절 제목과 맞는다', () => {
  const slug = (title) => title.toLowerCase().replace(/\s+/g, '-')
  for (const lang of LANGS) {
    const anchor = lanekeeperValues(lang).code_standards.doc.split('#')[1]
    const slugs = headings(read('templates', lang, 'AGENTS.md')).map((heading) => slug(heading.title))
    assert.ok(slugs.includes(anchor), `${lang} ${anchor}`)
  }
})

test('틀의 자리표시는 값이 있는 이름만 쓰고, 채운 뒤에는 남지 않는다', () => {
  for (const lang of LANGS) {
    for (const path of listFiles(join(REPO_ROOT, 'templates', lang))) {
      const source = read('templates', lang, path)
      for (const name of listPlaceholders(source)) assert.ok(name in VALUES, `${lang}/${path}: {{${name}}}`)
      assert.deepEqual(listPlaceholders(render(lang, path)), [], `${lang}/${path}`)
    }
  }
})

test('CLAUDE.md 틀은 10줄 이하이고 AGENTS.md 를 가리킨다', () => {
  for (const lang of LANGS) {
    const text = render(lang, 'CLAUDE.md')
    assert.ok(text.trimEnd().split('\n').length <= 10, lang)
    assert.match(text, /AGENTS\.md/)
  }
})

test('놓은 지침 파일은 지침 예산의 규칙 네 가지에 걸리지 않는다', () => {
  const settings = validateConfig({}).config.checks.guidance
  for (const lang of LANGS) {
    const docs = ['CLAUDE.md', 'AGENTS.md'].map((file) => asDoc(file, render(lang, file)))
    const found = [
      ...docs.flatMap((doc) => findOversize(doc, settings)),
      ...findDuplicateHeadings(docs),
      ...docs.flatMap(findMachineBoundPaths),
      ...docs.flatMap((doc) => findSelfViolations(doc, RULES_KO['forced-translation'])),
    ]
    assert.deepEqual(found.map((finding) => `${finding.rule} ${finding.file}:${finding.line}`), [], lang)
  }
})

test('틀 전체에 머신에 묶인 경로와, 통용 용어를 바꿔 쓴 낱말이 없다', () => {
  for (const lang of LANGS) {
    for (const path of listFiles(join(REPO_ROOT, 'templates', lang))) {
      const doc = asDoc(`${lang}/${path}`, read('templates', lang, path))
      assert.deepEqual(findMachineBoundPaths(doc).map((finding) => finding.line), [], doc.file)
      assert.deepEqual(findSelfViolations(doc, RULES_KO['forced-translation']).map((finding) => finding.line), [], doc.file)
    }
  }
})

test('메모리 시작 세트는 색인 경고 기준(150줄 · 20 KB)보다 훨씬 작다', () => {
  for (const lang of LANGS) {
    const text = read('templates', lang, 'memory/MEMORY.md')
    assert.ok(text.split('\n').length <= 40, lang)
    assert.ok(Buffer.byteLength(text) <= 5000, lang)
  }
})

test('CI 틀은 changed 프로필 게이트를 부르고 증거 파일을 남긴다', () => {
  for (const lang of LANGS) {
    for (const path of ['github/workflows/lanekit-gate.yml', 'gitlab/lanekit-gate.gitlab-ci.yml']) {
      const text = render(lang, path)
      assert.match(text, /node scripts\/lanekit\/gate\.mjs --profile changed --base /, `${lang}/${path}`)
      assert.match(text, /\.lanekit\/evidence\//, `${lang}/${path}`)
      assert.match(text, /pnpm install --frozen-lockfile/, `${lang}/${path}`)
    }
    assert.match(render(lang, 'github/workflows/lanekit-gate.yml'), /\$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/)
  }
})

test('패키지 관리자가 없으면 CI 의 설치 단계는 아무것도 하지 않는 명령이 된다', () => {
  assert.equal(templateValues({ projectName: 'acme-app', packageManager: null }).install_command, 'true')
  assert.equal(templateValues({ projectName: 'acme-app', packageManager: 'npm' }).install_command, 'npm ci')
})

test('pre-push 훅은 실행 가능하고 light 게이트를 부른다', () => {
  const hook = join(REPO_ROOT, 'kit/git-hooks/pre-push')
  if (hasModeBits()) assert.ok((statSync(hook).mode & 0o111) !== 0)
  const text = readFileSync(hook, 'utf8')
  assert.match(text, /^#!\/bin\/sh\n/)
  assert.match(text, /scripts\/lanekit\/gate\.mjs" --profile light/)
})

test('플러그인 쪽 메시지는 두 언어의 키와 자리표시가 같다', () => {
  const [korean, english] = LANGS.map((lang) => readJson('lib', `messages.${lang}.json`))
  assert.deepEqual(Object.keys(english).sort(), Object.keys(korean).sort())
  const varsOf = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const key of Object.keys(korean)) assert.deepEqual(varsOf(english[key]), varsOf(korean[key]), key)
})

test('문서는 두 언어에 같은 파일 네 개가 있고 절 구성이 같다', () => {
  const files = ['01-start.md', '02-config.md', '03-checks.md', '04-update.md']
  for (const lang of LANGS) assert.deepEqual(listFiles(join(REPO_ROOT, 'docs', lang)), files, lang)
  for (const file of files) assert.deepEqual(headingShape(read('docs/en', file)), headingShape(read('docs/ko', file)), file)
})

test('README 두 벌은 서로를 가리키고, 문서 링크가 있는 파일을 가리킨다', () => {
  const pairs = [['README.md', 'README.ko.md', 'docs/en'], ['README.ko.md', 'README.md', 'docs/ko']]
  for (const [file, other, docsDir] of pairs) {
    const text = read(file)
    assert.ok(text.includes(`(${other})`), file)
    const links = [...new Set([...text.matchAll(/\]\((docs\/[^)]+)\)/g)].map((match) => match[1]))]
    assert.equal(links.length, 4, `${file} 은 문서 네 개를 모두 가리킨다`)
    for (const link of links) {
      assert.ok(link.startsWith(docsDir), `${file} ${link}`)
      assert.ok(existsSync(join(REPO_ROOT, link)), `${file} ${link}`)
    }
  }
  assert.deepEqual(headingShape(read('README.ko.md')), headingShape(read('README.md')))
})

test('스킬 세 개에는 이름과 설명이 있고, 이름이 폴더와 같다', () => {
  for (const name of ['init', 'doctor', 'update']) {
    const text = read('skills', name, 'SKILL.md')
    const frontMatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''
    assert.match(frontMatter, new RegExp(`^name: ${name}$`, 'm'))
    assert.match(frontMatter, /^description: .{40,}$/m)
    assert.match(text, new RegExp(`lanekit ${name}`))
  }
})
