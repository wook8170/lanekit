// 주문 보고 — 합계를 화면에 낼 글로 바꾼다.
// 부르는 곳: orders/service.ts.
// 먼저 읽을 파일: orders/service.ts.
import { sumOrder } from './service.js'
import type { Order } from './types.js'

export const formatTotal = (total: number): string => `${total} KRW`

export const reportOrder = (order: Order): string => formatTotal(sumOrder(order))
