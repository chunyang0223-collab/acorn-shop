/* ================================================================
   🐿️ 다람쥐 시스템 (squirrel.js)
   ================================================================ */

var _sqSquirrels = [];
var _sqSettings  = { shop_price:30, acorn_min:20, acorn_max:50, time_chance:40, time_min_hours:1, time_max_hours:8, feed_multi_min:0.5, feed_multi_max:1.3 };
var _sqAudioCtx  = null;

function _sqGetAudio() {
  if (!_sqAudioCtx) _sqAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _sqAudioCtx;
}

// 배율 ≥ 1: 뾰오오옹~ / < 1: 뿅
function _sqPlayFeedSound(isGood) {
  try {
    const ctx = _sqGetAudio();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (isGood) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.6);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18);
    }
  } catch(e) {}
}

// 성장 팡파르
function _sqPlayGrowSound() {
  try {
    const ctx = _sqGetAudio();
    [[523,0],[659,0.15],[784,0.3],[1047,0.45]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.5);
    });
  } catch(e) {}
}

// 파티클 (좌표 지정 버전)
function _sqSpawnParticlesAt(cx, cy, isGood, count = 8) {
  let container = document.getElementById('sqParticles');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sqParticles';
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    document.body.appendChild(container);
  }
  const emojis = isGood ? ['🌰','✨','⭐','🎉','💛','🌟'] : ['🌰','💨','🍂'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.style.cssText = `position:absolute;font-size:18px;animation:sqParticleFly 1.2s ease-out forwards;opacity:1;left:${cx + (Math.random()-0.5)*60}px;top:${cy}px;--dx:${(Math.random()-0.5)*200}px;--dy:-${Math.random()*180+60}px;animation-delay:${Math.random()*0.25}s`;
    p.textContent = emojis[Math.floor(Math.random()*emojis.length)];
    container.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
}
// 하위 호환
function _sqSpawnParticles(isGood, count = 8) {
  _sqSpawnParticlesAt(window.innerWidth/2, window.innerHeight*0.5, isGood, count);
}

// ================================================================
//  관리자 전용: 다람쥐 탭 강제 진입 (점검 우회)
// ================================================================
function sqAdminEnter() {
  // 관리자 화면 → 사용자 화면으로 전환
  document.getElementById('adminMode').classList.add('hidden');
  document.getElementById('userMode').classList.remove('hidden');

  // 점검 오버레이 강제 제거 후 squirrel 탭 활성화
  const tabEl = document.getElementById('utab-squirrel');
  const overlay = document.getElementById('maint-overlay-squirrel');
  if (overlay) {
    overlay.remove();
    tabEl.querySelectorAll('[data-maint-hidden]').forEach(el => {
      el.style.display = '';
      el.removeAttribute('data-maint-hidden');
    });
  }

  // 모든 탭 숨기고 squirrel만 표시
  (window.U_TABS || ['shop','gacha','quest','recycle','minigame','squirrel','ranking','mypage'])
    .forEach(t => document.getElementById('utab-'+t)?.classList.add('hidden'));
  document.querySelectorAll('#userTabBar .tab-btn').forEach(b => b.classList.remove('active'));
  tabEl.classList.remove('hidden');
  const sqBtn = document.querySelector('#userTabBar .tab-btn[onclick*="squirrel"]');
  if (sqBtn) sqBtn.classList.add('active');

  sqInit();
}

// sqAdminClose는 더 이상 필요 없지만 혹시 남아있는 참조 대비
function sqAdminClose() {}

