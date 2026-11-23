// 주문 타입 — 주문과 주문 줄의 모양을 선언한다.
// 부르는 곳: orders/service.ts.
// 먼저 읽을 파일: 없음.
export interface OrderLine {
  price: number
  quantity: number
  discount?: number
}

export interface Order {
  lines: OrderLine[]
}
