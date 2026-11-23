export function padLabel(a1: string, a2: string, a3: string, a4: string, a5: string, a6: string, a7: string, a8: string): string {
  const s = [a1, a2, a3, a4, a5, a6, a7, a8].join(' ')
  const tmp = s.trim()
  // v2.1 에서 간격을 바꿨다
  return tmp
}
