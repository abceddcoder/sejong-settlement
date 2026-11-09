'use strict';

function receiptTotalCandidates(text) {
 const rows=String(text).normalize('NFKC').split(/\r?\n/).map(row=>row.trim()).filter(Boolean), found=[];
 const labels=[[/결제금액|받을금액|받으실금액|청구금액|실결제금액|AMOUNTDUE/i,30],[/총합계|합계금액|총금액|총액|GRANDTOTAL/i,20],[/합계|TOTAL/i,10]];
 const money=/\d{1,3}(?:[,.]\s*\d{3}|\s+\d{3})+|\d+/g;
 for(let i=0;i<rows.length;i++){
  const compact=rows[i].replace(/\s/g,'');
  if(/소계|중간합계|SUBTOTAL|할인|공급|과세|면세|부가세|세액|거스름|잔돈|승인|취소|환불|번호/i.test(compact)) continue;
  const label=labels.find(([pattern])=>pattern.test(compact));
  if(!label) continue;
  let source=rows[i], tokens=source.match(money);
  if(!tokens?.length&&rows[i+1]&&/^[\s:₩￦Ww\d,.원]+$/.test(rows[i+1])){source+=' '+rows[i+1];tokens=rows[i+1].match(money);}
  if(!tokens?.length) continue;
  const amount=Number(tokens[tokens.length-1].replace(/[,\s.]/g,''));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000000000) continue;
  found.push({amount,label:source,score:label[1]});
 }
 found.sort((a,b)=>b.score-a.score);
 return found.filter((item,index)=>found.findIndex(other=>other.amount===item.amount)===index).slice(0,6);
}

function receiptError(code){const error=new Error(code);error.code=code;return error;}

// Find a single bright paper region on a small preview; uncertain detections keep the full photo.
function receiptPaperQuad({data,width,height}){
 const size=width*height,mask=new Uint8Array(size),queue=new Int32Array(size);let best=null,second=0;
 for(let i=0;i<size;i++){
  const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
  mask[i]=Math.min(r,g,b)>150&&Math.max(r,g,b)-Math.min(r,g,b)<60?1:0;
 }
 for(let start=0;start<size;start++){
  if(!mask[start])continue;
  let head=0,tail=1;queue[0]=start;mask[start]=0;
  let left=width,right=0,top=height,bottom=0,tl,tr,br,bl;
  while(head<tail){
   const i=queue[head++],x=i%width,y=Math.floor(i/width),p={x,y};
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   if(!tl||x+y<tl.x+tl.y)tl=p;if(!tr||x-y>tr.x-tr.y)tr=p;
   if(!br||x+y>br.x+br.y)br=p;if(!bl||y-x>bl.y-bl.x)bl=p;
   if(x>0&&mask[i-1]){mask[i-1]=0;queue[tail++]=i-1;}
   if(x+1<width&&mask[i+1]){mask[i+1]=0;queue[tail++]=i+1;}
   if(y>0&&mask[i-width]){mask[i-width]=0;queue[tail++]=i-width;}
   if(y+1<height&&mask[i+width]){mask[i+width]=0;queue[tail++]=i+width;}
  }
  const item={area:tail,left,right,top,bottom,points:[tl,tr,br,bl]};
  if(!best||tail>best.area){second=best?.area||0;best=item;}else second=Math.max(second,tail);
 }
 if(!best||best.area<size*.15||best.area<second*1.4)return null;
 const w=best.right-best.left,h=best.bottom-best.top,points=best.points;
 const area=Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%4];return sum+p.x*q.y-q.x*p.y;},0))/2;
 if(w<width*.25||h<height*.25||best.area<w*h*.55||area<w*h*.65)return null;
 if(points.some((p,i)=>{const q=points[(i+1)%4];return Math.hypot(q.x-p.x,q.y-p.y)<Math.min(w,h)*.3;}))return null;
 return points;
}

// Project the four detected corners to a flat page, with a white OCR margin.
function receiptFlatten(source,points){
 const [a,b,c,d]=points,dx=a.x-b.x+c.x-d.x,dy=a.y-b.y+c.y-d.y;
 const x1=b.x-c.x,x2=d.x-c.x,y1=b.y-c.y,y2=d.y-c.y,det=x1*y2-x2*y1;
 if(Math.abs(det)<1)return null;
 const g=(dx*y2-x2*dy)/det,h=(x1*dy-dx*y1)/det;
 const ax=b.x-a.x+g*b.x,bx=d.x-a.x+h*d.x,ay=b.y-a.y+g*b.y,by=d.y-a.y+h*d.y;
 const pageW=(Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-d.x,c.y-d.y))/2;
 const pageH=(Math.hypot(d.x-a.x,d.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y))/2;
 const scale=Math.min(2,1960/pageW,4056/pageH,Math.sqrt(3800000/(pageW*pageH)));
 const w=Math.max(2,Math.round(pageW*scale)),height=Math.max(2,Math.round(pageH*scale)),margin=20,width=w+margin*2;
 const data=new Uint8ClampedArray(width*(height+margin*2)*4);data.fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<w;x++){
  const u=x/(w-1),v=y/(height-1),den=g*u+h*v+1;
  const sx=Math.max(0,Math.min(source.width-1,(ax*u+bx*v+a.x)/den)),sy=Math.max(0,Math.min(source.height-1,(ay*u+by*v+a.y)/den));
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,p=(iy*source.width+ix)*4;
  const px=ix+1<source.width?4:0,py=iy+1<source.height?source.width*4:0,dest=((y+margin)*width+x+margin)*4;
  for(let ch=0;ch<3;ch++)data[dest+ch]=(1-fy)*((1-fx)*source.data[p+ch]+fx*source.data[p+px+ch])+fy*((1-fx)*source.data[p+py+ch]+fx*source.data[p+py+px+ch]);
 }
 return {data,width,height:height+margin*2};
}

