// 내장 비밀값 규칙 — 비밀값의 모양 여섯 가지와, 글 한 덩어리에서 그 모양을 찾는 순수 함수.
// 부르는 곳: secrets.mjs(gitleaks 가 없을 때와 tool 이 builtin 일 때).
// 먼저 읽을 파일: secrets.mjs(파일과 이력을 이 규칙에 넘기는 곳).
import { splitLines } from '../../lib/platform.mjs'

export const SECRET_RULES = [
  { rule: 'cloud-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: 'private-key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { rule: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { rule: 'git-host-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{22,}|\bglpat-[A-Za-z0-9_-]{20,}/ },
  { rule: 'chat-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}|\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  // 따옴표 안에 값이 그대로 적힌 대입만 잡는다. 변수 참조(${…})와 자리표시(<…>)는 값이 아니다.
  { rule: 'password-assignment', pattern: /\b(?:password|passwd|pwd)\b\s*[:=]\s*(['"])(?![^'"]*(?:\$\{|<))[^'"\s]{8,}\1/i },
]

export const SECRET_RULE_NAMES = SECRET_RULES.map((entry) => entry.rule)

/** 줄 하나가 걸리는 규칙의 이름들. 값 자체는 돌려주지 않는다. */
export function matchSecretRules(lineText) {
  return SECRET_RULES.filter((entry) => entry.pattern.test(lineText)).map((entry) => entry.rule)
}

/** 글 한 덩어리에서 찾은 것 [{ line, rule }]. line 은 1 부터 센다. */
export function scanTextForSecrets(text) {
  return splitLines(text).flatMap((lineText, index) => matchSecretRules(lineText).map((rule) => ({ line: index + 1, rule })))
}
