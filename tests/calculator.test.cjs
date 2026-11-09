const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function calculator(workerFailure = false) {
  const rows = [], workers = [];
  class Worker {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(message) {
      queueMicrotask(() => {
        if (workerFailure) return this.onerror({ preventDefault() {} });
        const data = message.action === 'recognize'
          ? { text: 'sample1/93/남/종촌\nsample2/92/여/도담' } : {};
        this.onmessage({ data: { jobId: message.jobId, status: 'resolve', data } });
      });
    }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({
    document: {}, location: { protocol: 'https:' }, WebAssembly: {}, Worker,
    setTimeout, clearTimeout, rows,
  });
  vm.runInContext(script.replace('buildRounds();loadState();bindEvents();refresh(false);', ''), context);
  vm.runInContext('renderBalance=(...args)=>rows.push(args); captureImageBytes=async()=>new Uint8Array([1]);', context);
  return { api: vm.runInContext('({roundedCost,settleByPerson,readCapture,feeFor:base=>{S.base=String(base);return feeInfo().fee;}})', context), rows, workers };
}

test('the first page has no eager OCR assets and contains static share text', () => {
  assert.ok(Buffer.byteLength(html) < 60000);
  assert.doesNotMatch(html, /ocrWorkerSource|id="ocrApi"|<script[^>]+src=|rel="(?:preload|prefetch)"/);
  assert.match(html, /property="og:description" content="회비 걷기부터/);
  assert.match(html, /:root\{color-scheme:dark;/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
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
