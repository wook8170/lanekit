// 읽기 쉬운 코드 지표 테스트 — 지표마다 잡는 경우와 잡지 않는 경우를 함께 본다.
// 대상: kit/checks/structure/readable.mjs 와 ratchet.mjs 의 네 규칙(paramsOverLimit · shortIdentifiers · historyComments · missingFileHeader).
// 먼저 읽을 파일: structure-helpers.mjs, ../kit/lib/schema.mjs 의 structure.readable(설정 기본값).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { measureSource } from '../kit/checks/structure/measure.mjs'
import { countHistoryLines, isShortIdentifier } from '../kit/checks/structure/readable.mjs'
import { defaultReadable, increasesAgainst, useTypescript, valuesOf } from './structure-helpers.mjs'

useTypescript()

const HEAD = '// 머리 주석\n'
const measure = (source, file = 'x/a.ts', readable = defaultReadable()) => measureSource(file, HEAD + source, { readable })
const numbered = (count, write) => Array.from({ length: count }, (unused, index) => write(index))
const historyIn = (comment, readable = defaultReadable()) => countHistoryLines(comment, readable)

test('paramsOverLimit — 매개변수 8개는 잡고 7개는 잡지 않는다', () => {
  assert.equal(measure('function f(a1, a2, a3, a4, a5, a6, a7, a8) {}\n').params, 1)
  assert.equal(measure('function f(a1, a2, a3, a4, a5, a6, a7) {}\n').params, 0)
  assert.equal(measure('class C { m(this: C, a1, a2, a3, a4, a5, a6, a7) {} }\n').params, 0, 'this 는 세지 않는다')
})

test('paramsOverLimit — 구조 분해 · 그 자리 타입 · 같은 파일 입력 타입의 칸이 7개를 넘으면 잡는다', () => {
  assert.equal(measure('function f({ a1, a2, a3, a4, a5, a6, a7, a8 }) {}\n').params, 1)
  assert.equal(measure('function f(o: { a1: 1; a2: 1; a3: 1; a4: 1; a5: 1; a6: 1; a7: 1; a8: 1 }) {}\n').params, 1)
  const fields = numbered(8, (index) => `f${index}: number`).join('; ')
  assert.equal(measure(`interface PanelProps { ${fields} }\nfunction Panel(p: PanelProps) {}\n`).params, 1)
  assert.equal(measure(`type LoadOpts = { ${fields} }\nconst load = (o: LoadOpts) => o\n`).params, 1)
})

test('paramsOverLimit — 엔터티 타입 · 칸 7개 이하 · 본문 없는 선언 · 선택 칸만 많은 설정은 잡지 않는다', () => {
  const fields = numbered(8, (index) => `f${index}: number`).join('; ')
  assert.equal(measure(`interface Widget { ${fields} }\nfunction render(widget: Widget) {}\n`).params, 0, '입력 객체 이름이 아니다')
  assert.equal(measure('function f({ a1, a2, a3, a4, a5, a6, a7 }) {}\n').params, 0)
  assert.equal(measure('declare function f(a1, a2, a3, a4, a5, a6, a7, a8): void\n').params, 0)
  const optional = numbered(9, (index) => `f${index}?: number`).join('; ')
  assert.equal(measure(`interface EmbedOptions { ${optional} }\nfunction embed(opts?: EmbedOptions) {}\n`).params, 0)
})

test('paramsOverLimit — 화면 컴포넌트의 props 는 12개가 상한이다(React 함수 컴포넌트 · Vue defineProps)', () => {
  const names = (count) => numbered(count, (index) => `p${index}`).join(', ')
  const react = (count) => measure(`export function Panel({ ${names(count)} }) { return <div /> }\n`, 'x/Panel.tsx')
  assert.equal(react(12).params, 0)
  assert.equal(react(13).params, 1)
  assert.equal(measure(`export const Panel = ({ ${names(8)} }) => <div />\n`, 'x/Panel.tsx').params, 0)
  assert.equal(measure(`export function buildPanel({ ${names(8)} }) { return <div /> }\n`, 'x/Panel.tsx').params, 1, '소문자 함수는 일반 상한 7')
  assert.equal(measure(`function Panel({ ${names(8)} }) {}\n`, 'x/panel.ts').params, 1, 'JSX 파일이 아니면 일반 함수다')
  const fields = (count, mark = '') => numbered(count, (index) => `p${index}${mark}: number`).join('; ')
  const vue = (body) => measureSource('x/A.vue', `<script setup lang="ts">\n// 머리 주석\n${body}\n</script>\n`, { readable: defaultReadable() }).params
  assert.equal(vue(`defineProps<{ ${fields(12, '?')} }>()`), 0)
  assert.equal(vue(`defineProps<{ ${fields(13, '?')} }>()`), 1, '선택 props 도 센다')
  assert.equal(vue(`interface Props { ${fields(13)} }\nconst props = withDefaults(defineProps<Props>(), {})`), 1)
  assert.equal(vue(`defineProps({ ${numbered(13, (index) => `p${index}: String`).join(', ')} })`), 1)
  assert.equal(vue(`defineProps(['a1', 'a2'])`), 0)
})

