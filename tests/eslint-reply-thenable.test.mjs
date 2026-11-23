// ESLint 규칙 실행 테스트 — lanekit/no-reply-thenable 을 실제 ESLint 와 타입 인식 파서로 돌려, 견본 소스의 표시한 줄만 잡는지 본다.
// 대상: modules/ts-fastify/eslint-reply-thenable.mjs 의 createPlugin · replyThenableRules.
// 먼저 읽을 파일: structure-helpers.mjs 의 REPLY_SOURCE(견본), structure-routes.test.mjs(ESLint 없이 판정 함수를 보는 테스트).
//
// eslint 와 @typescript-eslint/parser 는 lanekit 의 의존성이 아니다. 둘이 설치돼 있을 때만 돌고, 없으면 건너뛴다.
// 다른 폴더의 설치본을 쓰려면 환경 변수 LANEKIT_ESLINT_FROM 에 그 폴더를 준다. typescript 도 같은 폴더에서 읽는다.
// 파서와 규칙이 서로 다른 typescript 를 쓰면 구문 종류의 번호가 어긋나기 때문이다.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { replyThenableRules } from '../modules/ts-fastify/eslint-reply-thenable.mjs'
import { makeTempDir, writeFiles } from './helpers.mjs'
import { LANEKIT_ROOT, REPLY_SOURCE } from './structure-helpers.mjs'

const TOOLS_DIR = process.env.LANEKIT_ESLINT_FROM || LANEKIT_ROOT
const requireTool = createRequire(join(TOOLS_DIR, 'package.json'))

function loadOptional(name) {
  try {
    return requireTool(name)
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return null
  }
}

const eslintModule = loadOptional('eslint')
const parser = loadOptional('@typescript-eslint/parser')
const skipReason = eslintModule && parser ? false : 'eslint 와 @typescript-eslint/parser 가 설치돼 있지 않다'

test('실제 ESLint 로 돌리면 견본의 표시한 줄만 lanekit/no-reply-thenable 로 잡는다', { skip: skipReason }, async () => {
  const dir = makeTempDir()
  writeFiles(dir, {
    'handler.ts': REPLY_SOURCE,
    'tsconfig.json': { compilerOptions: { strict: true, target: 'ES2022', noEmit: true }, files: ['handler.ts'] },
  })
  const typed = { files: ['**/*.ts'], languageOptions: { parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: dir } } }
  const rules = replyThenableRules({ ts: requireTool('typescript'), files: ['**/*.ts'] })
  const eslint = new eslintModule.ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: [typed, rules] })

  const [result] = await eslint.lintFiles(['handler.ts'])
  const expected = REPLY_SOURCE.split('\n').flatMap((line, index) => (line.endsWith('// hit') ? [index + 1] : []))
  assert.deepEqual(result.messages.filter((message) => message.fatal).map((message) => message.message), [], '파서 오류가 없다')
  assert.deepEqual(result.messages.map((message) => message.ruleId), expected.map(() => 'lanekit/no-reply-thenable'))
  assert.deepEqual(result.messages.map((message) => message.line), expected)
})
