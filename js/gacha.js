// ──────────────────────────────────────────────
//  GACHA
// ──────────────────────────────────────────────
// 확률 기반 weighted random 뽑기
async function loadGachaPool(force = false) {
  if (!force && window._gachaPoolCache && window._gachaPoolCache.length > 0) {
    gachaPool = window._gachaPoolCache;
    return gachaPool;
  }
  const { data } = await sb.from('products')
    .select('*')
    .eq('active', true)
    .eq('item_type', 'gacha');
  gachaPool = data || [];
  window._gachaPoolCache = gachaPool;
  return gachaPool;
}
// 관리자가 뽑기 상품 수정 시 캐시 무효화
function invalidateGachaPoolCache() { window._gachaPoolCache = null; }

// ── 무료 뽑기 + 티켓 상태 확인 및 버튼 업데이트 ────────────
async function checkFreeGacha() {
  if (!myProfile || myProfile.is_admin) return;

  // gacha_tickets 테이블에서 카운터 조회 (inventory X)
  const [{ data: daily }, { data: weekly }, { data: ticketRow }] = await Promise.all([
    sb.from('free_gacha_usage').select('id')
      .eq('user_id', myProfile.id).eq('gacha_type', 'daily').eq('period_key', TODAY).limit(1),
    sb.from('free_gacha_usage').select('id')
      .eq('user_id', myProfile.id).eq('gacha_type', 'weekly').eq('period_key', WEEK_KEY).limit(1),
    sb.from('gacha_tickets').select('id,ticket_count')
      .eq('user_id', myProfile.id).maybeSingle()
  ]);

  const dailyUsed   = daily  && daily.length  > 0;
  const weeklyUsed  = weekly && weekly.length > 0;
  const ticketCount = ticketRow?.ticket_count ?? 0;
  console.log('[checkFreeGacha] ticketRow:', ticketRow, 'count:', ticketCount);

  // 전역 캐시
  window._dailyFreeUsed    = dailyUsed;
  window._weeklyFreeUsed   = weeklyUsed;
  window._gachaTicketCount = ticketCount;

  const btn1   = document.getElementById('btn-gacha1');
  const btn5   = document.getElementById('btn-gacha5');
  const notice = document.getElementById('freeGachaNotice');

  // ── 1회 버튼: 무료일 > 티켓 > 유료 순 우선순위 ──
  if (btn1) {
    if (!dailyUsed) {
      btn1.innerHTML = '🎁 1회 무료!';
      btn1.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
      btn1.style.color = '#fff';
    } else if (ticketCount > 0) {
      btn1.innerHTML = `🎫 티켓으로 뽑기 <span style="font-size:10px;opacity:0.8">(${ticketCount}장)</span>`;
      btn1.style.background = 'linear-gradient(135deg,#7c3aed,#5b21b6)';
      btn1.style.color = '#fff';
    } else {
      btn1.innerHTML = '1회 뽑기 <span style="font-size:10px;opacity:0.7">(🌰 10)</span>';
      btn1.style.background = '';
      btn1.style.color = '';
    }
  }

  // ── 5회 버튼: 무료주간 > 티켓 5장+ > 유료 ──
  if (btn5) {
    if (!weeklyUsed) {
      btn5.innerHTML = '🎁 5회 무료!';
      btn5.style.background = 'linear-gradient(135deg,#a855f7,#7c3aed)';
      btn5.style.color = '#fff';
    } else if (ticketCount >= 5) {
      btn5.innerHTML = `🎫 티켓으로 5회 뽑기 <span style="font-size:10px;opacity:0.8">(${ticketCount}장)</span>`;
      btn5.style.background = 'linear-gradient(135deg,#6d28d9,#4c1d95)';
      btn5.style.color = '#fff';
    } else {
      btn5.innerHTML = '5회 뽑기 <span style="font-size:10px;opacity:0.7">(🌰 50)</span>';
      btn5.style.background = '';
      btn5.style.color = '';
    }
  }

  // 안내 문구
  const notices = [];
  if (!dailyUsed)      notices.push('🎁 오늘 무료 1회 뽑기 남아있어요!');
  if (!weeklyUsed)     notices.push('🎁 이번 주 무료 5회 뽑기 남아있어요!');
  // 티켓 보유 중 안내는 버튼에 이미 표시되므로 생략
  if (notice) {
    notice.textContent = notices.join('  ·  ');
    notice.classList.toggle('hidden', notices.length === 0);
  }

  // 헤더 티켓 수 업데이트
  const ticketEl = document.getElementById('headerTickets');
  if (ticketEl) ticketEl.textContent = `🎫 ${ticketCount}`;
}

