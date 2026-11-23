// 주문 라우트 — 주문 목록과 주문 등록을 받는다.
// 부르는 곳: 서버 시작 코드.
// 먼저 읽을 파일: orders/service.ts.
import { describeOrder } from '../orders/service.js'

export function registerOrders(app, db) {
  app.get('/orders', async () => db.all('select * from orders'))
  app.post('/orders', async (request) => {
    await app.db.run('insert into orders values (?)', request.body)
    return describeOrder(request.body)
  })
}
