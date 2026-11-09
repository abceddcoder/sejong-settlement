const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function calculator(workerFailure = false, recognizedText = 'sample1/93/남/종촌\nsample2/92/여/도담') {
  const rows = [], workers = [];
  const elements = {};
  const element = () => ({ children: [], style: {}, classList: { toggle() {} }, focus() {}, after() {}, setAttribute() {}, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; }, replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); } });
  const modeButtons = ['direct', 'prepay'].map(mode => ({ ...element(), dataset: { mode } }));
  class Worker {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(message) {
      queueMicrotask(() => {
        if (workerFailure) return this.onerror({ preventDefault() {} });
        const data = message.action === 'recognize'
          ? { text: recognizedText } : {};
        this.onmessage({ data: { jobId: message.jobId, status: 'resolve', data } });
      });
    }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({
    document: { getElementById: id => elements[id] ||= element(), querySelectorAll: selector => selector === '#settlementMode button' ? modeButtons : [], createElement: element },
    location: { protocol: 'https:' }, WebAssembly: {}, Worker,
    setTimeout, clearTimeout, rows,
  });
  vm.runInContext(script.replace('buildRounds();loadState();bindEvents();refresh(false);', ''), context);
  vm.runInContext('const renderBalanceUI=renderBalance,renderNicknamesUI=renderNicknames; renderBalance=(...args)=>rows.push(args); captureImageBytes=async()=>new Uint8Array([1]); refresh=()=>clearCaptureReview(); renderNicknames=saveState=()=>{};', context);
  return { api: vm.runInContext('({confirmModeChange,setPayer,renderPayer,payerNames,renderBalanceUI,renderNicknamesUI,roundedCost,settleByPerson,readCapture,captureNicknames,handleCapture,freezePayment,calculate,setMode,renderMode,normalizeState,freshState,togglePayment,toggleSettled,captureLocked,removeCaptureBadges,confirmCaptureReview,clearCaptureReview,pendingReview:()=>captureReview,state:()=>S,target:id=>{captureTarget=id;},feeFor:base=>{S.base=String(base);return feeInfo().fee;}})', context), rows, workers, elements, modeButtons };
}

