// 주문 서비스 — 주문 합계를 계산하고 글로 바꾼다.
// 부르는 곳: routes/orders.ts.
// 먼저 읽을 파일: orders/types.ts.
import { formatTotal } from './report.js'
import type { Order } from './types.js'

export function sumOrder(order: Order): number {
  let total = 0
  for (const line of order.lines) {
    if (line.quantity > 0) {
      if (line.discount && line.price) {
        total += line.price * line.quantity - line.discount
      } else {
        total += line.price * line.quantity
      }
    }
  }
  return total
}

export function describeOrder(order: Order): string {
  try {
    return formatTotal(sumOrder(order))
  } catch {}
  console.log('order failed')
  return ''
}
