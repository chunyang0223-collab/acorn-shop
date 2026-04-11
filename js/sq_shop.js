/* ================================================================
   🛒 다람쥐 상점 (sq_shop.js)
   ================================================================
   squirrel.js에서 분리된 상점 관련 함수들
   의존: _sqSquirrels, _sqSettings, _sqState, _sqGradeStyle, _sqCalcGrade,
         sqRenderGrid, sqCardHTML, sqRandomName, _sqRandomSprite,
         _sqBuildWeightedPool, _sqPickFromPool,
         canAfford, spendAcorns, showModal, closeModal, toast, myProfile, sb
   ================================================================ */

// ================================================================
//  구매
// ================================================================
async function sqBuySquirrel(from) {
  const maxSq = _sqSettings.max_squirrels || 10;
  if (_sqSquirrels.length >= maxSq) {
    showModal(`<div class="text-center"><div style="font-size:40px">😅</div><div class="title-font text-lg text-gray-800 my-2">보유 한도 초과</div><div class="text-sm text-gray-500 mb-4">최대 ${maxSq}마리까지 보유할 수 있어요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }
  if (from === 'gacha') {
    showModal(`<div class="text-center"><div style="font-size:40px">🎰</div><div class="title-font text-lg text-gray-800 my-2">뽑기로 획득</div><div class="text-sm text-gray-500 mb-4">뽑기 탭에서 다람쥐를 획득할 수 있어요!</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }
  const price = _sqSettings.shop_price || 30;
  if (!canAfford(price)) {
    showModal(`<div class="text-center"><div style="font-size:40px">🌰</div><div class="title-font text-lg text-gray-800 my-2">도토리 부족</div><div class="text-sm text-gray-500 mb-4">${price} 도토리가 필요해요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }
  if (typeof _expShowOverlay === 'function') {
    _expShowOverlay(
      '🐿️',
      '다람쥐를 분양받으시겠어요?',
      myProfile?.is_admin ? '관리자 테스트 모드 — 도토리 차감 없이 분양합니다' : '🌰 ' + price + ' 도토리가 필요합니다',
      '분양받기', function() { sqDoBuySquirrel(price); },
      '취소', null
    );
  } else {
    showModal(`
      <div class="text-center">
        <img src="images/baby-squirrel.png" style="width:80px;height:80px;object-fit:contain" class="mx-auto mb-2">
        <div class="title-font text-lg text-gray-800 mb-1">아기 다람쥐 분양</div>
        <div class="text-sm text-gray-500 mb-4">${myProfile?.is_admin ? '관리자 테스트 모드 — 도토리 차감 없이 분양합니다' : `<strong>${price} 🌰</strong>에 분양받을까요?`}</div>
        <div class="flex gap-2">
          <button class="btn btn-primary flex-1" onclick="sqDoBuySquirrel(${price})">분양받기</button>
          <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
        </div>
      </div>`);
  }
}

async function sqDoBuySquirrel(price) {
  closeModal();
  const acornsNeeded = Math.floor(Math.random() * ((_sqSettings.acorn_max||50) - (_sqSettings.acorn_min||20) + 1)) + (_sqSettings.acorn_min||20);
  const needsTime    = Math.random() * 100 < (_sqSettings.time_chance||40);
  const trigMin = _sqSettings.time_trigger_min || 40;
  const trigMax = _sqSettings.time_trigger_max || 80;
  const timeTriggerPct = needsTime ? (trigMin + Math.floor(Math.random() * (trigMax - trigMin + 1))) : null;
  const baseHp  = (_sqSettings.stat_hp_min||60)  + Math.floor(Math.random() * ((_sqSettings.stat_hp_max||150)  - (_sqSettings.stat_hp_min||60)  + 1));
  const baseAtk = (_sqSettings.stat_atk_min||8)  + Math.floor(Math.random() * ((_sqSettings.stat_atk_max||20)  - (_sqSettings.stat_atk_min||8)  + 1));
  const baseDef = (_sqSettings.stat_def_min||4)  + Math.floor(Math.random() * ((_sqSettings.stat_def_max||20)  - (_sqSettings.stat_def_min||4)  + 1));

  // time_trigger_pct 컬럼 존재 여부 확인
  let hasTriggerCol = false;
  try {
    const { error } = await sb.from('squirrels').select('time_trigger_pct').limit(1);
    hasTriggerCol = !error;
  } catch(e) {}

  try {
    await spendAcorns(price, '다람쥐 구매');

    const insertData = {
      user_id: myProfile.id, name: sqRandomName(), type: 'baby', status: 'idle',
      acorns_fed: 0, acorns_required: acornsNeeded, needs_time: needsTime,
      stats: { hp: baseHp, atk: baseAtk, def: baseDef },
      hp_current: baseHp, acquired_from: 'shop'
    };
    if (hasTriggerCol && timeTriggerPct !== null) insertData.time_trigger_pct = timeTriggerPct;

    const { data: inserted, error: e2 } = await sb.from('squirrels').insert(insertData).select().single();
    if (e2) throw e2;

    // 로컬 캐시에 추가
    _sqSquirrels.push(inserted);
    _sqState[inserted.id] = 'idle';
    if (typeof _btlSound === 'function') _btlSound('buy');

    const grid = _sqEl('squirrelGrid');
    const countEl = _sqEl('squirrelCount');
    if (countEl) countEl.textContent = _sqSquirrels.length + ' / ' + (_sqSettings.max_squirrels || 10);
    if (grid) {
      grid.querySelector('.text-center.py-8')?.remove(); // 빈 상태 메시지 제거
      const tmp = document.createElement('div');
      tmp.innerHTML = sqCardHTML(inserted);
      grid.appendChild(tmp.firstElementChild);
    }

    // B형 소환 카드 연출
    _sqShowSummonEffect();
  } catch(e) {
    console.error(e);
    toast('❌', '오류가 발생했어요');
  }
}

// ================================================================
//  소환 카드 연출 (B형)
// ================================================================
function _sqShowSummonEffect() {
  var overlay = document.createElement('div');
  overlay.id = 'sqSummonOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(8,8,24,.7);backdrop-filter:blur(3px);animation:expFadeIn .3s ease;cursor:pointer';
  overlay.innerHTML =
    '<div style="text-align:center;animation:expScaleIn .5s ease;width:85%;max-width:340px">' +
      '<div style="width:110px;height:110px;margin:0 auto 14px;border-radius:50%;background:radial-gradient(circle,rgba(251,191,36,.25),transparent 70%);display:flex;align-items:center;justify-content:center">' +
        '<div style="width:88px;height:88px;border-radius:50%;background:radial-gradient(circle,rgba(251,191,36,.12),transparent 70%);display:flex;align-items:center;justify-content:center;border:2px solid rgba(251,191,36,.3)">' +
          '<span style="font-size:48px">🐿️</span>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:11px;letter-spacing:3px;color:var(--p-amber-400);margin-bottom:6px">✦ NEW SQUIRREL ✦</div>' +
      '<div style="font-size:22px;font-weight:900;color:white;text-shadow:0 0 20px rgba(251,191,36,.4)">아기 다람쥐 등장!</div>' +
      '<div style="font-size:12px;color:var(--p-purple-400);margin-top:6px;line-height:1.5">도토리를 먹여서 어떤 다람쥐로<br>성장할지 확인해보세요</div>' +
    '</div>';
  overlay.onclick = function() { overlay.remove(); };
  document.body.appendChild(overlay);
  // 3초 후 자동 닫힘
  setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 3000);
}

// ================================================================
//  도토리 배지 동기화
// ================================================================
function sqSyncAcornBadge() {
  const el = document.getElementById('acornBadge');
  if (el) el.textContent = myProfile.acorns.toLocaleString();
}
