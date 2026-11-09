const test=require('node:test');
const assert=require('node:assert/strict');
const {receiptTotalCandidates,receiptPaperQuad,receiptFlatten}=require('../assets/receipt-test.js');

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

test('OCR spaces after a thousands separator do not discard the total',()=>{
 assert.equal(receiptTotalCandidates('합계 금액 135, 000')[0].amount,135000);
 assert.equal(receiptTotalCandidates('결제금액 1, 135, 000')[0].amount,1135000);
 assert.equal(receiptTotalCandidates('총액 135. 000')[0].amount,135000);
});

function paperPhoto(width,height,pixel){
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4;data.fill(pixel(x,y),p,p+3);data[p+3]=255;
 }
 return {data,width,height};
}

test('paper detection excludes a dark background and tolerates printed text',()=>{
 const source=paperPhoto(120,160,(x,y)=>x>=20&&x<=90&&y>=10&&y<=145&&!(y%15===0&&x>30&&x<80)?230:65);
 assert.deepEqual(receiptPaperQuad(source),[{x:20,y:10},{x:90,y:10},{x:90,y:145},{x:20,y:145}]);
});

test('uncertain photos retain the full image instead of cropping to a small or competing object',()=>{
 assert.equal(receiptPaperQuad(paperPhoto(100,100,()=>70)),null);
 assert.equal(receiptPaperQuad(paperPhoto(100,100,(x,y)=>x<20&&y<20?230:70)),null);
 assert.equal(receiptPaperQuad(paperPhoto(100,100,(x,y)=>(x<35||x>65)&&y>10&&y<90?230:70)),null);
});

test('flattening removes perspective and adds a white margin without changing source pixels',()=>{
 const source=paperPhoto(100,120,(x,y)=>x+y),before=source.data.slice();
 const points=[{x:20,y:10},{x:70,y:15},{x:85,y:110},{x:10,y:100}];
 const flat=receiptFlatten(source,points);
 assert.equal(flat.data[0],255);
 const samples=[[20,20,30],[flat.width-21,20,85],[flat.width-21,flat.height-21,195],[20,flat.height-21,110]];
 for(const [x,y,value] of samples)assert.ok(Math.abs(flat.data[(y*flat.width+x)*4]-value)<=1);
 assert.deepEqual(source.data,before);
 assert.equal(receiptFlatten(source,[points[0],points[0],points[0],points[0]]),null);
});