// ================================================================
//  서브탭 전환
// ================================================================
function sqTab(tab) {
  ['my','shop','expedition'].forEach(t => {
    const el = document.getElementById('sqcontent-' + t);
    const btn = document.getElementById('sqtab-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

// ================================================================
//  초기화 (설정 + 다람쥐 목록 + 탐험 현황)
// ================================================================
async function sqInit() {
  await sqLoadSettings();
  await sqLoadSquirrels();
  await sqLoadActiveExpedition();
}

// ================================================================
//  설정 로드 (406 방지: .limit(1) 사용)
// ================================================================
async function sqLoadSettings() {
  try {
    const { data, error } = await sb.from('app_settings')
      .select('value').eq('key','squirrel_settings').limit(1);
    if (!error && data && data.length > 0) {
      _sqSettings = data[0].value;
    }
  } catch(e) { /* 기본값 유지 */ }
}

// ================================================================
//  다람쥐 목록 로드
// ================================================================
async function sqLoadSquirrels() {
  const { data } = await sb.from('squirrels')
    .select('*').eq('user_id', myProfile.id).order('created_at');
  _sqSquirrels = data || [];

  // 성장 타이머 체크 (grows_at 지난 것)
  const now = new Date();
  let grew = false;
  for (const sq of _sqSquirrels) {
    if (sq.status === 'baby' && sq.needs_time && sq.grows_at && new Date(sq.grows_at) <= now) {
      const newType = Math.random() < 0.5 ? 'explorer' : 'pet';
      await sb.from('squirrels').update({ status: newType, grows_at: null, needs_time: false }).eq('id', sq.id);
      toast('🎉', `${sq.name}이(가) ${newType === 'explorer' ? '탐험형 🗺️' : '애완형 🏡'}으로 성장했어요!`);
      grew = true;
    }
  }
  if (grew) {
    const { data: fresh } = await sb.from('squirrels').select('*').eq('user_id', myProfile.id).order('created_at');
    _sqSquirrels = fresh || [];
  }

  sqRenderGrid();
}

// ================================================================
//  그리드 렌더링
// ================================================================
function sqRenderGrid() {
  const grid = document.getElementById('squirrelGrid');
  const countEl = document.getElementById('squirrelCount');
  if (!grid) return;
  if (countEl) countEl.textContent = _sqSquirrels.length + ' / 10';

  if (_sqSquirrels.length === 0) {
    grid.innerHTML = `
      <div class="text-center py-8">
        <div style="font-size:48px">🐿️</div>
        <div class="text-sm text-gray-400 font-bold mt-2">아직 다람쥐가 없어요</div>
        <div class="text-xs text-gray-300 mt-1">상점에서 분양받아보세요!</div>
      </div>`;
    return;
  }

  grid.innerHTML = _sqSquirrels.map(sq => sqCardHTML(sq)).join('');

  // grows_at 있는 카드는 타이머 자동 시작
  _sqSquirrels.forEach(sq => {
    if (sq.status === 'baby' && sq.grows_at) {
      _sqRenderTimerCard(sq.id, sq);
    }
  });
}

function sqCardHTML(sq) {
  const isAdmin = myProfile?.is_admin;
  const borderColor = (sq.status === 'explorer' || sq.status === 'exploring') ? '#3b82f6'
                    : sq.status === 'pet' ? '#ec4899'
                    : sq.status === 'baby' ? '#fbbf24' : '#a3a3a3';
  const badgeStyle = (sq.status === 'explorer' || sq.status === 'exploring') ? 'background:#dbeafe;color:#1e40af'
                   : sq.status === 'pet' ? 'background:#fce7f3;color:#9d174d'
                   : 'background:#fef3c7;color:#92400e';
  const typeLabel = { baby:'아기 다람쥐', explorer:'탐험형 🗺️', pet:'애완형 🏡', exploring:'탐험 중 🗺️', recovering:'회복 중 😴' };
  const badgeLabel = { baby:'아기', explorer:'탐험형', pet:'애완형', exploring:'탐험중', recovering:'회복중' };

  const imgHTML = sq.status === 'baby'
    ? `<img src="images/baby-squirrel.png" style="width:56px;height:56px;object-fit:contain;border-radius:16px;background:#fff8f0;padding:4px;flex-shrink:0" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div style="display:none;font-size:44px;line-height:1;flex-shrink:0">🐿️</div>`
    : `<div style="font-size:44px;line-height:1;flex-shrink:0">${sq.status==='recovering'?'😴':sq.status==='pet'?'🐱':'🦔'}</div>`;

  let babyHTML = '';
  if (sq.status === 'baby') {
    const pct = Math.min(100, Math.round((sq.acorns_fed / sq.acorns_required) * 100));
    if (sq.grows_at) {
      babyHTML = `
        <div style="margin-top:12px">
          <div style="font-size:11px;font-weight:800;color:#9ca3af;margin-bottom:6px">🌰 성장 게이지</div>
          <div style="height:12px;border-radius:99px;background:#f3f4f6;overflow:hidden">
            <div id="sqGauge-${sq.id}" style="height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#10b981);width:${pct}%"></div>
          </div>
          <div style="font-size:11px;color:#16a34a;font-weight:800;margin-top:6px;text-align:center">🌱 성장 대기 중...</div>
        </div>`;
    } else {
      babyHTML = `
        <div style="margin-top:12px">
          <div style="font-size:11px;font-weight:800;color:#9ca3af;margin-bottom:6px">🌰 성장 게이지${isAdmin ? ` <span style="float:right;color:#f59e0b">${sq.acorns_fed}/${sq.acorns_required}</span>` : ''}</div>
          <div style="height:12px;border-radius:99px;background:#f3f4f6;overflow:hidden;margin-bottom:12px">
            <div id="sqGauge-${sq.id}" style="height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#10b981);width:${pct}%;transition:width 0.9s cubic-bezier(0.34,1.56,0.64,1),background 0.4s ease"></div>
          </div>
          <div data-feed-row style="display:flex;align-items:center;gap:8px">
            <button onclick="sqAdjFeed('${sq.id}',-1)" style="width:34px;height:34px;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;color:#92400e;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">−</button>
            <span id="sqFeedCnt-${sq.id}" style="min-width:36px;text-align:center;font-size:18px;font-weight:900;color:#78350f">5</span>
            <button onclick="sqAdjFeed('${sq.id}',1)" style="width:34px;height:34px;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;color:#92400e;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">＋</button>
            <button onclick="sqFeedSquirrel('${sq.id}')" style="flex:1;height:34px;border-radius:10px;border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white;font-size:14px;font-weight:900;cursor:pointer;box-shadow:0 3px 10px rgba(245,158,11,0.3);font-family:inherit">🌰 도토리 주기</button>
          </div>
        </div>`;
    }
  }

  let statsHTML = '';
  if (sq.status !== 'baby') {
    statsHTML = `
      <div style="display:flex;gap:8px;margin-top:12px">
        <div style="flex:1;background:#f9fafb;border-radius:12px;padding:8px 4px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">❤️ HP</div>
          <div style="font-size:16px;font-weight:900;color:#ef4444;margin-top:1px">${sq.hp_current}<span style="font-size:10px;color:#d1d5db">/${sq.stats?.hp||100}</span></div>
        </div>
        <div style="flex:1;background:#f9fafb;border-radius:12px;padding:8px 4px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">⚔️ 공격</div>
          <div style="font-size:16px;font-weight:900;color:#f97316;margin-top:1px">${sq.stats?.atk||10}</div>
        </div>
        <div style="flex:1;background:#f9fafb;border-radius:12px;padding:8px 4px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">🛡️ 방어</div>
          <div style="font-size:16px;font-weight:900;color:#3b82f6;margin-top:1px">${sq.stats?.def||5}</div>
        </div>
      </div>`;
  }

  const sellBtn = (sq.status === 'pet' || sq.status === 'explorer')
    ? `<button onclick="sqSellSquirrel('${sq.id}')" style="margin-top:12px;width:100%;height:32px;border-radius:10px;border:none;background:#fee2e2;color:#dc2626;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit">🏪 펫샵에 팔기</button>`
    : '';

  return `
    <div id="sqCard-${sq.id}" style="background:white;border-radius:24px;padding:20px;margin-bottom:14px;box-shadow:0 4px 20px rgba(0,0,0,0.07);border-left:5px solid ${borderColor};transition:border-left-color 0.5s">
      <div style="display:flex;align-items:center;gap:14px">
        ${imgHTML}
        <div style="flex:1;min-width:0">
          <div style="font-size:18px;font-weight:900;color:#1f2937">${sq.name}</div>
          <div style="font-size:12px;font-weight:800;color:#9ca3af;margin-top:2px">${typeLabel[sq.status]||sq.status}</div>
        </div>
        <span style="font-size:10px;font-weight:900;padding:3px 10px;border-radius:99px;${badgeStyle}">${badgeLabel[sq.status]||sq.status}</span>
      </div>
      ${babyHTML}${statsHTML}${sellBtn}
    </div>`;
}

// ================================================================
//  다람쥐 상세 모달
// ================================================================
function sqOpenModal(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  const emoji = sq.status === 'recovering' ? '😴' : (sq.status === 'explorer' || sq.status === 'exploring') ? '🦔' : '🐿️';
  const typeLabel = { baby:'아기 다람쥐 🐿️', explorer:'탐험형 🗺️', pet:'애완형 🏡', exploring:'탐험 중 🗺️', recovering:'회복 중 😴' };
  const pct = sq.status === 'baby' ? Math.min(100, Math.round((sq.acorns_fed / sq.acorns_required) * 100)) : 100;

  showModal(`
    <div class="text-center mb-4">
      <div style="font-size:64px">${emoji}</div>
      <div class="title-font text-xl text-gray-800 mt-1">${sq.name}</div>
      <div class="text-sm text-gray-400">${typeLabel[sq.status] || sq.status}</div>
    </div>

    ${sq.status === 'baby' ? `
    <div class="clay-card p-3 mb-3" style="background:#fffbeb">
      <div class="flex justify-between text-xs text-gray-500 mb-1 font-bold">
        <span>🌰 성장 게이지</span>${myProfile?.is_admin ? `<span>${sq.acorns_fed} / ${sq.acorns_required}</span>` : ''}
      </div>
      <div style="height:10px;border-radius:99px;background:#f3f4f6;overflow:hidden">
        <div id="sqModalGauge" style="height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#10b981);width:${pct}%;transition:width 0.9s cubic-bezier(0.34,1.56,0.64,1),background 0.4s ease"></div>
      </div>
      ${myProfile?.is_admin && sq.needs_time ? '<div class="text-xs text-amber-600 mt-2 font-bold text-center">⏳ 이 다람쥐는 도토리 외에 시간도 필요해요</div>' : ''}
      ${sq.grows_at ? '<div class="text-xs text-green-600 mt-1 font-bold text-center">🌱 성장 대기 중...</div>' : ''}
    </div>
    ${!sq.grows_at ? `
    <div class="flex gap-2 mb-3">
      <input type="number" id="sqFeedAmount" class="field" placeholder="먹일 도토리 수" min="1" style="flex:1">
      <button class="btn btn-primary" onclick="sqFeedSquirrel('${sq.id}')">🌰 먹이기</button>
    </div>` : ''}` : ''}

    ${sq.status !== 'baby' ? `
    <div class="grid grid-cols-3 gap-2 mb-3">
      <div class="clay-card p-2 text-center">
        <div class="text-xs text-gray-400 font-bold">❤️ HP</div>
        <div class="title-font text-lg text-red-500">${sq.hp_current}<span class="text-xs text-gray-300">/${sq.stats?.hp||100}</span></div>
      </div>
      <div class="clay-card p-2 text-center">
        <div class="text-xs text-gray-400 font-bold">⚔️ 공격</div>
        <div class="title-font text-lg text-orange-500">${sq.stats?.atk||10}</div>
      </div>
      <div class="clay-card p-2 text-center">
        <div class="text-xs text-gray-400 font-bold">🛡️ 방어</div>
        <div class="title-font text-lg text-blue-500">${sq.stats?.def||5}</div>
      </div>
    </div>` : ''}

    <div class="flex gap-2">
      ${(sq.status === 'pet' || sq.status === 'explorer') ? `<button class="btn btn-red btn-sm flex-1" onclick="sqSellSquirrel('${sq.id}')">🏪 펫샵에 팔기</button>` : ''}
      <button class="btn btn-gray btn-sm flex-1" onclick="closeModal()">닫기</button>
    </div>`);
}

// ================================================================
//  먹이기 - [−][수량][+][도토리 주기] 인라인 카드 방식
// ================================================================
function sqAdjFeed(id, delta) {
  const el = document.getElementById('sqFeedCnt-' + id);
  if (!el) return;
  let v = parseInt(el.textContent) + delta;
  v = Math.max(1, Math.min(99, v));
  el.textContent = v;
}

async function sqFeedSquirrel(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  const cntEl = document.getElementById('sqFeedCnt-' + id);
  const amount = cntEl ? parseInt(cntEl.textContent) : 5;
  if (!amount || amount < 1) return;
  if (!canAfford(amount)) { toast('🌰', '도토리가 부족해요'); return; }

  // 배율 적용
  const minM = _sqSettings.feed_multi_min || 0.5;
  const maxM = _sqSettings.feed_multi_max || 1.3;
  const multi   = minM + Math.random() * (maxM - minM);
  const applied = Math.round(amount * multi * 10) / 10;
  const isGood  = multi >= 1.0;

  const newFed   = Math.round((sq.acorns_fed + applied) * 10) / 10;
  const newSpent = (sq.acorns_spent || 0) + amount;
  const updates  = { acorns_fed: newFed, acorns_spent: newSpent };

  let grew = false;
  let growType = null;

  if (newFed >= sq.acorns_required) {
    if (sq.needs_time) {
      const hours = Math.floor(Math.random() * ((_sqSettings.time_max_hours||8) - (_sqSettings.time_min_hours||1) + 1)) + (_sqSettings.time_min_hours||1);
      updates.grows_at = new Date(Date.now() + hours * 3600000).toISOString();
    } else {
      growType = Math.random() < 0.5 ? 'explorer' : 'pet';
      updates.status = growType;
      grew = true;
    }
  }

  try {
    await spendAcorns(amount, '다람쥐 먹이기');
    await sb.from('squirrels').update(updates).eq('id', id);

    // ── 카드 게이지 업데이트 ──
    const newPct = Math.min(100, Math.round((newFed / sq.acorns_required) * 100));
    const gauge = document.getElementById('sqGauge-' + id);
    if (gauge) {
      gauge.style.background = isGood
        ? 'linear-gradient(90deg,#fbbf24,#f59e0b,#10b981)'
        : 'linear-gradient(90deg,#fb923c,#f97316)';
      requestAnimationFrame(() => { gauge.style.width = newPct + '%'; });
    }

    // ── 사운드 + 파티클 ──
    _sqPlayFeedSound(isGood);
    const cardEl = document.getElementById('sqCard-' + id);
    if (cardEl) {
      const r = cardEl.getBoundingClientRect();
      _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, isGood, isGood ? 10 : 5);
    }

    if (grew) {
      // 게이지 꽉 차는 거 보여준 뒤 성장 연출
      setTimeout(() => _sqGrowCard(id, sq.name, growType), 1200);
    } else if (updates.grows_at) {
      // 로컬 업데이트 후 카드 인라인 타이머로 전환 (sqLoadSquirrels 불필요)
      sq.acorns_fed = newFed;
      sq.acorns_spent = newSpent;
      sq.grows_at = updates.grows_at;
      sq.needs_time = true;
      _sqRenderTimerCard(id, sq);
      toast('⏳', `${sq.name}이(가) 성장을 준비 중이에요! 타이머가 끝나면 성장해요`);
    } else {
      // 로컬 업데이트만 (DB 재로드 없이)
      sq.acorns_fed = newFed;
      sq.acorns_spent = newSpent;
    }
  } catch(e) {
    console.error(e);
    toast('❌', '오류가 발생했어요');
  }
}

// 타이머 카드: grows_at까지 카운트다운 표시, 완료 시 자동 성장
function _sqRenderTimerCard(id, sq) {
  const cardEl = document.getElementById('sqCard-' + id);
  if (!cardEl) return;

  // 먹이기 행을 타이머 UI로 교체
  const feedRow = cardEl.querySelector('[data-feed-row]');
  const growsAt = new Date(sq.grows_at);

  function fmt(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sc = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  }

  // 게이지 100%로
  const gauge = document.getElementById('sqGauge-' + id);
  if (gauge) {
    gauge.style.background = 'linear-gradient(90deg,#fbbf24,#f59e0b,#10b981)';
    requestAnimationFrame(() => { gauge.style.width = '100%'; });
  }

  // 타이머 div 삽입 (먹이기 행 교체)
  const timerId = 'sqTimer-' + id;
  const timerHTML = `
    <div id="${timerId}" style="margin-top:12px;background:#f0fdf4;border-radius:14px;padding:12px 16px;text-align:center">
      <div style="font-size:11px;font-weight:800;color:#16a34a;margin-bottom:4px">🌱 성장 준비 중...</div>
      <div id="${timerId}-count" style="font-size:22px;font-weight:900;color:#15803d;font-variant-numeric:tabular-nums;letter-spacing:2px">--:--:--</div>
      <div style="font-size:10px;color:#86efac;margin-top:2px">타이머가 끝나면 자동으로 성장해요</div>
    </div>`;

  // 기존 먹이기 UI 제거하고 타이머 삽입
  const existing = document.getElementById(timerId);
  if (existing) existing.remove();
  if (feedRow) {
    feedRow.outerHTML = timerHTML;
  } else {
    cardEl.insertAdjacentHTML('beforeend', timerHTML);
  }

  // 카운트다운 인터벌
  const intervalId = setInterval(() => {
    const remaining = growsAt - Date.now();
    const el = document.getElementById(timerId + '-count');
    if (el) el.textContent = fmt(remaining);

    if (remaining <= 0) {
      clearInterval(intervalId);
      // 자동 성장
      const growType = Math.random() < 0.5 ? 'explorer' : 'pet';
      sb.from('squirrels').update({ status: growType, grows_at: null, needs_time: false }).eq('id', id).then(() => {
        _sqGrowCard(id, sq.name, growType);
      });
    }
  }, 1000);

  // 인터벌 ID 저장 (혹시 탭 전환 시 정리용)
  if (!window._sqTimers) window._sqTimers = {};
  window._sqTimers[id] = intervalId;
}

// B방식: 카드 흔들림 → 페이드아웃 → 기대감 딜레이 → 새 카드 페이드인
function _sqGrowCard(id, name, growType) {
  const cardEl = document.getElementById('sqCard-' + id);
  if (!cardEl) { sqLoadSquirrels(); return; }

  const r = cardEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  // 1단계: 흔들림
  cardEl.style.transition = 'none';
  cardEl.style.animation = 'sqCardShake 0.5s ease';
  _sqSpawnParticlesAt(cx, cy, true, 12);

  setTimeout(() => {
    // 2단계: 빛나며 페이드아웃
    cardEl.style.animation = '';
    cardEl.style.transition = 'opacity 0.4s, transform 0.4s, box-shadow 0.4s';
    cardEl.style.boxShadow = '0 0 40px rgba(251,191,36,0.8), 0 0 80px rgba(251,191,36,0.4)';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.85)';

    // 3단계: 1.5초 기대감 딜레이 후 새 카드 (DB 재조회 없이 로컬 처리)
    setTimeout(() => {
      _sqPlayGrowSound();
      _sqSpawnParticlesAt(cx, cy, true, 20);

      // 로컬 _sqSquirrels 업데이트
      const idx = _sqSquirrels.findIndex(s => s.id === id);
      if (idx >= 0) {
        _sqSquirrels[idx] = {
          ..._sqSquirrels[idx],
          status: growType,
          acorns_fed: _sqSquirrels[idx].acorns_fed,
        };
      }

      // 새 카드 생성
      const newSq = _sqSquirrels[idx];
      const tmp = document.createElement('div');
      tmp.innerHTML = sqCardHTML(newSq);
      const newCard = tmp.firstElementChild;
      newCard.style.opacity = '0';
      newCard.style.transform = 'scale(0.88) translateY(12px)';
      newCard.style.transition = 'opacity 0.5s, transform 0.5s';
      cardEl.replaceWith(newCard);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          newCard.style.opacity = '1';
          newCard.style.transform = 'scale(1) translateY(0)';
        });
      });

      toast('🎉', `${name}이(가) ${growType === 'explorer' ? '탐험형 🗺️' : '애완형 🏡'}으로 성장했어요!`);
      setTimeout(() => _sqSpawnParticlesAt(cx, cy, true, 15), 300);
    }, 1500);
  }, 500);
}

