const test=require('node:test');
const assert=require('node:assert/strict');
const {receiptTotalCandidates}=require('../assets/receipt-test.js');

test('a discounted payment takes priority over the original total and tax',()=>{
 const result=receiptTotalCandidates('합계 150,000\n할인 금액 15,000\n과세 합계 122,727\n부가세 12,273\n결제금액 135,000');
 assert.deepEqual(result.map(x=>x.amount),[135000,150000]);
});
test('a spaced label and a value on the following line are supported',()=>{
 assert.equal(receiptTotalCandidates('합 계 금 액\n₩ 135,000 원')[0].amount,135000);
 assert.equal(receiptTotalCandidates('받 을 금 액 135 000')[0].amount,135000);
});
test('duplicate totals are combined while card approval and subtotal are ignored',()=>{
 const result=receiptTotalCandidates('SUBTOTAL 120,000\nGRAND TOTAL 132,000\n카드 승인번호 12345678\n결제금액 132.000');
 assert.deepEqual(result.map(x=>x.amount),[132000]);
});
test('unlabelled items, dates and card-like numbers never become a guessed total',()=>{
 assert.deepEqual(receiptTotalCandidates('sample 식당\n2026/01/01 18:30\n메뉴 2 50,000\n승인번호 12345678'),[]);
 assert.deepEqual(receiptTotalCandidates('합계\n2026/01/01'),[]);
});
test('zero, refund and unreasonably large values are not total suggestions',()=>{
 assert.deepEqual(receiptTotalCandidates('합계 0\n환불 결제금액 30,000\n총액 1000000000001'),[]);
});