test('the first page has no eager OCR assets and contains static share text', () => {
  // Keep the calculator small as payer selection is added; OCR remains lazy-loaded.
  assert.ok(Buffer.byteLength(html.replace(/\r\n/g, '\n')) < 70000);
  assert.doesNotMatch(html, /ocrWorkerSource|id="ocrApi"|<script[^>]+src=|rel="(?:preload|prefetch)"/);
  assert.match(html, /property="og:description" content="회비 걷기부터/);
  assert.match(html, /:root\{color-scheme:dark;/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
  assert.match(html, /data-mode="direct" class="on" aria-pressed="true"/);
  assert.ok(html.indexOf('data-mode="direct"') < html.indexOf('data-mode="prepay"'));
  assert.equal(calculator().api.freshState().mode, 'direct');
  assert.equal(calculator().api.freshState().nicknamesOpen, true);
  assert.equal(calculator().workers.length, 0);
});

test('100,401 won split among four never leaves the organizer short', () => {
  const { api, rows } = calculator();
  api.settleByPerson([{ number: 1, names: ['sample1', 'sample2', 'sample3', 'sample4'], bill: 100401, liquor: 0, noAlcohol: [] }], [], '');
  assert.deepEqual(rows.map(row => -row[1]), [25200, 25200, 25200, 25200]);
});

test('the 20 percent buffer is rounded up without first discarding fractions', () => {
  const { api } = calculator();
  assert.equal(api.feeFor(30000), 36000);
  assert.equal(api.feeFor(5000), 6000);
  assert.equal(api.feeFor(1667), 3000);
});

test('the existing 100-won ceiling remains unchanged for 100,100 won', () => {
  const { api, rows } = calculator();
  api.settleByPerson([{ number: 1, names: ['sample1', 'sample2', 'sample3', 'sample4'], bill: 100100, liquor: 0, noAlcohol: [] }], [], '');
  assert.equal(rows.reduce((sum, row) => sum - row[1], 0), 100400);
});

test('fractions on and just above a 100-won boundary are exact', () => {
  const { api } = calculator();
  assert.equal(api.roundedCost([]), 0);
  assert.equal(api.roundedCost([{ numerator: 100n, denominator: 3n }, { numerator: 200n, denominator: 3n }]), 100);
  assert.equal(api.roundedCost([{ numerator: 30000000001n, denominator: 300000000n }]), 200);
});

test('alcohol exclusions and collected payments still produce one net balance', () => {
  const { api, rows } = calculator();
  const names = ['sample1', 'sample2', 'sample3', 'sample4'];
  api.settleByPerson([
    { number: 1, names, bill: 100000, liquor: 20000, noAlcohol: ['sample3', 'sample4'] },
    { number: 2, names: ['sample1', 'sample3'], bill: 10001, liquor: 0, noAlcohol: [] },
  ], [{ number: 1, names, amount: 36000 }], '');
  assert.deepEqual(rows.map(row => row[1]), [900, 6000, 10900, 16000]);
});

test('OCR loads only when used, uses the same-site worker, and terminates', async () => {
  const { api, workers } = calculator();
  const names = await api.readCapture({});
  assert.deepEqual(Array.from(names), ['sample1', 'sample2']);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].url, './assets/ocr-worker-v1.js');
  assert.equal(workers[0].terminated, true);
});

test('an unavailable OCR download reports failure and allows a retry', async () => {
  const { api, workers } = calculator(true);
  await assert.rejects(api.readCapture({}), error => error.code === 'OCR-LOAD');
  await assert.rejects(api.readCapture({}), error => error.code === 'OCR-LOAD');
  assert.equal(workers.length, 2);
  assert.ok(workers.every(worker => worker.terminated));
});

test('self badges are removed without changing nicknames beginning with na', () => {
  const { api } = calculator();
  for (const badge of ['© ', '[나] ', '(나) ', '【나】 ', '나 ', '● ']) {
    assert.deepEqual(Array.from(api.captureNicknames(badge + 'sample1/93/남/종촌')), ['sample1']);
  }
  const syntheticNickname = '나' + 'sample1';
  assert.deepEqual(Array.from(api.captureNicknames(syntheticNickname + '/00/여/예시')), [syntheticNickname]);
});

test('a damaged gender field does not omit an attendee with a profile description', () => {
  const { api } = calculator();
  const text = '[나] sample1/93/2/종촌\n\n30대 중반 남성\nsample2/92/여도담\n30대 중반 여성\n탈퇴 사용자\n본인인증 완료';
  assert.deepEqual(Array.from(api.captureNicknames(text)), ['sample1', 'sample2']);
  assert.deepEqual(Array.from(api.captureNicknames('모임/2026/11/09\n참여 중 17\n탈퇴 사용자\n본인인증 완료')), []);
});

test('a later capture selects matching and new attendees without changing earlier payments', async () => {
  const { api } = calculator(false, '[나] sample1/93/2/종촌\n30대 중반 남성\nsample2/92/여도담\n30대 중반 여성\nsample5/95/남/고운\n30대 초반 남성');
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.rounds[0].payment = api.freezePayment(state.nicknames, 36000);
  state.rounds[1].collectionNames = [...state.nicknames];
  api.target('prepayNames2');
  await api.handleCapture({ target: { files: [{ size: 100 }], value: 'capture' } });
  assert.deepEqual(Array.from(state.rounds[1].collectionNames), ['sample1', 'sample2', 'sample3', 'sample4']);
  api.confirmCaptureReview();
  assert.deepEqual(Array.from(state.rounds[1].collectionNames), ['sample1', 'sample2', 'sample5']);
  assert.deepEqual(Array.from(state.rounds[1].attendees), ['sample1', 'sample2', 'sample5']);
  assert.deepEqual(Array.from(state.rounds[0].payment.names), ['sample1', 'sample2', 'sample3', 'sample4']);
});

test('a skipped profile prevents partial OCR from overwriting an existing roster', async () => {
  const { api, elements, workers } = calculator(false, '읽기 실패\n30대 중반 남성\nsample2/92/여/도담\n30대 중반 여성');
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.rounds[1].collectionNames = [...state.nicknames];
  const before = JSON.stringify(state);
  api.target('prepayNames2');
  await api.handleCapture({ target: { files: [{ size: 100 }], value: 'capture' } });
  assert.equal(JSON.stringify(state), before);
  assert.match(elements.prepayNames2CaptureStatus.textContent, /기존 명단은 바꾸지 않았어요/);
  assert.ok(workers[0].terminated);
});

test('multiple images are rejected without reading or replacing any roster', async () => {
  const { api, elements, workers } = calculator();
  const before = JSON.stringify(api.state());
  for (const target of ['nicknames', 'prepayNames2', 'names3']) {
    api.target(target);
    const input = { files: [{ size: 100 }, { size: 100 }], value: 'captures' };
    await api.handleCapture({ target: input });
    assert.equal(input.value, '');
    assert.match(elements[target === 'nicknames' ? 'captureStatus' : target + 'CaptureStatus'].textContent, /한 장씩/);
  }
  assert.equal(JSON.stringify(api.state()), before);
  assert.equal(workers.length, 0);
  assert.doesNotMatch(html.match(/<input[^>]+id="captureFile"[^>]*>/)[0], /\bmultiple\b/);
});

test('direct settlement needs no estimate, buffer, or payment confirmation', () => {
  const { api, rows } = calculator();
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.base = '';
  state.rounds[0].bill = '100000';
  state.rounds[1].collectionVisible = true;
  state.rounds[1].collectionAmount = '25000';
  api.setMode('direct');
  const message = api.calculate(true);
  assert.deepEqual(rows.map(row => row[1]), [-25000, -25000, -25000, -25000]);
  assert.ok(rows.every(row => row[2].includes('1차 25,000원')));
  assert.match(message, /1차 4명 · 계산서 100,000원/);
  assert.doesNotMatch(message, /받은 회비|낸 회비|환불|추가 입금/);
  assert.match(message, /4명 모두 1인 25,000원씩 보내주세요\.$/);
});

test('direct settlement still handles alcohol exclusions and later arrivals', () => {
  const { api, rows } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'], base: '', dOn: true, lastRound: 2 });
  Object.assign(state.rounds[0], { bill: '100000', liquor: '20000', noAlcohol: ['sample2'] });
  Object.assign(state.rounds[1], { bill: '20000', attendees: ['sample1', 'sample3'] });
  api.setMode('direct');
  const message = api.calculate(true);
  assert.deepEqual(rows.map(row => row[1]), [-70000, -40000, -10000]);
  assert.match(rows[1][2], /1차 40,000원 \(노술\)/);
  assert.match(message, /2차 2명 · 계산서 20,000원/);
});

test('prepayment mode still requires confirmation and subtracts collected money', () => {
  const { api, rows } = calculator();
  api.setMode('prepay');
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.rounds[0].bill = '100000';
  assert.equal(api.calculate(), undefined);
  assert.equal(rows.length, 0);
  state.rounds[0].payment = api.freezePayment(state.nicknames, 36000);
  assert.match(api.calculate(), /받은 회비 144,000원/);
  assert.deepEqual(rows.map(row => row[1]), [11000, 11000, 11000, 11000]);
});

test('direct mode keeps nickname and receipt validation', () => {
  const { api, elements } = calculator();
  const state = api.state();
  api.setMode('direct');
  state.nicknames = ['sample1', '', '', ''];
  state.rounds[0].bill = '100000';
  assert.equal(api.calculate(true), undefined);
  assert.match(elements.feeWarn.textContent, /닉네임을 중복 없이 모두/);
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.rounds[0].bill = '';
  assert.equal(api.calculate(true), undefined);
  assert.match(elements.warn.textContent, /계산서 금액/);
});

test('switching modes preserves input but cannot discard confirmed payments', () => {
  const { api } = calculator();
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.rounds[0].bill = '100000';
  api.setMode('direct');
  api.togglePayment(1, true);
  assert.equal(state.rounds[0].payment, null);
  api.setMode('prepay');
  assert.equal(state.rounds[0].bill, '100000');
  assert.equal(state.nicknames.length, 4);
  state.rounds[0].payment = api.freezePayment(state.nicknames, 36000);
  api.setMode('direct');
  assert.equal(state.mode, 'prepay');
  assert.equal(state.rounds[0].payment.amount, 36000);
});

test('saved mode is restored while older saves remain in prepayment mode', () => {
  const { api } = calculator();
  const legacy = JSON.parse(JSON.stringify(api.freshState()));
  delete legacy.mode;
  assert.equal(api.normalizeState(legacy).mode, 'prepay');
  legacy.mode = 'direct';
  assert.equal(api.normalizeState(legacy).mode, 'direct');
  legacy.rounds[1].payment = { names: ['sample1'], amount: 25000 };
  assert.equal(api.normalizeState(legacy).mode, 'prepay');
});

test('direct mode hides the collection controls and clearly labels the required inputs', () => {
  const { api, elements } = calculator();
  api.setMode('direct');
  api.renderMode();
  for (const id of ['estimateRow', 'feeEstimate', 'firstPaymentControls', 'prepayFields', 'addPrepay']) {
    assert.equal(elements[id].hidden, true);
  }
  assert.equal(elements.collectionTitle.textContent, '1. 1차 참석자 입력');
  api.setMode('prepay');
  api.renderMode();
  assert.equal(elements.estimateRow.hidden, false);
  assert.equal(elements.firstPaymentControls.hidden, false);
});

test('self-badge preprocessing preserves nearby nickname strokes and non-circular marks', () => {
  const { api } = calculator();
  const width = 400, height = 160, pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x, y, color) => pixels.set([...color, 255], (y * width + x) * 4);
  for (let y = 20; y < 60; y++) for (let x = 10; x < 50; x++) {
    if ((x - 30) ** 2 + (y - 40) ** 2 <= 15 ** 2) set(x, y, [86, 94, 111]);
  }
  set(55, 40, [30, 30, 30]);
  for (let x = 10; x < 70; x++) for (let y = 90; y < 94; y++) set(x, y, [86, 94, 111]);
  assert.equal(api.removeCaptureBadges(pixels, width, height), 1);
  assert.equal(pixels[(40 * width + 30) * 4], 255);
  assert.equal(pixels[(40 * width + 55) * 4], 30);
  assert.equal(pixels[(90 * width + 30) * 4], 86);
});