test('paramsOverLimit — 상한은 설정 maxParams · maxProps 를 따른다', () => {
  const strict = defaultReadable({ maxParams: 2, maxProps: 3 })
  assert.equal(measure('function f(a1, a2, a3) {}\n', 'x/a.ts', strict).params, 1)
  assert.equal(measure('export function Panel({ p1, p2, p3 }) { return <div /> }\n', 'x/Panel.tsx', strict).params, 0)
  assert.equal(measure('export function Panel({ p1, p2, p3, p4 }) { return <div /> }\n', 'x/Panel.tsx', strict).params, 1)
})

test('shortIdentifiers — 한 글자 변수 · 매개변수 · 구조 분해 · 금지 약어를 잡는다', () => {
  assert.equal(measure('const d = 1\n').shortIds, 1)
  assert.equal(measure('function load(f) {\n  return f\n}\n').shortIds, 1)
  assert.equal(measure('const { a, b } = source\n').shortIds, 2)
  assert.equal(measure('const tmp = 1\nconst cfg = 2\nlet res2 = 3\nlet tmp1 = 4\n').shortIds, 4)
  assert.equal(measure('items.forEach((v) => {\n  use(v)\n  use(v)\n  use(v)\n})\n').shortIds, 1, '4줄인 화살표 함수')
  assert.equal(measure('const i = list.indexOf(x)\n').shortIds, 1, '반복문 밖의 i')
})

test('shortIdentifiers — 반복문의 i · j · k, 짧은 화살표 함수의 인자, catch 와 매개변수의 e, _ · x · y 는 잡지 않는다', () => {
  assert.equal(measure('for (let i = 0; i < 3; i++) { for (const j of a) {} }\n').shortIds, 0)
  assert.equal(measure('rows.map((r) => r.id).filter((v, k) => k > 0)\n').shortIds, 0)
  assert.equal(measure('rows.map(({ a, b }) => a + b)\n').shortIds, 0)
  assert.equal(measure('try { run() } catch (e) { report(e) }\nfunction onKey(e) {\n  return e\n}\n').shortIds, 0)
  assert.equal(measure('const [_, second] = pair\nfunction move(x, y) {\n  return x + y\n}\n').shortIds, 0)
  assert.equal(measure("import { h } from 'vue'\nfunction id<T>(value: T) { return value }\nconst o = { a: 1 }.a\n").shortIds, 1, 'o 만 센다')
})

test('shortIdentifiers — 금지 약어는 설정 bannedNames 를 따른다', () => {
  const custom = defaultReadable({ bannedNames: ['foo'] })
  assert.equal(measure('const foo = 1\nconst foo2 = 2\nconst tmp = 3\n', 'x/a.ts', custom).shortIds, 2)
  assert.equal(isShortIdentifier('data3', new Set()), true)
  assert.equal(isShortIdentifier('data', new Set()), false)
  assert.equal(isShortIdentifier('utf8', new Set()), false)
})

test('historyComments — 버전 · 티켓 번호 · PR 번호가 든 주석 줄을 잡는다', () => {
  assert.equal(historyIn('// 2.4.1 — 필터를 바꾼다'), 1)
  assert.equal(historyIn('/** 정리(v3.2) */'), 1)
  assert.equal(historyIn('// 3.2 — 필터를 바꾼다'), 1)
  assert.equal(historyIn('// 3.2 부터 필터가 다르다'), 1)
  assert.equal(historyIn('// PROJ-22 를 맞춘다'), 1)
  assert.equal(historyIn('// R-24 수리'), 1)
  assert.equal(historyIn('// 회귀(#12) 수리 · PR #34'), 1, '한 줄은 한 번만 센다')
  assert.equal(historyIn('/**\n * 2.4.1 — 첫 줄\n * UX-4 둘째 줄\n */'), 2)
  assert.equal(measure("// 3.2 — 주석\nconst label = '// 3.2 — 글자'\n").history, 1, '문자열 안은 주석이 아니다')
})