function drawItemWeighted(pool) {
  if (!pool.length) return null;
  // probability 합계 계산
  const total = pool.reduce((s, x) => s + (x.probability || 0), 0);
  if (total <= 0) {
    // 확률이 설정 안 된 경우 균등 분배
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let rand = Math.random() * total;
  for (const item of pool) {
    rand -= (item.probability || 0);
    if (rand <= 0) return item;
  }
  return pool[pool.length - 1];
}

// 뽑기 티켓 1장 소모 후 1회 뽑기
async function _useGachaTicketAndPull() {
  const ticketCount = window._gachaTicketCount || 0;
  if (ticketCount < 1) { toast('❌', '티켓이 없어요!'); checkFreeGacha(); return; }

  const pool = await loadGachaPool();
  if (!pool.length) { toast('❌', '뽑기 상품이 없어요!'); return; }

  const btns = document.querySelectorAll('#utab-gacha button');
  btns.forEach(b => btnLock(b, '뽑는 중...'));

  // 티켓 1장 차감 (gacha_tickets 카운터)
  const { data: ticketRes, error: ticketErr } = await sb.rpc('adjust_gacha_tickets', {
    p_user_id: myProfile.id, p_amount: -1
  });
  if (ticketErr || !ticketRes?.success) {
    btns.forEach(btnUnlock);
    toast('❌', '티켓 사용 실패');
    window._gachaTicketCount = undefined;
    checkFreeGacha();
    return;
  }
  window._gachaTicketCount = ticketRes.count;

  playSound('gacha');
  const spinner = document.getElementById('gachaSpinner');
  const gachaResultEl = document.getElementById('gachaResult');
  if (spinner) {
    if (gachaResultEl) gachaResultEl.classList.add('hidden');
    spinner.classList.remove('hidden');
    spinner.classList.add('active');
    const spinEmojis = ['🎁','🌰','✨','🎲','🎊','⭐','🎀'];
    let spinIdx = 0;
    window._spinInterval = setInterval(() => {
      const si = document.getElementById('gachaSpinIcon');
      if (si) si.textContent = spinEmojis[spinIdx++ % spinEmojis.length];
    }, 120);
  }

  await new Promise(r => setTimeout(r, 1200));

  if (window._spinInterval) clearInterval(window._spinInterval);
  if (spinner) {
    spinner.classList.remove('active');
    spinner.classList.add('hidden');
    const si = document.getElementById('gachaSpinIcon');
    if (si) { si.classList.remove('gacha-spinning'); si.textContent = '🎁'; }
  }

  const results = [drawItemWeighted(pool)].filter(Boolean);
  const sessionId = crypto.randomUUID();

  const acornItems  = results.filter(r => r.reward_type === 'AUTO_ACORN' && r.acorn_amt > 0);
  const manualItems = results.filter(r => r.reward_type === 'MANUAL_ITEM' || r.reward_type === 'COUPON'
    || r.reward_type === 'ACORN_TICKET' || r.reward_type === 'GACHA_TICKET');
  const totalAcorn  = acornItems.reduce((s, r) => s + r.acorn_amt, 0);

  const tasks = [];
  if (totalAcorn > 0) {
    tasks.push(sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id, p_amount: totalAcorn,
      p_reason: `뽑기 티켓 보상 (${acornItems.map(r=>r.name).join(', ')})`
    }).then(r => { if (r.data?.success) myProfile.acorns = r.data.balance; }));
  }
  if (manualItems.length) {
    tasks.push(sb.from('inventory').insert(manualItems.map(item => ({
      user_id: myProfile.id, product_id: item.id,
      product_snapshot: item, from_gacha: true, status: 'held'
    }))));
  }
  tasks.push(sb.from('gacha_logs').insert(results.map(item => ({
    user_id: myProfile.id, session_id: sessionId,
    item_name: item.name, item_icon: item.icon,
    rarity: item.rarity || 'common', reward_type: item.reward_type,
    acorn_amt: item.acorn_amt || 0, is_free: true
  }))));

  await Promise.all(tasks);
  updateAcornDisplay();  // 헤더 티켓 수도 업데이트
  playSound('reward');
  triggerAutoQuest('gachaPlay', 1);
  renderGachaCards(results, 'gachaResult', 'gachaResultItems');
  setTimeout(() => playSound('gachaResult'), 100);
  btns.forEach(btnUnlock);
  checkFreeGacha();  // 남은 티켓 수 반영
}