test('an OCR typo cannot create a new attendee or uncheck an existing one before review', async () => {
  const { api, elements } = calculator(false, 'sampleI/93/남/종촌\nsample2/92/여/도담');
  const state = api.state();
  state.ppl = '2'; state.nicknames = ['sample1', 'sample2'];
  const before = JSON.stringify(state);
  api.target('names2');
  await api.handleCapture({ target: { files: [{ size: 100 }], value: 'capture' } });
  assert.equal(JSON.stringify(state), before);
  assert.match(elements.captureReviewChanges.textContent, /새 이름: sampleI/);
  assert.match(elements.captureReviewChanges.textContent, /빠질 사람: sample1/);
  api.pendingReview().names[0] = 'sample1';
  api.confirmCaptureReview();
  assert.deepEqual(Array.from(state.rounds[1].attendees), ['sample1', 'sample2']);
  assert.ok(!state.people.includes('sampleI'));
});

test('invalid or cancelled capture review never changes the saved roster', async () => {
  const { api, elements } = calculator(false, 'sample1/93/남/종촌\nsample3/92/여/도담');
  const state = api.state(); state.ppl = '2'; state.nicknames = ['sample1', 'sample2'];
  const before = JSON.stringify(state);
  api.target('names2');
  await api.handleCapture({ target: { files: [{ size: 100 }], value: 'capture' } });
  api.pendingReview().names[1] = 'sample1';
  api.confirmCaptureReview();
  assert.equal(elements.captureReviewError.hidden, false);
  assert.equal(JSON.stringify(state), before);
  api.clearCaptureReview();
  api.confirmCaptureReview();
  assert.equal(JSON.stringify(state), before);
});