// ================================================================
//  구매 (관리자는 도토리 차감 없이 테스트 가능)
// ================================================================
async function sqBuySquirrel(from) {
  if (_sqSquirrels.length >= 10) {
    showModal(`<div class="text-center"><div style="font-size:40px">😅</div><div class="title-font text-lg text-gray-800 my-2">보유 한도 초과</div><div class="text-sm text-gray-500 mb-4">최대 10마리까지 보유할 수 있어요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }
  if (from === 'gacha') {
    showModal(`<div class="text-center"><div style="font-size:40px">🎰</div><div class="title-font text-lg text-gray-800 my-2">뽑기로 획득</div><div class="text-sm text-gray-500 mb-4">뽑기 탭에서 다람쥐를 획득할 수 있어요!</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  const price = _sqSettings.shop_price || 30;
  const isAdmin = myProfile?.is_admin;

  if (!canAfford(price)) {
    showModal(`<div class="text-center"><div style="font-size:40px">🌰</div><div class="title-font text-lg text-gray-800 my-2">도토리 부족</div><div class="text-sm text-gray-500 mb-4">${price} 도토리가 필요해요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  showModal(`
    <div class="text-center">
      <img src="images/baby-squirrel.png" style="width:80px;height:80px;object-fit:contain" class="mx-auto mb-2">
      <div class="title-font text-lg text-gray-800 mb-1">아기 다람쥐 분양</div>
      <div class="text-sm text-gray-500 mb-4">${isAdmin ? '관리자 테스트 모드 — 도토리 차감 없이 분양합니다' : `<strong>${price} 🌰</strong>에 분양받을까요?`}</div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="sqDoBuySquirrel(${price})">분양받기</button>
        <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
      </div>
    </div>`);
}

async function sqDoBuySquirrel(price) {
  closeModal();
  const acornsNeeded = Math.floor(Math.random() * ((_sqSettings.acorn_max||50) - (_sqSettings.acorn_min||20) + 1)) + (_sqSettings.acorn_min||20);
  const needsTime = Math.random() * 100 < (_sqSettings.time_chance||40);
  const baseHp  = 80  + Math.floor(Math.random() * 40);
  const baseAtk = 8   + Math.floor(Math.random() * 10);
  const baseDef = 4   + Math.floor(Math.random() * 8);

  try {
    await spendAcorns(price, '다람쥐 구매');

    const { error: e2 } = await sb.from('squirrels').insert({
      user_id: myProfile.id,
      name: sqRandomName(),
      status: 'baby',
      acorns_fed: 0,
      acorns_required: acornsNeeded,
      needs_time: needsTime,
      stats: { hp: baseHp, atk: baseAtk, def: baseDef },
      hp_current: baseHp,
      acquired_from: 'shop'
    });
    if (e2) throw e2;

    toast('🎉', '새 다람쥐를 분양받았어요!');
    sqTab('my');
    await sqLoadSquirrels();
  } catch(e) {
    console.error(e);
    toast('❌', '오류가 발생했어요');
  }
}

// ================================================================
//  도토리 배지 동기화 (관리자 모달 + 일반 뱃지)
// ================================================================
function sqSyncAcornBadge() {
  const main = document.getElementById('acornBadge');
  if (main) main.textContent = myProfile.acorns.toLocaleString();
}

// ================================================================
//  펫샵 판매
// ================================================================
function sqSellSquirrel(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  const statSum = (sq.stats?.hp||100) + (sq.stats?.atk||10) * 3 + (sq.stats?.def||5) * 2;
  const price = Math.max(10, 20 + Math.floor(statSum * 0.3) + Math.floor(Math.random() * 20) - 10);
  const desc = sq.status === 'explorer' ? '탐험을 즐기는 활발한 녀석이군요!' : '온순하고 귀여운 애완 다람쥐네요!';

  showModal(`
    <div class="text-center">
      <div style="font-size:40px" class="mb-2">🏪</div>
      <div class="title-font text-lg text-gray-800 mb-1">펫샵</div>
      <div class="text-sm text-gray-600 mb-3">${desc}<br>이 다람쥐는 <strong>${price} 🌰</strong>에 사겠습니다.<br>파시겠어요?</div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="sqDoSell('${id}', ${price})">판매하기</button>
        <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
      </div>
    </div>`);
}

async function sqDoSell(id, price) {
  closeModal();
  try {
    await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: price, p_reason: '다람쥐 펫샵 판매' });
    await sb.from('squirrels').delete().eq('id', id);
    myProfile.acorns += price;
    sqSyncAcornBadge();
    toast('🏪', `${price} 도토리를 받았어요!`);
    await sqLoadSquirrels();
  } catch(e) {
    toast('❌', '오류가 발생했어요');
  }
}

// ================================================================
//  탐험
// ================================================================
async function sqLoadActiveExpedition() {
  const area = document.getElementById('sqActiveExpeditionArea');
  if (!area) return;

  // maybeSingle 대신 limit(1) 사용
  const { data } = await sb.from('expeditions')
    .select('*').eq('user_id', myProfile.id).eq('status','active').limit(1);
  const exp = data?.[0] || null;

  if (exp) {
    area.innerHTML = `
      <div class="clay-card p-4">
        <div class="title-font text-base text-gray-700 mb-2">⚔️ 진행 중인 탐험</div>
        <div class="flex items-center gap-3">
          <div class="text-3xl">🗺️</div>
          <div>
            <div class="font-black text-gray-700">${exp.current_step} / ${exp.total_steps} 칸 진행</div>
            <div class="text-xs text-gray-400">획득 보상: ${(exp.loot||[]).length}개</div>
          </div>
          <button class="btn btn-primary btn-sm ml-auto" onclick="sqContinueExpedition('${exp.id}')">계속하기 →</button>
        </div>
      </div>`;
  } else {
    area.innerHTML = '';
  }
}

async function sqStartExpeditionFlow() {
  const explorers = _sqSquirrels.filter(s => s.status === 'explorer');
  if (explorers.length === 0) {
    showModal(`<div class="text-center"><div style="font-size:40px">🗺️</div><div class="title-font text-lg text-gray-800 my-2">탐험형 다람쥐가 없어요</div><div class="text-sm text-gray-500 mb-4">다람쥐를 키워서 탐험형으로 성장시켜보세요!</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  const { data: activeData } = await sb.from('expeditions')
    .select('id').eq('user_id', myProfile.id).eq('status','active').limit(1);
  if (activeData?.length) {
    showModal(`<div class="text-center"><div style="font-size:40px">⚔️</div><div class="title-font text-lg text-gray-800 my-2">이미 탐험 중이에요</div><div class="text-sm text-gray-500 mb-4">진행 중인 탐험을 완료하거나 귀환 후 다시 출발하세요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  window._sqExpSelected = [];
  showModal(`
    <div class="text-center mb-4">
      <div style="font-size:40px">🗺️</div>
      <div class="title-font text-lg text-gray-800">탐험 다람쥐 선택</div>
      <div class="text-xs text-gray-400 mt-1">최대 3마리를 선택해서 탐험을 떠나요</div>
    </div>
    <div class="space-y-2 mb-4">
      ${explorers.map(sq => `
        <div id="expcard-${sq.id}" onclick="sqToggleExpSelect('${sq.id}')" style="background:white;border-radius:16px;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:2px solid transparent;cursor:pointer;transition:all .2s">
          <div class="flex items-center gap-3">
            <div style="font-size:28px">🦔</div>
            <div class="flex-1">
              <div class="font-black text-gray-700">${sq.name}</div>
              <div class="text-xs text-gray-400">❤️${sq.hp_current} ⚔️${sq.stats?.atk||10} 🛡️${sq.stats?.def||5}</div>
            </div>
            <div id="expcheck-${sq.id}" class="text-xl">⬜</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="flex gap-2">
      <button class="btn btn-primary flex-1" onclick="sqLaunchExpedition()">⚔️ 출발!</button>
      <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
    </div>`);
}

function sqToggleExpSelect(id) {
  const idx = window._sqExpSelected.indexOf(id);
  if (idx >= 0) {
    window._sqExpSelected.splice(idx, 1);
    document.getElementById('expcard-' + id).style.borderColor = 'transparent';
    document.getElementById('expcheck-' + id).textContent = '⬜';
  } else {
    if (window._sqExpSelected.length >= 3) { toast('⚠️', '최대 3마리까지 선택할 수 있어요'); return; }
    window._sqExpSelected.push(id);
    document.getElementById('expcard-' + id).style.borderColor = '#f59e0b';
    document.getElementById('expcheck-' + id).textContent = '✅';
  }
}

async function sqLaunchExpedition() {
  if (!window._sqExpSelected?.length) { toast('⚠️', '다람쥐를 1마리 이상 선택해주세요'); return; }
  try {
    await sb.from('expeditions').insert({
      user_id: myProfile.id,
      squirrel_ids: window._sqExpSelected,
      current_step: 0,
      total_steps: 5,
      status: 'active',
      loot: []
    });
    closeModal();
    toast('🗺️', '탐험을 시작했어요!');
    await sqLoadActiveExpedition();
    sqTab('expedition');
  } catch(e) {
    toast('❌', '탐험 시작에 실패했어요');
  }
}

async function sqContinueExpedition(expId) {
  toast('🚧', '탐험 진행 화면은 준비 중이에요');
}

// ================================================================
//  이름 랜덤
// ================================================================
function sqRandomName() {
  const names = ['꼬미','솔방울','도토','밤톨','잣순이','솜이','깜찍이','하루','봄봄','단풍이','찰떡','밀키','코코','뭉치'];
  return names[Math.floor(Math.random() * names.length)];
}

// ================================================================
//  관리자 패널: 설정 로드/저장 + 목록
// ================================================================
async function sqAdminInit() {
  await sqLoadSettings();
  document.getElementById('sqSet_shopPrice').value    = _sqSettings.shop_price      || 30;
  document.getElementById('sqSet_acornMin').value     = _sqSettings.acorn_min       || 20;
  document.getElementById('sqSet_acornMax').value     = _sqSettings.acorn_max       || 50;
  document.getElementById('sqSet_timeChance').value   = _sqSettings.time_chance     || 40;
  document.getElementById('sqSet_timeMin').value      = _sqSettings.time_min_hours  || 1;
  document.getElementById('sqSet_timeMax').value      = _sqSettings.time_max_hours  || 8;
  document.getElementById('sqSet_multiMin').value     = _sqSettings.feed_multi_min  || 0.5;
  document.getElementById('sqSet_multiMax').value     = _sqSettings.feed_multi_max  || 1.3;
  await sqAdminLoadList();
}

async function sqSaveSettings() {
  const val = {
    shop_price:      parseInt(document.getElementById('sqSet_shopPrice').value)   || 30,
    acorn_min:       parseInt(document.getElementById('sqSet_acornMin').value)    || 20,
    acorn_max:       parseInt(document.getElementById('sqSet_acornMax').value)    || 50,
    time_chance:     parseInt(document.getElementById('sqSet_timeChance').value)  || 40,
    time_min_hours:  parseInt(document.getElementById('sqSet_timeMin').value)     || 1,
    time_max_hours:  parseInt(document.getElementById('sqSet_timeMax').value)     || 8,
    feed_multi_min:  parseFloat(document.getElementById('sqSet_multiMin').value)  || 0.5,
    feed_multi_max:  parseFloat(document.getElementById('sqSet_multiMax').value)  || 1.3,
  };
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'squirrel_settings', value: val }, { onConflict: 'key' });
  if (error) { toast('❌', '저장 실패'); return; }
  _sqSettings = val;
  toast('✅', '설정이 저장됐어요');
}

async function sqAdminLoadList() {
  const { data } = await sb.from('squirrels')
    .select('*, users(display_name)').order('created_at', { ascending: false }).limit(50);
  const el = document.getElementById('sqAdminList');
  if (!el) return;
  if (!data?.length) { el.innerHTML = '<div class="text-center py-4 text-gray-400">보유 다람쥐가 없어요</div>'; return; }
  const typeLabel = { baby:'아기', explorer:'탐험형', pet:'애완형', exploring:'탐험중', recovering:'회복중' };
  el.innerHTML = data.map(sq => `
    <div class="flex items-center justify-between py-2 border-b border-gray-100">
      <div>
        <span class="font-black text-gray-700 text-sm">${sq.name}</span>
        <span class="badge ml-1" style="font-size:10px">${typeLabel[sq.status]||sq.status}</span>
      </div>
      <div class="text-xs text-gray-400">${sq.users?.display_name || '알 수 없음'}</div>
    </div>`).join('');
}