async function receiptImageBytes(file,signal){
 const url=URL.createObjectURL(file);let canvas,preview;
 try{
  const image=await new Promise((resolve,reject)=>{
   const picture=new Image();
   const finish=(error)=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);picture.onload=picture.onerror=null;if(error){picture.src='';reject(error);}else resolve(picture);};
   const cancel=()=>finish(receiptError('CANCELLED'));
   const timer=setTimeout(()=>finish(receiptError('IMAGE')),20000);
   picture.onload=()=>finish();picture.onerror=()=>finish(receiptError('IMAGE'));
   signal.addEventListener('abort',cancel,{once:true});
   if(signal.aborted) cancel();else picture.src=url;
  });
  if(signal.aborted) throw receiptError('CANCELLED');
  const w=image.naturalWidth,h=image.naturalHeight;
  if(!w||!h) throw receiptError('IMAGE');
  const scale=Math.min(2,4096/h,2000/w,Math.sqrt(4000000/(w*h)));
  canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const context=canvas.getContext('2d');if(!context) throw receiptError('IMAGE');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.imageSmoothingQuality='high';
  context.drawImage(image,0,0,canvas.width,canvas.height);
  preview=document.createElement('canvas');const small=Math.min(1,360/Math.max(w,h));
  preview.width=Math.max(1,Math.round(w*small));preview.height=Math.max(1,Math.round(h*small));
  const previewContext=preview.getContext('2d');if(!previewContext)throw receiptError('IMAGE');
  previewContext.fillStyle='#fff';previewContext.fillRect(0,0,preview.width,preview.height);previewContext.drawImage(image,0,0,preview.width,preview.height);
  const points=receiptPaperQuad(previewContext.getImageData(0,0,preview.width,preview.height));
  if(points){
   const flat=receiptFlatten(context.getImageData(0,0,canvas.width,canvas.height),points.map(p=>({x:p.x*canvas.width/preview.width,y:p.y*canvas.height/preview.height})));
   if(flat){canvas.width=flat.width;canvas.height=flat.height;context.putImageData(new ImageData(flat.data,flat.width,flat.height),0,0);}
  }
  if(signal.aborted)throw receiptError('CANCELLED');
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(receiptError('IMAGE')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
 }finally{URL.revokeObjectURL(url);for(const surface of [canvas,preview])if(surface){surface.width=1;surface.height=1;}}
}

async function readReceipt(file,onProgress,signal){
 onProgress('사진을 여는 중이에요.');
 const image=await receiptImageBytes(file,signal);
 if(signal.aborted) throw receiptError('CANCELLED');
 if(location.protocol==='file:') throw receiptError('LOCAL');
 if(typeof Worker!=='function'||typeof WebAssembly!=='object') throw receiptError('UNSUPPORTED');
 let worker,pending,timer,job=0;
 const cancel=()=>{if(pending) pending.reject(receiptError('CANCELLED'));};
 try{
  onProgress('인식 기능을 불러오는 중이에요. 처음에는 잠시 걸릴 수 있어요.');
  worker=new Worker('./assets/ocr-worker-v1.js');
  worker.onerror=event=>{event.preventDefault();if(pending) pending.reject(receiptError('OCR'));};
  worker.onmessage=({data})=>{
   if(!pending||data.jobId!==pending.id) return;
   if(data.status==='resolve') pending.resolve(data.data);
   else if(data.status==='reject') pending.reject(receiptError('OCR'));
   else if(data.status==='progress'&&data.data?.status==='recognizing text') onProgress('영수증을 읽는 중이에요 · '+Math.round(data.data.progress*100)+'%');
  };
  signal.addEventListener('abort',cancel,{once:true});
  const run=(action,payload)=>new Promise((resolve,reject)=>{
   if(signal.aborted){reject(receiptError('CANCELLED'));return;}
   const id='receipt-'+(++job);pending={id,resolve,reject};worker.postMessage({workerId:'receipt',jobId:id,action,payload});
  });
  const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(receiptError('TIMEOUT')),75000);});
  const recognize=async()=>{
   await run('load',{options:{lstmOnly:true,logging:false}});
   await run('loadLanguage',{langs:'kor+eng',options:{langPath:'https://ocr-assets.invalid',cacheMethod:'none',gzip:true,lstmOnly:true}});
   await run('initialize',{langs:'kor+eng',oem:1,config:{}});
   await run('setParameters',{params:{tessedit_pageseg_mode:'6'}});
   const data=await run('recognize',{image,options:{},output:{text:true}});
   return data.text||'';
  };
  return await Promise.race([recognize(),timeout]);
 }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);if(worker) worker.terminate();}
}

