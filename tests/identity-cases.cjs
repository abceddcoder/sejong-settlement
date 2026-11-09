// Loaded by calculator.test.cjs to share its browser-free UI harness.
module.exports = ({ test, assert, calculator, html }) => {
  test('version-one saves migrate names to IDs without changing confirmed money or completed records', () => {
    const { api, storage } = calculator();
    const legacy = JSON.parse(JSON.stringify(api.freshState()));
    Object.assign(legacy, { version: 1, mode: 'prepay', ppl: '2', nicknames: ['sample1', 'sample2'], people: ['sample3'], lastRound: 2, dOn: true, payer: 'sample2' });
    delete legacy.registry; delete legacy.nextPersonId; delete legacy.nicknameIds;
    Object.assign(legacy.rounds[0], { bill: '20000', payment: { names: ['sample1', 'sample2'], amount: 36000 } });
    Object.assign(legacy.rounds[1], { bill: '10000', liquor: '2000', attendees: ['sample1', 'sample3'], noAlcohol: ['sample3'], payment: { names: ['sample1', 'sample3'], amount: 20000 }, settled: true });
    storage.set('meetup-fee-calc.state.v1', JSON.stringify(legacy)); api.loadState(); api.enableRendering();
    const migrated = api.state(), first = migrated.nicknameIds[0];
    assert.equal(migrated.version, 2); assert.notEqual(first, 'sample1');
    assert.equal(migrated.rounds[0].payment.names[0], first);
    assert.equal(migrated.rounds[1].attendees[0], first);
    assert.equal(migrated.rounds[0].payment.amount, 36000);
    assert.equal(api.feeInfo().fee, 36000);
    assert.deepEqual(Array.from(api.roster(2)), ['sample1', 'sample3']);
    assert.deepEqual(Array.from(api.noAlcoholNames(2)), ['sample3']);
    assert.equal(migrated.rounds[1].snapshot.bill, '10000');
    const again = api.normalizeState(JSON.parse(JSON.stringify(migrated)));
    assert.equal(again.nicknameIds[0], first);
    assert.deepEqual(JSON.parse(JSON.stringify(again.rounds[1].snapshot)), JSON.parse(JSON.stringify(migrated.rounds[1].snapshot)));
  });

  test('later confirmed payments stay attached to a renamed first-round participant', () => {
    const { api, elements, rows } = calculator(), state = api.state();
    Object.assign(state, { mode: 'prepay', ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 2 });
    state.rounds[0].bill = '20000'; state.rounds[1].bill = '10000';
    api.enableRendering(); api.bindEvents();
    api.setRoster('collection', 2, ['sample1', 'sample2']);
    state.rounds[1].collectionAmount = '20000'; api.togglePayment(2, true);
    const paidIds = [...state.rounds[1].payment.names];
    const input = elements.nicknames.children[0]; input.value = 'sampleRenamed'; input.events.input();
    api.togglePayment(1, true); rows.length = 0;
    const message = api.calculate(true);
    assert.match(message, /sampleRenamed/); assert.doesNotMatch(message, /sample1/);
    assert.deepEqual(Array.from(state.rounds[1].payment.names), paidIds);
    assert.deepEqual(rows.map(row => row[1]), [35000, 35000]);
  });

  test('completed collection names are frozen even for someone absent from that receipt', () => {
    const { api, elements } = calculator(), state = api.state();
    Object.assign(state, { mode: 'prepay', ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 2 });
    state.rounds[1].bill = '10000'; api.enableRendering(); api.bindEvents();
    api.setRoster('collection', 2, ['sample1', 'sample2']); state.rounds[1].collectionAmount = '10000'; api.togglePayment(2, true);
    api.setRoster('actual', 2, ['sample1']); api.toggleSettled(2, true);
    const input = elements.nicknames.children[1]; input.value = 'sampleRenamed'; input.events.input();
    assert.deepEqual(elements.prepayNames2.children.map(label => label.children[1].textContent), ['sample1', 'sample2']);
    api.loadState(); api.renderCollection(2);
    assert.deepEqual(elements.prepayNames2.children.map(label => label.children[1].textContent), ['sample1', 'sample2']);
  });

  test('a duplicate display name across different rounds never merges distinct identities or generates ambiguous charges', () => {
    const { api, elements } = calculator(), state = api.state();
    Object.assign(state, { ppl: '1', nicknames: ['sample1'], lastRound: 2 });
    state.rounds[0].bill = '10000'; state.rounds[1].bill = '20000'; api.enableRendering(); api.bindEvents();
    api.setRoster('actual', 2, ['sample2']);
    const input = elements.nicknames.children[0]; input.value = 'sample2'; input.events.input();
    assert.notEqual(state.nicknameIds[0], state.rounds[1].attendees[0]);
    assert.equal(api.calculate(true), undefined); assert.match(elements.warn.textContent, /같은 닉네임/);
    input.value = 'sampleRenamed'; input.events.input();
    assert.match(api.calculate(true), /sampleRenamed 10,000원/);
  });
  test('editing a first-round nickname keeps the same identity in later attendance, alcohol and payer selections', () => {
    const { api, elements, rows, storage } = calculator(), state = api.state();
    Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 2, dOn: true });
    Object.assign(state.rounds[0], { bill: '20000', liquor: '10000' });
    Object.assign(state.rounds[1], { bill: '10000', liquor: '0' });
    api.enableRendering(); api.bindEvents();
    api.setRoster('actual', 2, ['sample1']); api.renderRounds();
    const choice = elements.noAlcohol1.children[0].children[0]; choice.checked = true; choice.events.change();
    elements.payer.value = state.nicknameIds?.[0] ?? 'sample1'; elements.payer.events.change();
    const identity = state.nicknameIds?.[0];
    const input = elements.nicknames.children[0]; input.value = 'sampleRenamed'; input.events.input();
    rows.length = 0; const message = api.calculate(true);
    assert.doesNotMatch(message, /sample1/);
    assert.match(message, /sampleRenamed\(노술\)/);
    assert.deepEqual(Array.from(api.roster(2)), ['sampleRenamed']);
    assert.deepEqual(Array.from(api.noAlcoholNames(1)), ['sampleRenamed']);
    assert.ok(identity && identity !== 'sample1');
    assert.equal(state.nicknameIds[0], identity);
    assert.equal(state.payer, identity);
    assert.equal(rows.length, 2);
    api.loadState();
    assert.equal(api.state().nicknameIds[0], identity);
    assert.deepEqual(Array.from(api.roster(2)), ['sampleRenamed']);
    assert.ok(storage.has('meetup-fee-calc.state.v1'));
  });

  test('completed inherited attendance, alcohol choices and receipt stay fixed after edits and reload', () => {
    const { api, elements } = calculator(), state = api.state();
    Object.assign(state, { ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 3, dOn: true });
    state.rounds.forEach(round => Object.assign(round, { bill: '10000', liquor: '2000' }));
    api.enableRendering(); api.bindEvents();
    const choice = elements.noAlcohol2.children[0].children[0]; choice.checked = true; choice.events.change();
    api.toggleSettled(3, true);
    const before = JSON.stringify(state.rounds[2]);
    api.setRoster('actual', 2, ['sample1', 'sample2', 'sample3']);
    const input = elements.nicknames.children[0]; input.value = 'sampleRenamed'; input.events.input();
    elements.dOn.checked = false; elements.dOn.events.change();
    assert.deepEqual(Array.from(api.roster(3)), ['sample1', 'sample2']);
    assert.deepEqual(Array.from(api.noAlcoholNames(3)), ['sample1']);
    assert.equal(JSON.stringify(state.rounds[2]), before);
    assert.equal(elements.b3.value, '10000'); assert.equal(elements.k3.value, '2000');
    assert.equal(elements.noAlcoholBlock3.hidden, false);
    api.loadState();
    assert.deepEqual(Array.from(api.roster(3)), ['sample1', 'sample2']);
    assert.equal(JSON.stringify(api.state().rounds[2]), before);
    api.toggleSettled(3, false);
    assert.deepEqual(Array.from(api.roster(3)), ['sampleRenamed', 'sample2']);
    assert.equal(api.roster(3).includes('sample3'), false);
  });

  test('unconfirmed collection drafts beyond the selected round do not block current settlement', () => {
    const { api, elements } = calculator(), state = api.state();
    Object.assign(state, { mode: 'prepay', ppl: '2', nicknames: ['sample1', 'sample2'] });
    state.rounds[0].bill = '20000';
    api.enableRendering(); api.bindEvents(); api.togglePayment(1, true);
    Object.assign(state.rounds[1], { collectionVisible: true, collectionAmount: '12000', bill: '10000' });
    assert.equal(typeof api.calculate(true), 'string');
    state.lastRound = 2;
    assert.equal(api.calculate(true), undefined);
    assert.match(elements.prepayWarn2.textContent, /입금 확인/);
  });

  test('eleven-digit money pastes are rejected without replacing an existing amount or breaking saved names', () => {
    const { api, elements, storage } = calculator(), state = api.state();
    state.nicknames = ['sample1', 'sample2', 'sample3', 'sample4'];
    api.enableRendering(); api.bindEvents();
    for (const id of ['base', 'b1', 'b2', 'b3', 'b4', 'k1', 'k2', 'k3', 'k4', 'prepayAmount2', 'prepayAmount3', 'prepayAmount4']) {
      elements[id].value = '9,999,999,999'; elements[id].events.input();
      assert.equal(elements[id].value, '9999999999');
      elements[id].value = '1'.repeat(40); elements[id].events.input();
      assert.equal(elements[id].value, '9999999999');
      assert.match(elements[id + 'Limit'].textContent, /10자리/);
    }
    const saved = JSON.parse(storage.get('meetup-fee-calc.state.v1'));
    assert.equal(api.normalizeState(saved).nicknames.length, 4);
    saved.rounds[0].bill = '1'.repeat(40);
    const recovered = api.normalizeState(saved);
    assert.equal(recovered.rounds[0].bill, '');
    assert.deepEqual(Array.from(recovered.nicknames), ['sample1', 'sample2', 'sample3', 'sample4']);
  });

  test('single recipient messages name the person without everyone wording in both modes', () => {
    for (const mode of ['direct', 'prepay']) {
      const { api } = calculator(); Object.assign(api.state(), { mode, ppl: '1', nicknames: ['sample1'] }); api.enableRendering();
      const names = [...api.state().nicknameIds];
      const round = { number: 1, names, bill: 20500, liquor: 0, noAlcohol: [] };
      const message = api.settleByPerson([round], [], '');
      assert.doesNotMatch(message, /1명 모두/);
      assert.match(message, mode === 'direct' ? /sample1 1인 20,500원 보내주세요\./ : /sample1 1인 20,500원 추가 입금해 주세요\./);
      if (mode === 'prepay') assert.match(api.settleByPerson([round], [{ number: 1, names, amount: 21000 }], ''), /sample1 1인 500원 환불해 드릴게요\./);
    }
  });

  test('prepayment uses the exact entered fee without buffer or thousand-won rounding', () => {
    const { api, elements } = calculator(), state = api.state();
    Object.assign(state, { mode: 'prepay', nicknames: ['sample1', 'sample2', 'sample3', 'sample4'] });
    api.enableRendering(); api.bindEvents();
    for (const value of [30000, 1667, 10001]) {
      elements.base.value = String(value); elements.base.events.input();
      assert.equal(api.feeInfo().fee, value);
      assert.equal(elements.tot.textContent, (value * 4).toLocaleString('ko-KR') + '원');
    }
    api.togglePayment(1, true);
    assert.equal(state.rounds[0].payment.amount, 10001);
    assert.doesNotMatch(html, /여유분|20% 포함|1인 예상 비용/);
    assert.match(html, /<label for="base">1인 회비<\/label>/);
  });
};
