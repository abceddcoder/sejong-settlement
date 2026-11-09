module.exports = ({ test, assert, calculator, html }) => {
  function setup(mode = 'direct') {
    const app = calculator(), state = app.api.state();
    Object.assign(state, { mode, ppl: '2', nicknames: ['sample1', 'sample2'], lastRound: 2 });
    state.rounds[0].bill = state.rounds[1].bill = '30000';
    app.api.enableRendering(); app.api.bindEvents();
    return app;
  }
  function input(app, id, value) { app.elements[id].value = value; app.elements[id].events.input(); }

  test('adding a later participant to a new first-round slot reuses their ID and survives reload', () => {
    const app = setup(), { api, elements, rows } = app, state = api.state();
    api.setRoster('actual', 2, ['sample1', 'sample2', 'sample3']);
    const laterId = state.rounds[1].attendees[2];
    input(app, 'ppl', '3');
    const field = elements.nicknames.children[2]; field.value = 'sample3'; field.events.input();
    elements.calculate.events.click();
    assert.equal(state.nicknameIds[2], laterId);
    assert.equal(elements.names2.children.length, 3);
    assert.equal(elements.payer.children.length, 4);
    rows.length = 0;
    assert.match(api.calculate(true), /3명 모두 1인 20,000원씩 보내주세요/);
    assert.equal(rows.length, 3);
    api.loadState(); api.renderPayer();
    assert.equal(api.state().nicknameIds[2], laterId);
    assert.equal(new Set(api.state().rounds[1].attendees).size, 3);
  });

  test('linking an existing later name preserves completed records and reconnects them when reopened', () => {
    const app = setup(), { api, elements } = app, state = api.state();
    api.setRoster('actual', 2, ['sample1', 'sample2']);
    state.lastRound = 3; state.rounds[2].bill = '30000';
    api.setRoster('actual', 3, ['sample3']); api.toggleSettled(2, true);
    const snapshot = JSON.stringify(state.rounds[1]), target = state.rounds[2].attendees[0];
    const field = elements.nicknames.children[0]; field.value = 'sample3'; field.events.input(); field.events.change();
    assert.equal(state.nicknameIds[0], target);
    assert.equal(JSON.stringify(state.rounds[1]), snapshot);
    assert.deepEqual(Array.from(api.roster(2)), ['sample1', 'sample2']);
    api.loadState(); api.toggleSettled(2, false);
    assert.deepEqual(Array.from(api.roster(2)), ['sample3', 'sample2']);
    assert.match(api.calculate(true), /sample3 60,000원/);
  });

  test('typing an existing nickname as a prefix does not merge two different participants', () => {
    const app = setup(), { api, elements } = app, state = api.state();
    api.setRoster('actual', 2, ['sample3']);
    const firstId = state.nicknameIds[0], laterId = state.rounds[1].attendees[0];
    const field = elements.nicknames.children[0];
    field.value = 'sample3'; field.events.input();
    assert.equal(state.nicknameIds[0], firstId);
    field.value = 'sample30'; field.events.input(); field.events.change();
    assert.equal(state.nicknameIds[0], firstId);
    assert.notEqual(firstId, laterId);
    assert.deepEqual(Array.from(api.roster(2)), ['sample3']);
    const message = api.calculate(true);
    assert.match(message, /sample30 15,000원/);
    assert.match(message, /sample3 30,000원/);
  });

  test('merging a nickname carries alcohol choices, confirmed payments and payer through reload', () => {
    const app = setup('prepay'), { api, elements } = app, state = api.state(); state.dOn = true;
    api.setRoster('collection', 2, ['sample1', 'sample2', 'sample3']);
    state.rounds[1].collectionAmount = '10000'; api.togglePayment(2, true);
    const firstId = state.nicknameIds[0], targetId = state.rounds[1].attendees[2];
    state.rounds[0].noAlcohol = [firstId]; state.rounds[1].noAlcohol = [firstId];
    elements.payer.value = firstId; elements.payer.events.change();
    const field = elements.nicknames.children[0]; field.value = 'sample3'; field.events.input(); field.events.change();
    assert.equal(state.nicknameIds[0], targetId);
    assert.equal(state.payer, targetId);
    assert.deepEqual(Array.from(state.rounds[1].payment.names), [targetId, state.nicknameIds[1]]);
    assert.equal(state.rounds[1].payment.amount, 10000);
    assert.deepEqual(Array.from(api.noAlcoholNames(1)), ['sample3']);
    assert.deepEqual(Array.from(api.noAlcoholNames(2)), ['sample3']);
    api.loadState(); api.renderPayer();
    assert.equal(api.state().payer, targetId);
    assert.equal(elements.payer.value, targetId);
    assert.deepEqual(Array.from(api.roster(2)), ['sample3', 'sample2']);
    api.togglePayment(1, true);
    assert.match(api.calculate(true), /sample3\(노술\) 30,000원 \(결제함\)/);
  });

  test('zero or blank receipt totals block each active round in both modes', () => {
    for (const mode of ['direct', 'prepay']) for (let n = 1; n <= 4; n++) {
      const app = setup(mode), { api, elements } = app, state = api.state();
      state.lastRound = n; state.rounds.forEach(r => { r.bill = '30000'; });
      if (mode === 'prepay') api.togglePayment(1, true);
      for (const value of ['0', '000', '']) {
        state.rounds[n - 1].bill = value;
        assert.equal(api.calculate(true), undefined);
        assert.equal(elements.warn.textContent, n + '차 계산서 금액을 넣어 주세요.');
        api.toggleSettled(n, true); assert.equal(state.rounds[n - 1].settled, false);
      }
    }
  });

  test('overlong money restores the last value and shows the requested message in every money field', () => {
    const app = setup(), { elements } = app;
    for (const id of ['base', ...[1, 2, 3, 4].flatMap(n => ['b' + n, 'k' + n]), 'prepayAmount2', 'prepayAmount3', 'prepayAmount4']) {
      input(app, id, '82,000'); input(app, id, '12345678901');
      assert.equal(elements[id].value, '82000');
      assert.equal(elements[id + 'Limit'].textContent, '금액은 10자리까지 넣을 수 있어요');
      input(app, id, '90000'); assert.equal(elements[id + 'Limit'].textContent, '');
    }
  });

  test('payer selection survives actual save/load/render and stays out of transfer recipients in both modes', () => {
    for (const mode of ['direct', 'prepay']) {
      const app = setup(mode), { api, elements } = app;
      if (mode === 'prepay') api.togglePayment(1, true);
      const payer = api.state().nicknameIds[0]; elements.payer.value = payer; elements.payer.events.change();
      api.loadState(); api.renderPayer();
      assert.equal(elements.payer.value, payer);
      assert.equal(api.state().payer, payer);
      const message = api.calculate(true);
      assert.match(message, /sample1 30,000원 \(결제함\)/);
      assert.doesNotMatch(message, /sample1.*(?:보내주세요|추가 입금|환불)/);
    }
  });

  test('opening the next collection keeps the selected settlement range and saves that selection', () => {
    for (const selected of [1, 2, 4]) {
      const { api, elements } = setup('prepay'); api.state().lastRound = selected;
      for (let n = 2; n <= 4; n++) {
        elements.addPrepay.events.click();
        assert.equal(api.state().lastRound, selected);
        assert.equal(api.state().rounds[n - 1].collectionVisible, true);
        api.loadState(); assert.equal(api.state().lastRound, selected);
      }
    }
  });

  test('message button precedes individual results and completed controls explain exclusion', () => {
    assert.match(html, /id="calculate" type="button">정산 문구 만들기<\/button>/);
    assert.ok(html.indexOf('id="calculate"') < html.indexOf('id="res"'));
    assert.match(html, /이미 정산함/);
    assert.match(html, /입금·환불까지 모두 끝난 차수만 체크해 주세요\. 체크하면 계산에서 빠져요\./);
  });

  test('prepayment keeps only the total summary and continues to multiply exact fees', () => {
    const app = setup('prepay'); input(app, 'base', '10001');
    assert.equal(app.elements.tot.textContent, '20,002원');
    assert.doesNotMatch(html, /id="fee"/);
    assert.match(html, /id="tot"/);
  });

  test('direct screen labels show the nickname once with one main amount while keeping round details', () => {
    const { api, rows } = setup(); rows.length = 0; api.calculate(true);
    assert.equal(rows[0][0], 'sample1');
    assert.match(rows[0][2], /1차 15,000원 · 2차 15,000원/);
    assert.equal(rows[0][1], -30000);
    api.state().mode = 'prepay'; api.togglePayment(1, true); rows.length = 0; api.calculate(true);
    assert.match(rows[0][0], /sample1 · 부담액 30,000원/);
  });

  test('single recipient messages omit per-person wording for direct payment, additional payment and refund', () => {
    for (const mode of ['direct', 'prepay']) {
      const { api } = setup(mode), state = api.state(); state.ppl = '1'; state.lastRound = 1; state.base = '45000'; state.rounds[0].bill = '40000';
      if (mode === 'prepay') api.togglePayment(1, true);
      assert.match(api.calculate(true), mode === 'direct' ? /sample1 40,000원 보내주세요/ : /sample1 5,000원 환불해 드릴게요/);
      assert.doesNotMatch(api.calculate(true), /1인|1명 모두/);
      if (mode === 'prepay') { state.rounds[0].bill = '50000'; assert.match(api.calculate(true), /sample1 5,000원 추가 입금해 주세요/); }
    }
  });
};