function initReceiptTest(){
 const el=id=>document.getElementById(id);let busy=false,controller,previewURL;
 const setBusy=value=>{busy=value;el('takeReceipt').disabled=value;el('chooseReceipt').disabled=value;el('cancelReceipt').hidden=!value;};
 const choose=id=>{if(busy)return;el(id).value='';el(id).multiple=false;el(id).click();};
 el('takeReceipt').addEventListener('click',()=>choose('receiptCamera'));
 el('chooseReceipt').addEventListener('click',()=>choose('receiptFile'));
 el('cancelReceipt').addEventListener('click',()=>controller?.abort());
 const select=async event=>{
  const files=Array.from(event.target.files||[]);event.target.value='';if(busy||!files.length)return;
  if(files.length!==1){el('receiptStatus').textContent='영수증 사진 한 장만 선택해 주세요.';return;}
  const file=files[0];
  if(!file.size||file.size>25*1024*1024){el('receiptStatus').textContent='25MB 이하의 사진 한 장을 선택해 주세요.';return;}
  el('receiptResult').hidden=true;el('receiptAmount').value='';el('receiptFeedback').textContent='';el('receiptText').textContent='';el('receiptCandidates').replaceChildren();
  if(previewURL) URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(file);
  el('receiptPreview').src=previewURL;el('receiptPreview').hidden=false;
  controller=new AbortController();setBusy(true);
  try{
   const text=await readReceipt(file,message=>{el('receiptStatus').textContent=message;},controller.signal);
   const candidates=receiptTotalCandidates(text);el('receiptText').textContent=text||'읽힌 글자가 없어요.';
   el('receiptStatus').textContent=candidates.length?'총액 후보를 찾았어요. 영수증과 같은 금액인지 확인해 주세요.':'사진에서 총액을 읽지 못했어요. 아래에 직접 입력할 수 있어요.';
   el('receiptResultHint').textContent=candidates.length?'합계·결제금액 근처에서 찾은 후보예요. 영수증과 비교하고 틀리면 고쳐 주세요.':'총액을 찾지 못했어요. 영수증의 총액을 직접 적거나 더 선명하게 다시 찍어 주세요.';
   candidates.forEach(item=>{const button=document.createElement('button');button.type='button';button.textContent=item.amount.toLocaleString('ko-KR')+'원';button.title=item.label;button.addEventListener('click',()=>{el('receiptAmount').value=String(item.amount);el('receiptFeedback').textContent='';});el('receiptCandidates').appendChild(button);});
   el('receiptAmount').value=candidates.length?String(candidates[0].amount):'';el('receiptResult').hidden=false;
  }catch(error){
   const messages={CANCELLED:'인식을 취소했어요. 다른 사진으로 다시 시도할 수 있어요.',IMAGE:'사진을 열지 못했어요. 휴대폰에 저장된 JPG·PNG 사진으로 다시 선택해 주세요.',LOCAL:'이 테스트는 배포된 링크에서 열어 주세요.',UNSUPPORTED:'이 브라우저는 인식 기능을 지원하지 않아요. 다른 브라우저에서 열어 주세요.',TIMEOUT:'인식 시간이 길어져 중단했어요. 영수증이 크게 보이도록 다시 찍어 주세요.'};
   el('receiptStatus').textContent=messages[error.code]||'인식 기능을 실행하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  }finally{setBusy(false);controller=null;}
 };
 el('receiptCamera').addEventListener('change',select);el('receiptFile').addEventListener('change',select);
 el('receiptAmount').addEventListener('input',()=>{el('receiptFeedback').textContent='';});
 el('confirmReceipt').addEventListener('click',()=>{
  const value=el('receiptAmount').value.trim(),amount=Number(value);
  el('receiptFeedback').textContent=/^\d+$/.test(value)&&Number.isSafeInteger(amount)&&amount>0&&amount<=1000000000000?'확인한 총액: '+amount.toLocaleString('ko-KR')+'원\n테스트 완료! 실제 계산기에는 반영하지 않았어요.':'총액을 0보다 큰 숫자로 적어 주세요.';
 });
 window.addEventListener('pagehide',()=>{controller?.abort();if(previewURL)URL.revokeObjectURL(previewURL);});
}

if(typeof document!=='undefined') initReceiptTest();
if(typeof module!=='undefined') module.exports={receiptTotalCandidates,receiptPaperQuad,receiptFlatten};