test('all combinations of completed rounds exclude only those rounds and their payments', () => {
  for (const mode of ['direct', 'prepay']) for (let mask = 0; mask < 16; mask++) {
    const { api, rows, elements } = calculator();
    const state = api.state();
    Object.assign(state, { mode, ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 4 });
    let expectedCost = 0, expectedPaid = 0;
    for (let i = 0; i < 4; i++) {
      const r = state.rounds[i]; r.bill = String((i + 1) * 20000);
      if (mode === 'prepay') r.payment = api.freezePayment(state.nicknames, (i + 1) * 12000);
      api.toggleSettled(i + 1, Boolean(mask & (1 << i)));
      if (!r.settled) { expectedCost += (i + 1) * 10000; expectedPaid += mode === 'prepay' ? (i + 1) * 12000 : 0; }
    }
    const message = api.calculate(true);
    if (mask === 15) {
      assert.equal(message, undefined);
      assert.match(elements.warn.textContent, /모두 정산 완료/);
    } else {
      assert.deepEqual(rows.map(row => row[1]), [expectedPaid - expectedCost, expectedPaid - expectedCost]);
      for (let n = 1; n <= 4; n++) assert.equal(message.includes(n + '차 2명'), !(mask & (1 << (n - 1))));
    }
    const restored = api.normalizeState(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(Array.from(restored.rounds, r => r.settled), Array.from(state.rounds, r => r.settled));
  }
});

test('completion is reversible, requires a valid receipt, and protects completed rosters', () => {
  const { api, elements, rows } = calculator();
  const state = api.state(); state.ppl = '2'; state.nicknames = ['sample1', 'sample2'];
  api.toggleSettled(1, true);
  assert.equal(state.rounds[0].settled, false);
  assert.match(elements.warn.textContent, /계산서 금액/);
  state.rounds[0].bill = '20000';
  api.toggleSettled(1, true);
  assert.equal(api.captureLocked('nicknames'), true);
  api.toggleSettled(1, false);
  assert.equal(api.captureLocked('nicknames'), false);
  api.calculate();
  assert.deepEqual(rows.map(row => row[1]), [-10000, -10000]);
});

test('equal final deposits collapse to one chat line while individual screen results remain', () => {
  const { api, rows } = calculator();
  api.setMode('prepay');
  const names = Array.from({ length: 10 }, (_, i) => 'sample' + (i + 1));
  const message = api.settleByPerson([{ number: 1, names, bill: 55000, liquor: 0, noAlcohol: [] }], [], 'sample계좌');
  assert.equal(message.split('\n').filter(line => line.includes('모두')).join('\n'), '10명 모두 1인 5,500원씩 추가 입금해 주세요.');
  assert.doesNotMatch(message, /· sample\d+/);
  assert.match(message, /sample계좌로 지금 보내주세요/);
  assert.equal(rows.length, 10);
  assert.ok(rows.every(row => row[1] === -5500));
});

test('equal refunds use final balances even when costs and prepaid amounts differ', () => {
  const { api, rows } = calculator();
  api.setMode('prepay');
  const names = ['sample1', 'sample2'];
  const message = api.settleByPerson([
    { number: 1, names, bill: 10000, liquor: 0, noAlcohol: [] },
    { number: 2, names: ['sample2'], bill: 2000, liquor: 0, noAlcohol: [] },
  ], [{ number: 1, names, amount: 6000 }, { number: 2, names: ['sample2'], amount: 2000 }], '');
  assert.deepEqual(rows.map(row => row[1]), [1000, 1000]);
  assert.match(message, /\n2명 모두 1인 1,000원씩 환불해 드릴게요\.\n/);
  assert.doesNotMatch(message, /· sample\d+|추가 입금|지금 보내주세요/);
  assert.match(message, /계좌 남겨주세요/);
});

test('zero balances collapse without a deposit or refund request', () => {
  const { api } = calculator();
  api.setMode('prepay');
  const names = ['sample1', 'sample2'];
  const message = api.settleByPerson([{ number: 1, names, bill: 10000, liquor: 0, noAlcohol: [] }], [{ number: 1, names, amount: 5000 }], '');
  assert.match(message, /\n2명 모두 정산 없음\.$/);
  assert.doesNotMatch(message, /· sample\d+|추가 입금|환불|지금 보내주세요|계좌 남겨주세요/);
});

test('different final balances keep each name and do not merge opposite payment directions', () => {
  const { api, rows, elements } = calculator();
  api.setMode('prepay');
  const names = ['sample1', 'sample2', 'sample3'];
  const message = api.settleByPerson([
    { number: 1, names, bill: 15000, liquor: 0, noAlcohol: [] },
    { number: 2, names: ['sample2'], bill: 1000, liquor: 0, noAlcohol: [] },
  ], [{ number: 1, names, amount: 5000 }, { number: 2, names: ['sample1'], amount: 1000 }], '');
  assert.deepEqual(message.split('\n').filter(line => line.startsWith('· ')), [
    '· sample1 환불 1,000원', '· sample2 추가 입금 1,000원', '· sample3 정산 없음',
  ]);
  assert.doesNotMatch(message, /명 모두/);
  for (const row of rows) api.renderBalanceUI(...row);
  assert.deepEqual(elements.res.children.map(row => row.children[1].textContent), ['환불 1,000원', '추가 입금 1,000원', '정산 없음']);
  assert.equal(elements.res.children[0].children[1].style.color, 'var(--ok)');
  assert.equal(elements.res.children[1].children[1].style.color, 'var(--bad)');
  assert.match(elements.res.children[0].children[0].children[0].textContent, /1차 5,000원/);
});

test('equal costs with different payments still produce individual final messages', () => {
  const { api } = calculator();
  api.setMode('prepay');
  const names = ['sample1', 'sample2'];
  const message = api.settleByPerson([{ number: 1, names, bill: 10000, liquor: 0, noAlcohol: [] }], [{ number: 1, names: ['sample1'], amount: 5000 }], '');
  assert.deepEqual(message.split('\n').filter(line => line.startsWith('· ')), ['· sample1 정산 없음', '· sample2 추가 입금 5,000원']);
  assert.doesNotMatch(message, /명 모두/);
});

test('nickname guidance hides only for complete valid names and returns when incomplete', () => {
  const { api, elements } = calculator();
  const state = api.state();
  state.ppl = '2'; state.nicknames = ['sample1', ''];
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, false);
  assert.match(elements.nicknameHint.textContent, /참석자 2명의 닉네임/);
  state.nicknames[1] = ' sample2 ';
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, true);
  assert.ok(elements.nicknames.children.every(input => input.required === true));
  state.nicknames[1] = '   ';
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, false);
  state.nicknames[1] = 'sample1';
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, false);
  state.rounds[0].bill = '10000';
  assert.equal(api.calculate(true), undefined);
  assert.match(elements.feeWarn.textContent, /중복 없이 모두/);
  state.nicknames[1] = 'sample2'; state.ppl = '3';
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, false);
  assert.match(elements.nicknameHint.textContent, /참석자 3명의 닉네임/);
  state.ppl = '2';
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, true);
});