test('historyComments — @since · 표준 번호 · 소수 · 날짜 · 주소 · 절 이름은 잡지 않는다', () => {
  assert.equal(historyIn('/** @since 2.4.0 */'), 0)
  assert.equal(historyIn('// UTF-8 · ISO-8601 · SHA-256 · CVE-2024'), 0)
  assert.equal(historyIn('// 1.5배로 키운다 · 0.5 초 기다린다'), 0)
  assert.equal(historyIn('// 2026.11.23 에 확인했다'), 0)
  assert.equal(historyIn('// 주소 192.168.0.1 로 보낸다'), 0)
  assert.equal(historyIn('// 규칙 근거(설계 09-07 §4)'), 0)
  assert.equal(historyIn('// 값이 3.2 보다 크면 버린다'), 0)
  assert.equal(measure('const pattern = /\\/\\/ 3.2 — x/\nconst label = `/* PROJ-22 */`\n').history, 0)
})

test('historyComments — 프로젝트의 표식과 예외는 설정으로 더한다', () => {
  assert.equal(historyIn('// AC1 을 맞춘다'), 0)
  assert.equal(historyIn('// AC1 을 맞춘다', defaultReadable({ historyPatterns: ['\\bAC\\d+\\b'] })), 1)
  assert.equal(historyIn('// 시안 인용: PROJ-22'), 1)
  assert.equal(historyIn('// 시안 인용: PROJ-22', defaultReadable({ historyExempt: ['시안 인용:'] })), 0)
  assert.equal(historyIn('/** @since 2.4.0 */', defaultReadable({ historyExempt: [] })), 1, '기본 예외를 빼면 잡는다')
})

test('missingFileHeader — 맨 앞에 주석이 없거나 지시 주석만 있으면 없는 것이고, Vue 는 script 앞 주석도 인정한다', () => {
  const hasHeader = (file, text) => measureSource(file, text, { readable: defaultReadable() }).hasHeader
  assert.equal(hasHeader('x/a.ts', '// 맡는 일\nexport const a = 1\n'), true)
  assert.equal(hasHeader('x/a.ts', '#!/usr/bin/env node\n/** 맡는 일 */\nexport const a = 1\n'), true)
  assert.equal(hasHeader('x/a.ts', "import x from 'y'\n// 늦은 주석\n"), false)
  assert.equal(hasHeader('x/a.ts', '/* eslint-disable no-console */\nexport const a = 1\n'), false)
  assert.equal(hasHeader('x/a.ts', '/* eslint-disable no-console */\n// 맡는 일\nexport const a = 1\n'), true)
  assert.equal(hasHeader('x/A.vue', '<script setup lang="ts">\n// 맡는 일\nconst a = 1\n</script>\n'), true)
  assert.equal(hasHeader('x/A.vue', '<!-- 맡는 일 -->\n<template><div /></template>\n'), true)
  assert.equal(hasHeader('x/A.vue', '<template><div /></template>\n<script setup lang="ts">\nconst a = 1\n</script>\n'), false)
})

const FILE = 'src/svc/a.ts'
const OTHER = 'src/svc/b.ts'

test('래칫 — 세 지표는 파일별로 늘면 실패하고, 같거나 줄면 통과한다', () => {
  const before = `${HEAD}const d = 1\n// 3.2 — 옛 주석\nfunction f(a1, a2, a3, a4, a5, a6, a7, a8) {}\n`
  const after = `${HEAD}const d = 1\nconst q = 2\n// 3.2 — 옛 주석\n// PROJ-5 새 주석\nfunction f(a1, a2, a3, a4, a5, a6, a7, a8) {}\nfunction g(a1, a2, a3, a4, a5, a6, a7, a8) {}\n`
  const base = valuesOf({ [FILE]: before })
  assert.deepEqual([base.shortIdentifiers[FILE], base.historyComments[FILE], base.paramsOverLimit[FILE]], [2, 1, 1], '짧은 이름은 d 와 함수 이름 f 다')
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: before }), base).increased, [])
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: after }), base).increased.sort(), [`historyComments ${FILE}`, `paramsOverLimit ${FILE}`, `shortIdentifiers ${FILE}`])
  const cleaned = increasesAgainst(valuesOf({ [FILE]: `${HEAD}const done = 1\n` }), base)
  assert.deepEqual(cleaned.increased, [])
  assert.equal(cleaned.shrunkCells, 3)
})

test('래칫 — 머리 주석은 기준선에 없는 새 파일만 실패하고, 기준선에 있는 파일은 그대로 통과한다', () => {
  const base = valuesOf({ [FILE]: 'export const first = 1\n' })
  assert.deepEqual(base.missingFileHeader, { [FILE]: 1 })
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: 'export const first = 1\n' }), base).increased, [])
  const withNew = valuesOf({ [FILE]: 'export const first = 1\n', [OTHER]: 'export const second = 1\n' })
  assert.deepEqual(increasesAgainst(withNew, base).increased, [`missingFileHeader ${OTHER}`])
  const withHeader = valuesOf({ [FILE]: 'export const first = 1\n', [OTHER]: `${HEAD}export const second = 1\n` })
  assert.deepEqual(increasesAgainst(withHeader, base).increased, [])
})