// 구버전 호환
async function doGachaTicket() {
  await _useGachaTicketAndPull();
}

// 티켓 5장으로 5회 뽑기
async function _useGachaTicketsPull5() {
  const tc = window._gachaTicketCount || 0;
  if (tc < 5) { toast('❌', '티켓이 5장 이상 필요해요!'); checkFreeGacha(); return; }

  const pool = await loadGachaPool();
  if (!pool.length) { toast('❌', '뽑기 상품이 없어요!'); return; }

  const btns = document.querySelectorAll('#utab-gacha button');
  btns.forEach(b => btnLock(b, '뽑는 중...'));

  // 티켓 5장 차감
  const { data: ticketRes, error: ticketErr } = await sb.rpc('adjust_gacha_tickets', {
    p_user_id: myProfile.id, p_amount: -5
  });
  if (ticketErr || !ticketRes?.success) {
    btns.forEach(btnUnlock);
    toast('❌', '티켓 사용 실패');
    window._gachaTicketCount = undefined;
    checkFreeGacha();
    return;
  }
  window._gachaTicketCount = ticketRes.count;

  playSound('gacha');
  const spinner = document.getElementById('gachaSpinner');
  const gachaResultEl = document.getElementById('gachaResult');
  if (spinner) {
    if (gachaResultEl) gachaResultEl.classList.add('hidden');
    spinner.classList.remove('hidden');
    spinner.classList.add('active');
    const spinEmojis = ['🎁','🌰','✨','🎲','🎊','⭐','🎀'];
    let spinIdx = 0;
    window._spinInterval = setInterval(() => {
      const si = document.getElementById('gachaSpinIcon');
      if (si) si.textContent = spinEmojis[spinIdx++ % spinEmojis.length];
    }, 120);
  }

  await new Promise(r => setTimeout(r, 1500));

  if (window._spinInterval) clearInterval(window._spinInterval);
  if (spinner) {
    spinner.classList.remove('active');
    spinner.classList.add('hidden');
    const si = document.getElementById('gachaSpinIcon');
    if (si) { si.classList.remove('gacha-spinning'); si.textContent = '🎁'; }
  }

  const results = Array.from({ length: 5 }, () => drawItemWeighted(pool)).filter(Boolean);
  const sessionId = crypto.randomUUID();

  const acornItems  = results.filter(r => r.reward_type === 'AUTO_ACORN' && r.acorn_amt > 0);
  const ticketItems = results.filter(r => r.reward_type === 'GACHA_TICKET');
  const manualItems = results.filter(r => r.reward_type === 'MANUAL_ITEM' || r.reward_type === 'COUPON' || r.reward_type === 'ACORN_TICKET');
  const totalAcorn  = acornItems.reduce((s, r) => s + r.acorn_amt, 0);

  const tasks = [];
  if (totalAcorn > 0) {
    tasks.push(sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id, p_amount: totalAcorn,
      p_reason: `티켓 5회 뽑기 보상`
    }).then(r => { if (r.data?.success) myProfile.acorns = r.data.balance; }));
  }
  if (ticketItems.length > 0) {
    tasks.push(sb.rpc('adjust_gacha_tickets', {
      p_user_id: myProfile.id, p_amount: ticketItems.length
    }).then(r => { if (r.data?.success) window._gachaTicketCount = r.data.count; }));
  }
  if (manualItems.length) {
    tasks.push(sb.from('inventory').insert(manualItems.map(item => ({
      user_id: myProfile.id, product_id: item.id,
      product_snapshot: item, from_gacha: true, status: 'held'
    }))));
  }
  tasks.push(sb.from('gacha_logs').insert(results.map(item => ({
    user_id: myProfile.id, session_id: sessionId,
    item_name: item.name, item_icon: item.icon,
    rarity: item.rarity || 'common', reward_type: item.reward_type,
    acorn_amt: item.acorn_amt || 0, is_free: true
  }))));

  await Promise.all(tasks);
  updateAcornDisplay();
  playSound('reward');
  triggerAutoQuest('gachaPlay', 5);
  renderGachaCards(results, 'gachaResult', 'gachaResultItems');
  setTimeout(() => playSound('gachaResult'), 100);
  btns.forEach(btnUnlock);
  checkFreeGacha();
}