test('confirmed nickname lists hide the hint while keeping the fields locked and required', () => {
  const { api, elements } = calculator();
  api.state().ppl = '2';
  api.state().rounds[0].payment = api.freezePayment(['sample1', 'sample2'], 6000);
  api.renderNicknamesUI();
  assert.equal(elements.nicknameHint.hidden, true);
  assert.ok(elements.nicknames.children.every(input => input.disabled && input.required));
});

test('direct settlement lists unequal amounts without prepayment wording on screen or in chat', () => {
  const { api, rows, elements } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 2, account: 'sample계좌' });
  state.rounds[0].bill = '10000';
  Object.assign(state.rounds[1], { bill: '3000', attendees: ['sample1'] });
  const message = api.calculate();
  assert.deepEqual(message.split('\n').filter(line => line.startsWith('· ')), ['· sample1 8,000원', '· sample2 5,000원']);
  assert.match(message, /입금 계좌: sample계좌/);
  assert.match(message, /위 금액을 보내주세요\.$/);
  assert.doesNotMatch(message, /추가 입금|환불|돌려|명 모두/);
  for (const row of rows) api.renderBalanceUI(...row);
  assert.deepEqual(elements.res.children.map(row => row.children[1].textContent), ['8,000원', '5,000원']);
});

test('a selected payer keeps their share but is excluded from the senders and grouped amount', () => {
  const { api, rows, elements } = calculator();
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4']; state.rounds[0].bill = '22000';
  api.setPayer('sample1');
  const message = api.calculate();
  assert.deepEqual(rows.map(row => row[1]), [0, -5500, -5500, -5500]);
  assert.match(rows[0][0], /부담액 5,500원/);
  assert.equal(rows[0][3], true);
  assert.match(message, /· sample1 5,500원 \(결제함\)\n3명 모두 1인 5,500원씩 보내주세요\.$/);
  assert.doesNotMatch(message, /4명 모두|추가 입금|환불/);
  for (const row of rows) api.renderBalanceUI(...row);
  assert.deepEqual(elements.res.children.map(row => row.children[1].textContent), ['5,500원 (결제함)', '5,500원', '5,500원', '5,500원']);
  api.setPayer(''); rows.length = 0;
  assert.match(api.calculate(), /4명 모두 1인 5,500원씩 보내주세요\.$/);
  assert.ok(rows.every(row => row[1] === -5500 && row[3] === false));
});

