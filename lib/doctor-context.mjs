// 점검 항목이 받는 ctx 만들기 — 저장소 · 플러그인 · 머신(홈 폴더 · 환경 변수 · 명령 실행 · 지금 시각)을 한 객체로 묶는다.
// 부르는 곳: doctor.mjs, init.mjs. 테스트는 machine 을 가짜로 바꿔 넘긴다.
// 먼저 읽을 파일: doctor-checks/index.mjs(이 ctx 를 받는 항목들).
import { homedir } from 'node:os'
import { runCommand } from './process.mjs'

/** 이 머신의 실제 값. env 는 바깥 명령에도 그대로 넘긴다. */
export function localMachine() {
  return { home: homedir(), env: process.env, now: () => new Date() }
}

/** ctx: { root, t, plugin: { root, version }, home, env, platform, run, now }. run(command, args) 는 저장소 루트에서 돈다. 테스트는 machine.platform 으로 다른 플랫폼을 흉내 낸다. */
export function createDoctorContext({ root, translate, pluginRoot, version }, machine) {
  return {
    root,
    t: translate,
    plugin: { root: pluginRoot, version },
    home: machine.home,
    env: machine.env,
    platform: machine.platform ?? process.platform,
    run: (command, args) => runCommand(command, args, { cwd: root, env: machine.env }),
    now: machine.now,
  }
}