async function doGacha(count) {
  const tc = window._gachaTicketCount || 0;
  // 1회: 무료일 소진 + 티켓 보유 → 티켓으로
  if (count === 1 && window._dailyFreeUsed && tc >= 1) {
    await _useGachaTicketAndPull();
    return;
  }
  // 5회: 무료주간 소진 + 티켓 5장 이상 → 티켓 5장으로
  if (count === 5 && window._weeklyFreeUsed && tc >= 5) {
    await _useGachaTicketsPull5();
    return;
  }
  const btns = document.querySelectorAll('#utab-gacha button');
  const spinner = document.getElementById('gachaSpinner');
  const gachaResultEl = document.getElementById('gachaResult');

  // 이중클릭 방지
  btns.forEach(b => btnLock(b, '뽑는 중...'));

  // 뽑기 연출 시작
  if (spinner) {
    if (gachaResultEl) gachaResultEl.classList.add('hidden');
    spinner.classList.remove('hidden');
    spinner.classList.add('active');
    const spinMsg = document.getElementById('gachaSpinMsg');
    if (spinMsg) spinMsg.style.animation = 'pulse 1s infinite';
    const spinIcon = document.getElementById('gachaSpinIcon');
    const spinEmojis = ['🎁','🌰','✨','🎲','🎊','⭐','🎀'];
    let spinIdx = 0;
    window._spinInterval = setInterval(() => {
      if (spinIcon) spinIcon.textContent = spinEmojis[spinIdx++ % spinEmojis.length];
    }, 120);
    if (spinIcon) spinIcon.classList.add('gacha-spinning');
  }

  // 스피너/버튼 정리 헬퍼 (에러 시에도 반드시 실행)
  function _cleanupGacha() {
    if (window._spinInterval) clearInterval(window._spinInterval);
    if (spinner) {
      spinner.classList.remove('active');
      spinner.classList.add('hidden');
      const si = document.getElementById('gachaSpinIcon');
      if (si) { si.classList.remove('gacha-spinning'); si.textContent = '🎁'; }
      const sm = document.getElementById('gachaSpinMsg'); if (sm) sm.style.animation = '';
    }
    btns.forEach(btnUnlock);
    // btnUnlock이 텍스트를 복원한 뒤 무료 상태 반영 (순서 중요)
    checkFreeGacha();
  }

  try {
    const gachaEvtDiscount = getActiveEventDiscount('gacha');

    // ── 무료 뽑기 여부 판단 ──
    const isFreeDaily  = count === 1 && !window._dailyFreeUsed;
    const isFreeWeekly = count === 5 && !window._weeklyFreeUsed;
    const isFree = isFreeDaily || isFreeWeekly;
    const freeType = isFreeDaily ? 'daily' : 'weekly';
    const freePeriod = isFreeDaily ? TODAY : WEEK_KEY;

    // 무료인 경우: DB에 먼저 기록 시도 (중복 방지)
    if (isFree) {
      const { error: freeErr } = await sb.from('free_gacha_usage').insert({
        user_id: myProfile.id, gacha_type: freeType, period_key: freePeriod
      });
      if (freeErr) {
        // 이미 사용 → 사용자에게 유료 전환 확인
        window._dailyFreeUsed  = freeType === 'daily'  ? true : window._dailyFreeUsed;
        window._weeklyFreeUsed = freeType === 'weekly' ? true : window._weeklyFreeUsed;
        checkFreeGacha();
        const baseCostConfirm = GACHA_COST * count;
        const evtDisc = typeof gachaEvtDiscount !== 'undefined' ? gachaEvtDiscount : 0;
        const costConfirm = evtDisc > 0 ? Math.floor(baseCostConfirm * (1 - evtDisc/100)) : baseCostConfirm;
        showModal(`<div class="text-center">
          <div style="font-size:2.5rem;margin-bottom:8px">⚠️</div>
          <h2 class="text-lg font-black text-gray-800 mb-2">무료 뽑기 소진</h2>
          <p class="text-sm text-gray-500 mb-4">이미 무료 뽑기를 사용했어요.<br>🌰 ${costConfirm} 도토리로 유료 뽑기를 진행할까요?</p>
          <div class="flex gap-2">
            <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
            <button class="btn btn-primary flex-1 py-2 font-black" onclick="closeModal();doGacha(${count})">뽑기 진행</button>
          </div>
        </div>`);
        return;
      }
    }

    const baseCost = GACHA_COST * count;
    const cost = isFree ? 0 : gachaEvtDiscount > 0 ? Math.floor(baseCost * (1 - gachaEvtDiscount/100)) : baseCost;

    if (!isFree && (myProfile.acorns||0) < cost) {
      playSound('reject'); toast('❌', '도토리가 부족해요!', 1500); return;
    }

    if (isFree) toast('🎁', `무료 뽑기!`, 1500);
    else if (gachaEvtDiscount > 0) toast('🎉', `뽑기 이벤트 ${gachaEvtDiscount}% 할인! (${baseCost}🌰 → ${cost}🌰)`, 2000);
    playSound('gacha');

    // 뽑기 풀 최신화
    const pool = await loadGachaPool();
    if (!pool.length) {
      toast('❌', '뽑기 상품이 없어요! 관리자에게 문의하세요.'); return;
    }

    // 도토리 차감 (무료면 0원)
    if (cost > 0) {
      const res = await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: -cost, p_reason: `뽑기 사용 (${count}회)${gachaEvtDiscount > 0 ? ' - 이벤트 ' + gachaEvtDiscount + '% 할인' : ''}` });
      if (!res.data?.success) { toast('❌', '처리 실패'); return; }
      myProfile.acorns = res.data.balance;
      updateAcornDisplay();
    }

    // 무료 사용 후 캐시 갱신 (버튼 텍스트는 _cleanupGacha에서 처리)
    if (isFree) {
      if (isFreeDaily)  window._dailyFreeUsed  = true;
      if (isFreeWeekly) window._weeklyFreeUsed = true;
    }

    // ── 뽑기 결과 계산 (로컬, 즉시) ──
    const results = Array.from({ length: count }, () => drawItemWeighted(pool)).filter(Boolean);

    // ── AUTO_ACORN 보상 합산 → 한 번에 지급 ──
    const acornItems    = results.filter(r => r.reward_type === 'AUTO_ACORN' && r.acorn_amt > 0);
    const ticketItems   = results.filter(r => r.reward_type === 'GACHA_TICKET');  // 인벤토리 X → 카운터
    const manualItems   = results.filter(r => r.reward_type === 'MANUAL_ITEM' || r.reward_type === 'COUPON' || r.reward_type === 'ACORN_TICKET');
    const totalAcornAmt = acornItems.reduce((s, r) => s + r.acorn_amt, 0);

    // ── DB 작업 병렬 실행 ──
    const dbTasks = [];

    // 도토리 보상 한 번에
    if (totalAcornAmt > 0) {
      dbTasks.push(
        sb.rpc('adjust_acorns', {
          p_user_id: myProfile.id,
          p_amount: totalAcornAmt,
          p_reason: `뽑기 보상 (${acornItems.map(r=>r.name).join(', ')})`
        }).then(r => {
          if (r.data?.success) myProfile.acorns = r.data.balance;
        })
      );
    }

    // 뽑기 티켓 결과 → 카운터에 즉시 추가 (인벤토리 X)
    if (ticketItems.length > 0) {
      dbTasks.push(
        sb.rpc('adjust_gacha_tickets', {
          p_user_id: myProfile.id, p_amount: ticketItems.length
        }).then(({ data, error }) => {
          console.log('[티켓RPC결과]', data, error);
          if (error) return;
          window._gachaTicketCount = data?.count ?? data ?? 0;
          const el = document.getElementById('headerTickets');
          if (el) el.textContent = `🎫 ${window._gachaTicketCount}`;
        })
      );
    }

    // 인벤토리 삽입 한 번에 (배열로)
    if (manualItems.length > 0) {
      dbTasks.push(
        sb.from('inventory').insert(
          manualItems.map(item => ({
            user_id: myProfile.id,
            product_id: item.id,
            product_snapshot: item,
            from_gacha: true,
            status: 'held'
          }))
        )
      );
    }

    // 뽑기 로그 저장
    const sessionId = crypto.randomUUID();
    dbTasks.push(
      sb.from('gacha_logs').insert(
        results.map(item => ({
          user_id: myProfile.id,
          session_id: sessionId,
          item_name: item.name,
          item_icon: item.icon,
          rarity: item.rarity || 'common',
          reward_type: item.reward_type,
          acorn_amt: item.acorn_amt || 0,
          is_free: isFree
        }))
      )
    );

    // 알림 한 번에 (각 아이템별 알림 → 병렬)
    for (const item of results) {
      if (item.reward_type === 'AUTO_ACORN' && item.acorn_amt > 0) {
        dbTasks.push(pushNotif(myProfile.id, 'gachaReward', '뽑기 보상! 🎲', `${item.icon} ${item.name} 획득! +${item.acorn_amt}🌰`));
      } else if (item.reward_type === 'MANUAL_ITEM') {
        dbTasks.push(pushNotif(myProfile.id, 'gachaReward', '아이템 획득! 🎲', `${item.icon} ${item.name} 획득! 인벤토리에서 확인하세요.`));
      } else if (item.reward_type === 'COUPON') {
        dbTasks.push(pushNotif(myProfile.id, 'gachaReward', '할인쿠폰 획득! 🎟️', `${item.icon} ${item.name} (${item.discount_pct||0}% 할인) 획득! 상점 구매 시 사용하세요.`));
      }
    }

    await Promise.all(dbTasks);
    updateAcornDisplay();
    playSound('reward');
    triggerAutoQuest('gachaPlay', count); // 백그라운드 실행 (완료 후 renderQuests가 내부에서 호출됨)

    renderGachaCards(results, 'gachaResult', 'gachaResultItems');
    setTimeout(() => playSound('gachaResult'), 100);
    const el = document.getElementById('gachaIcon');
    el.style.animation = 'none'; void el.offsetWidth;
    el.textContent = '🎊'; el.style.animation = 'bounceIn .5s';
    setTimeout(() => { el.textContent = '🎁'; el.style.animation = ''; }, 1600);

  } catch(err) {
    toast('❌', '뽑기 중 오류가 발생했어요');
    console.error('doGacha error:', err);
  } finally {
    _cleanupGacha();
  }
}