test('unequal direct senders keep payer marking alongside individual amounts', () => {
  const { api } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '3', nicknames: ['sample1', 'sample2', 'sample3'], lastRound: 2 });
  state.rounds[0].bill = '15000';
  Object.assign(state.rounds[1], { bill: '2000', attendees: ['sample2'] });
  api.setPayer('sample1');
  const message = api.calculate();
  assert.deepEqual(message.split('\n').filter(line => line.startsWith('· ')), ['· sample1 5,000원 (결제함)', '· sample2 7,000원', '· sample3 5,000원']);
  assert.match(message, /위 금액을 보내주세요\.$/);
});

test('payer selection includes active later arrivals and clears when their round is completed', () => {
  const { api, elements } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 2 });
  state.rounds[0].bill = '10000';
  Object.assign(state.rounds[1], { bill: '20000', attendees: ['sample2', 'sample3'] });
  api.renderPayer();
  assert.deepEqual(elements.payer.children.map(option => option.value), ['', 'sample1', 'sample2', 'sample3']);
  api.setPayer('sample3'); api.renderPayer();
  assert.equal(elements.payer.value, 'sample3');
  assert.match(api.calculate(), /· sample3 10,000원 \(결제함\)/);
  api.toggleSettled(2, true); api.renderPayer();
  assert.equal(state.payer, '');
  assert.deepEqual(elements.payer.children.map(option => option.value), ['', 'sample1', 'sample2']);
  assert.doesNotMatch(api.calculate(), /결제함|sample3/);
});

