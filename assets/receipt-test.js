'use strict';

function receiptTotalCandidates(text) {
 const rows=String(text).normalize('NFKC').split(/\r?\n/).map(row=>row.trim()).filter(Boolean), found=[];
 const labels=[[/결제금액|받을금액|받으실금액|청구금액|실결제금액|AMOUNTDUE/i,30],[/총합계|합계금액|총금액|총액|GRANDTOTAL/i,20],[/합계|TOTAL/i,10]];
 const money=/\d{1,3}(?:[, .]\d{3})+|\d+/g;
 for(let i=0;i<rows.length;i++){
  const compact=rows[i].replace(/\s/g,'');
  if(/소계|중간합계|SUBTOTAL|할인|공급|과세|면세|부가세|세액|거스름|잔돈|승인|취소|환불|번호/i.test(compact)) continue;
  const label=labels.find(([pattern])=>pattern.test(compact));
  if(!label) continue;
  let source=rows[i], tokens=source.match(money);
  if(!tokens?.length&&rows[i+1]&&/^[\s:₩￦Ww\d,.원]+$/.test(rows[i+1])){source+=' '+rows[i+1];tokens=rows[i+1].match(money);}
  if(!tokens?.length) continue;
  const amount=Number(tokens[tokens.length-1].replace(/[, .]/g,''));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000000000) continue;
  found.push({amount,label:source,score:label[1]});
 }
 found.sort((a,b)=>b.score-a.score);
 return found.filter((item,index)=>found.findIndex(other=>other.amount===item.amount)===index).slice(0,6);
}

function receiptError(code){const error=new Error(code);error.code=code;return error;}

async function receiptImageBytes(file,signal){
 const url=URL.createObjectURL(file);let canvas;
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
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(receiptError('IMAGE')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
 }finally{URL.revokeObjectURL(url);if(canvas){canvas.width=1;canvas.height=1;}}
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
   el('receiptStatus').textContent='사진을 읽었어요. 아래 금액을 확인해 주세요.';
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
if(typeof module!=='undefined') module.exports={receiptTotalCandidates};