function renderGachaCards(results, wrapId, itemsId) {
  document.getElementById(wrapId).classList.remove('hidden');
  document.getElementById(itemsId).innerHTML = results.map((item,i) => `
    <div class="text-center pop-in" style="animation-delay:${i*.12}s">
      <div class="text-5xl mb-2">${item.icon}</div>
      <div class="badge ${rcClass(item.rarity)} mb-1 block">${item.name}</div>
      <span class="${item.reward_type==='AUTO_ACORN'||item.reward_type==='ACORN_TICKET'?'rt-auto':item.reward_type==='COUPON'||item.reward_type==='GACHA_TICKET'?'rt-coupon':'rt-manual'} block mt-1">
        ${item.reward_type==='AUTO_ACORN'?`+${item.acorn_amt}🌰`:item.reward_type==='ACORN_TICKET'?`🌰 도토리 티켓`:item.reward_type==='GACHA_TICKET'?`🎫 뽑기 티켓`:item.reward_type==='COUPON'?`🎟️ ${item.discount_pct||0}% 쿠폰`:'📬 인벤토리'}
      </span>
    </div>`).join('');
}

const rcClass = r => ({common:'rc-common',rare:'rc-rare',epic:'rc-epic',legend:'rc-legend'})[r]||'rc-common';