test('renaming or removing a payer resets selection and unknown names cannot exclude a charge', () => {
  const { api, rows, elements } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'] }); state.rounds[0].bill = '10000';
  api.setPayer('sample1'); state.nicknames[0] = 'sample3'; api.renderPayer();
  assert.equal(state.payer, '');
  assert.equal(elements.payer.value, '');
  api.setPayer('sample99');
  assert.equal(state.payer, '');
  api.calculate();
  assert.deepEqual(rows.map(row => row[1]), [-5000, -5000]);
  api.setPayer('sample2'); state.ppl = '1'; api.renderPayer();
  assert.equal(state.payer, '');
});

test('prepayment shows payer cost and groups refunds for everyone else without changing their shares', () => {
  const { api, rows, elements } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'] }); state.rounds[0].bill = '10000';
  api.setMode('prepay'); api.setPayer('sample1'); api.renderPayer();
  assert.equal(elements.payerField.hidden, false);
  state.rounds[0].payment = api.freezePayment(state.nicknames, 6000);
  const message = api.calculate();
  assert.match(message, /· sample1 5,000원 \(결제함\)\n1명 모두 1인 1,000원씩 환불해 드릴게요\./);
  assert.deepEqual(rows.map(row => row[1]), [0, 1000]);
  for (const row of rows) api.renderBalanceUI(...row);
  assert.deepEqual(elements.res.children.map(row => row.children[1].textContent), ['5,000원 (결제함)', '환불 1,000원']);
  api.setPayer('sample2'); assert.equal(state.payer, 'sample2');
  assert.equal(api.normalizeState(JSON.parse(JSON.stringify(state))).payer, 'sample2');
  api.setPayer(''); rows.length = 0;
  assert.match(api.calculate(), /2명 모두 1인 1,000원씩 환불해 드릴게요\./);
  assert.deepEqual(rows.map(row => row[1]), [1000, 1000]);
});

test('payer selection survives save restoration, defaults empty for older saves and resets for new meetings', () => {
  const { api } = calculator();
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4']; api.setPayer('sample1');
  const saved = JSON.parse(JSON.stringify(state));
  assert.equal(api.normalizeState(saved).payer, 'sample1');
  delete saved.payer;
  assert.equal(api.normalizeState(saved).payer, '');
  assert.equal(api.freshState().payer, '');
  saved.payer = { name: 'sample1' };
  assert.throws(() => api.normalizeState(saved));
});

test('a solo payer or a zero bill never gets an instruction to send money', () => {
  const { api, rows } = calculator();
  const state = api.state();
  Object.assign(state, { ppl: '1', nicknames: ['sample1'] }); state.rounds[0].bill = '10000';
  api.setPayer('sample1');
  const message = api.calculate();
  assert.match(message, /· sample1 10,000원 \(결제함\)$/);
  assert.doesNotMatch(message, /보내주세요|추가 입금|환불/);
  assert.equal(rows[0][1], 0);
  api.setPayer(''); state.rounds[0].bill = '0';
  assert.match(api.calculate(), /1명 모두 1인 0원이에요\.$/);
});

test('prepayment groups additional deposits separately from the payer and keeps payment records', () => {
  const { api, rows } = calculator();
  const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  state.rounds[0].bill = '22000'; api.setMode('prepay');
  state.rounds[0].payment = api.freezePayment(state.nicknames, 4000);
  const savedPayment = JSON.stringify(state.rounds[0].payment);
  api.setPayer('sample1');
  const message = api.calculate();
  assert.match(message, /· sample1 5,500원 \(결제함\)\n3명 모두 1인 1,500원씩 추가 입금해 주세요\./);
  assert.deepEqual(rows.map(row => row[1]), [0, -1500, -1500, -1500]);
  assert.match(rows[0][2], /낸 회비 4,000원/);
  assert.equal(JSON.stringify(state.rounds[0].payment), savedPayment);
});