async function renderGachaProbTable() {
  const el = document.getElementById('gachaProbTable');
  if (!el) return;

  // 뽑기 이벤트 배너 (매번 갱신)
  {
    const gachaTab = document.getElementById('utab-gacha');
    const gachaCard = gachaTab?.querySelector('.clay-card');
    if (gachaCard) {
      let banner = document.getElementById('gachaEventBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'gachaEventBanner';
        banner.className = 'text-sm font-black text-green-700 text-center mb-2';
        banner.style.cssText = 'background:rgba(220,252,231,0.8);border-radius:12px;padding:8px 12px;border:2px solid rgba(34,197,94,0.3)';
        gachaCard.insertBefore(banner, gachaCard.firstChild);
      }
      const evtDiscount = getActiveEventDiscount('gacha');
      if (evtDiscount > 0) {
        const endAt = _getEventEndAt('gacha');
        const timeStr = endAt ? `<span id="gachaEvtTimer" style="font-size:11px;opacity:0.8;display:block;margin-top:2px">⏱️ ${_fmtRemaining(endAt - Date.now())} 남음</span>` : '';
        banner.innerHTML = `🎉 뽑기 이벤트! 10🌰 → ${Math.floor(10*(1-evtDiscount/100))}🌰 (${evtDiscount}% 할인 중)${timeStr}`;
        banner.style.display = '';
        // 카운트다운
        if (endAt) {
          if (window._gachaEvtTimer) clearInterval(window._gachaEvtTimer);
          window._gachaEvtTimer = setInterval(() => {
            const el = document.getElementById('gachaEvtTimer');
            if (!el) { clearInterval(window._gachaEvtTimer); return; }
            const rem = endAt - Date.now();
            if (rem > 0) el.textContent = '⏱️ ' + _fmtRemaining(rem) + ' 남음';
            else { el.textContent = '⏱️ 곧 종료'; clearInterval(window._gachaEvtTimer); }
          }, 1000);
        }
      } else {
        banner.style.display = 'none';
      }
    }
  }

  const { data: items, error } = await sb.from('products')
    .select('name,icon,probability,description')
    .eq('active', true).eq('item_type', 'gacha')
    .order('probability', { ascending: false });
  if (error) { el.innerHTML = `<p class="text-xs text-red-400 text-center py-2">오류: ${error.message}</p>`; return; }
  if (!items?.length) { el.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">등록된 뽑기 상품 없음</p>'; return; }
  const total = items.reduce((s,x) => s+(x.probability||0), 0);
  el.innerHTML = items.map(x => {
    const pct = total > 0 ? ((x.probability||0)/total*100).toFixed(1) : (100/items.length).toFixed(1);
    return `<div class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span class="text-sm font-bold text-gray-700">${x.icon||'🎁'} ${x.name}</span>
      <span class="badge-gacha-pct">${pct}%</span>
    </div>`;
  }).join('');
}

function setForce(r) { forceRarity=r; document.getElementById('forceLabel').textContent=({'':'랜덤',common:'⚪ 일반',rare:'🔵 레어',epic:'🟣 에픽',legend:'🔴 전설'})[r]; }
async function doAdminGacha(count) {
  const btns = document.querySelectorAll('#atab-gachaTest button');
  const spinner = document.getElementById('adminGachaSpinner');
  const resultEl = document.getElementById('adminGachaResult');

  btns.forEach(b => btnLock(b, '뽑는 중...'));
  if (spinner) { spinner.style.display = 'flex'; if (resultEl) resultEl.classList.add('hidden'); }

  const spinIcon = document.getElementById('adminGachaSpinIcon');
  const spinEmojis = ['🎁','🌰','✨','🎲','🎊','⭐','🎀'];
  let spinIdx = 0;
  const spinInterval = setInterval(() => {
    if (spinIcon) spinIcon.textContent = spinEmojis[spinIdx++ % spinEmojis.length];
  }, 120);

  playSound('gacha');

  try {
    const pool = await loadGachaPool();
    if (!pool.length) { toast('❌', '뽑기 상품이 없어요!'); return; }

    // 실제 확률로 뽑되 도토리 차감/인벤토리 저장 없음
    const results = Array.from({length: count}, () => drawItemWeighted(pool)).filter(Boolean);

    renderGachaCards(results, 'adminGachaResult', 'adminGachaResultItems');
    setTimeout(() => playSound('gachaResult'), 100);

    const icon = document.getElementById('adminGachaIcon');
    if (icon) {
      icon.style.animation = 'none'; void icon.offsetWidth;
      icon.textContent = '🎊'; icon.style.animation = 'bounceIn .5s';
      setTimeout(() => { icon.textContent = '🎁'; icon.style.animation = ''; }, 1600);
    }
  } catch(e) {
    toast('❌', '오류 발생');
  } finally {
    clearInterval(spinInterval);
    if (spinner) spinner.style.display = 'none';
    if (spinIcon) spinIcon.textContent = '🎁';
    btns.forEach(btnUnlock);
  }
}

// ── 확률 시뮬레이터 ──────────────────────────────
async function runGachaSimulator() {
  const drawCount  = parseInt(document.getElementById('simCount')?.value  || 5);
  const rounds     = parseInt(document.getElementById('simRounds')?.value || 1000);
  const resultEl   = document.getElementById('simResult');
  if (!resultEl) return;

  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-3">⏳ 시뮬레이션 중... (${drawCount}회 × ${rounds.toLocaleString()}번)</p>`;

  // 비동기로 UI 업데이트 후 계산 시작
  await new Promise(r => setTimeout(r, 30));

  const pool = await loadGachaPool();
  if (!pool.length) { resultEl.innerHTML = '<p class="text-xs text-red-400 text-center py-2">뽑기 상품이 없어요</p>'; return; }

  const total = pool.reduce((s, x) => s + (x.probability || 0), 0);
  const totalDraws = drawCount * rounds;

  // 카운터 초기화
  const counts = {};
  pool.forEach(item => { counts[item.id] = 0; });

  // 시뮬레이션 실행
  for (let r = 0; r < rounds; r++) {
    for (let d = 0; d < drawCount; d++) {
      const item = drawItemWeighted(pool);
      if (item) counts[item.id] = (counts[item.id] || 0) + 1;
    }
  }

  // 결과 렌더
  const sorted = [...pool].sort((a, b) => (b.probability || 0) - (a.probability || 0));
  const totalProbability = total > 0 ? total : pool.length;

  // 설계 확률과 실제 결과 차이 최대값 계산 (경고용)
  let maxDiff = 0;
  sorted.forEach(item => {
    const designed = total > 0 ? (item.probability || 0) / total * 100 : 100 / pool.length;
    const actual   = (counts[item.id] || 0) / totalDraws * 100;
    maxDiff = Math.max(maxDiff, Math.abs(actual - designed));
  });

  const totalWarning = Math.abs(total - 100) > 0.5
    ? `<div class="text-xs font-black text-amber-700 bg-amber-50 rounded-xl p-3 mb-3">
        ⚠️ 설계 확률 합계: <span class="text-lg">${total.toFixed(1)}%</span>
        ${total > 100 ? '— 100% 초과! 각 아이템 실제 확률이 설계값보다 낮아요.' : '— 100% 미달! 각 아이템 실제 확률이 설계값보다 높아요.'}
       </div>`
    : `<div class="text-xs font-bold text-green-700 bg-green-50 rounded-xl p-2 mb-3">✅ 설계 확률 합계: ${total.toFixed(1)}% — 정상</div>`;

  const rows = sorted.map(item => {
    const cnt      = counts[item.id] || 0;
    const designed = total > 0 ? (item.probability || 0) / total * 100 : 100 / pool.length;
    const actual   = cnt / totalDraws * 100;
    const diff     = actual - designed;
    const diffAbs  = Math.abs(diff);
    // 통계적 허용 오차: sqrt(p*(1-p)/n) * 3 (3시그마)
    const pDec     = designed / 100;
    const stdErr   = Math.sqrt(pDec * (1 - pDec) / totalDraws) * 100;
    const sigma3   = stdErr * 3;
    const isOdd    = diffAbs > sigma3 && diffAbs > 0.5; // 통계적으로 이상한 경우

    const diffColor = diffAbs < 0.5 ? '#6b7280'
                    : diff > 0 ? '#dc2626' : '#2563eb';
    const diffSign  = diff > 0 ? '+' : '';
    const oddMark   = isOdd ? ' ⚠️' : '';

    // 막대 그래프 (설계 vs 실제)
    const barMax    = Math.max(designed, actual, 1);
    const designedW = (designed / barMax * 100).toFixed(1);
    const actualW   = (actual   / barMax * 100).toFixed(1);

    return `<div class="py-3 border-b border-gray-100 last:border-0">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-sm font-black text-gray-800">${item.icon||'🎁'} ${item.name}${oddMark}</span>
        <span class="text-xs font-bold text-gray-400">${cnt.toLocaleString()}회</span>
      </div>
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs text-gray-400 w-16 shrink-0">설계</span>
        <div class="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
          <div class="h-full rounded-full" style="width:${designedW}%;background:#93c5fd"></div>
        </div>
        <span class="text-xs font-black text-blue-600 w-14 text-right">${designed.toFixed(2)}%</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400 w-16 shrink-0">실제</span>
        <div class="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
          <div class="h-full rounded-full" style="width:${actualW}%;background:#86efac"></div>
        </div>
        <span class="text-xs font-black w-14 text-right" style="color:${diffColor}">${actual.toFixed(2)}% <span style="font-size:10px">(${diffSign}${diff.toFixed(2)}%)</span></span>
      </div>
    </div>`;
  }).join('');

  resultEl.innerHTML = `
    <div class="text-xs text-gray-500 font-bold text-center mb-3">
      📊 ${drawCount}회 × ${rounds.toLocaleString()}번 = 총 <span class="font-black text-gray-800">${totalDraws.toLocaleString()}회</span> 뽑기 결과
    </div>
    ${totalWarning}
    <div class="space-y-0">${rows}</div>
    <p class="text-xs text-gray-400 text-center mt-3">
      💡 오차 ±0.5% 이하는 정상 범위 · ⚠️ 는 통계적으로 주의가 필요한 경우
    </p>`;
}

// 관리자 뽑기 탭 진입 시 확률 테이블 렌더
async function renderAdminGachaProbTable() {
  const el = document.getElementById('adminGachaProbTable');
  if (!el) return;
  const { data: items, error } = await sb.from('products')
    .select('name,icon,probability,description')
    .eq('active', true).eq('item_type', 'gacha')
    .order('probability', { ascending: false });
  if (error || !items?.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">등록된 뽑기 상품 없음</p>';
    return;
  }
  const total = items.reduce((s,x) => s+(x.probability||0), 0);
  el.innerHTML = items.map(x => {
    const pct = total > 0 ? ((x.probability||0)/total*100).toFixed(1) : (100/items.length).toFixed(1);
    return `<div class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span class="text-sm font-bold text-gray-700">${x.icon||'🎁'} ${x.name}</span>
      <span class="badge-prob">${pct}%</span>
    </div>`;
  }).join('');
}