test('prepayment mixed balances show each name and payer cost on screen and in chat', () => {
  const { api, rows, elements } = calculator();
  api.setMode('prepay'); api.state().payer = 'sample1';
  const names = ['sample1', 'sample2', 'sample3', 'sample4'];
  const message = api.settleByPerson([{ number: 1, names, bill: 20000, liquor: 0, noAlcohol: [] }], [
    { number: 1, names: ['sample1', 'sample2'], amount: 6000 },
    { number: 1, names: ['sample3'], amount: 4000 },
    { number: 1, names: ['sample4'], amount: 5000 },
  ], '');
  const results = ['5,000원 (결제함)', '환불 1,000원', '추가 입금 1,000원', '정산 없음'];
  assert.deepEqual(message.split('\n').filter(line => line.startsWith('· ')), results.map((text, i) => '· '+names[i]+' '+text));
  for (const row of rows) api.renderBalanceUI(...row);
  assert.deepEqual(elements.res.children.map(row => row.children[1].textContent), results);
});

test('a solo prepaid payer has no self-transfer or empty-group instructions', () => {
  const { api } = calculator(); const state = api.state();
  Object.assign(state, { ppl: '1', nicknames: ['sample1'] });
  api.setMode('prepay'); state.rounds[0].bill = '10000';
  state.rounds[0].payment = api.freezePayment(state.nicknames, 12000);
  api.setPayer('sample1');
  assert.match(api.calculate(), /· sample1 10,000원 \(결제함\)$/);
  assert.doesNotMatch(api.calculate(), /0명|추가 입금|환불|계좌 남겨|보내주세요/);
});

test('clicking the direct tab with confirmed payments opens a cancellable page dialog without changing state', () => {
  const { api, elements, modeButtons } = calculator(); const state = api.state();
  state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
  api.setMode('prepay'); state.rounds[0].payment = api.freezePayment(state.nicknames, 36000);
  const before = JSON.stringify(state);
  api.renderMode();
  assert.ok(modeButtons.every(button => !button.disabled));
  api.setMode('direct');
  assert.equal(elements.modeChangeConfirm.open, true);
  assert.equal(JSON.stringify(state), before);
  elements.modeChangeConfirm.close(); // Cancel button and Escape close the native dialog.
  api.confirmModeChange();
  assert.equal(JSON.stringify(state), before);
  assert.match(html, /입금 확인을 해제하고 바로 정산으로 바꿀까요\? 닉네임과 계산서 금액은 그대로 남아요\./);
  assert.match(html, /<form method="dialog" class="mode-confirm-actions"><button value="cancel" autofocus>취소<\/button>/);
});

test('confirming a mode change clears only all payment confirmations and preserves all entered fields', () => {
  const { api, elements } = calculator(); const state = api.state();
  Object.assign(state, { mode: 'prepay', ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 4, dOn: true, account: 'sample계좌', payer: 'sample2' });
  state.rounds.forEach((round, i) => Object.assign(round, {
    bill: String(10000 + i * 1000), liquor: '2000', settled: i === 0,
    attendees: i === 0 ? null : ['sample2', 'sample3'], noAlcohol: ['sample2'],
    collectionNames: ['sample1', 'sample2'], collectionAmount: '6000',
    payment: api.freezePayment(['sample1', 'sample2'], 6000), collectionVisible: true,
  }));
  const expected = JSON.parse(JSON.stringify(state));
  expected.mode = 'direct'; expected.rounds.forEach(round => { round.payment = null; });
  api.setMode('direct'); api.confirmModeChange();
  assert.equal(elements.modeChangeConfirm.open, false);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), expected);
  assert.equal(api.normalizeState(JSON.parse(JSON.stringify(state))).mode, 'direct');
  api.setMode('prepay');
  assert.ok(state.rounds.every(round => round.payment === null));
  assert.equal(state.rounds[0].settled, true);
  assert.equal(state.rounds[3].collectionAmount, '6000');
});

test('confirmed mode changes preserve displayed snapshot names and stop subtracting prepayments', () => {
  const { api, rows } = calculator(); const state = api.state();
  Object.assign(state, { mode: 'prepay', ppl: '2', nicknames: ['sample1', 'sample2'] });
  state.rounds[0].bill = '10000'; state.rounds[0].payment = api.freezePayment(state.nicknames, 6000);
  assert.match(api.calculate(), /2명 모두 1인 1,000원씩 환불해 드릴게요\./);
  // The UI shows confirmed snapshot names even if older draft names differ.
  state.nicknames = ['sample3', 'sample4'];
  api.setMode('direct'); api.confirmModeChange(); rows.length = 0;
  assert.deepEqual(Array.from(state.nicknames), ['sample1', 'sample2']);
  assert.match(api.calculate(), /2명 모두 1인 5,000원씩 보내주세요\.$/);
  assert.deepEqual(rows.map(row => row[1]), [-5000, -5000]);
  api.setMode('prepay');
  assert.equal(api.calculate(true), undefined);
});
