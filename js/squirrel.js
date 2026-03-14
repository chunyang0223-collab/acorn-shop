/* ================================================================
   🐿️ 다람쥐 시스템 (squirrel.js) - 상태 관리 기반 재설계
   ================================================================
   핵심 설계:
   - _sqState[id] = 'idle' | 'busy' 로 카드별 처리 상태 추적
   - 모든 액션 진입 시 busy 체크 → busy면 즉시 리턴
   - sqLoadSquirrels()는 초기 진입·탐험 시작에만 호출
   - 나머지는 _sqSquirrels 로컬 업데이트 + 카드 DOM 직접 갱신
   ================================================================ */

// ── 전역 상태 ──
var _sqSquirrels = [];   // 로컬 캐시
var _sqState     = {};   // id → 'idle' | 'busy'  (처리 중 플래그)
var _sqTimers    = {};   // id → intervalId (카운트다운 인터벌)
var _sqSettings  = {
  shop_price: 30, acorn_min: 20, acorn_max: 50,
  time_chance: 40, time_min_minutes: 10, time_max_minutes: 60,
  feed_multi_min: 0.5, feed_multi_max: 1.3,
  stat_hp_min: 60, stat_hp_max: 120,
  stat_atk_min: 8, stat_atk_max: 20,
  stat_def_min: 4, stat_def_max: 14,
  sell_price_base: 20, sell_price_max: 80,
  recovery_base_minutes: 60, recovery_instant_cost: 15,
  time_trigger_min: 40, time_trigger_max: 80
};
var _sqAudioCtx = null;

// ── 스프라이트 목록 (17종) ──
var _sqSprites = ['sq_acorn','sq_white','sq_choco','sq_beige','sq_gold','sq_pink','sq_gray','sq_darkbrown','sq_stripe','sq_ribbon1','sq_ribbon2','sq_mahogany','sq_cream','sq_mocha','sq_silver','sq_heart','sq_curious'];
function _sqRandomSprite() {
  return _sqSprites[Math.floor(Math.random() * _sqSprites.length)];
}

// ── 등급 시스템 ──
// HP/120 + ATK/20 + DEF/14 평균 → 백분율
function _sqCalcGrade(sq) {
  var maxHp = _sqSettings.stat_hp_max || 120;
  var maxAtk = _sqSettings.stat_atk_max || 20;
  var maxDef = _sqSettings.stat_def_max || 14;
  var hp = sq.stats?.hp || 60;
  var atk = sq.stats?.atk || 8;
  var def = sq.stats?.def || 4;
  var score = ((hp / maxHp) + (atk / maxAtk) + (def / maxDef)) / 3 * 100;
  if (score >= 90) return 'legend';
  if (score >= 80) return 'unique';
  if (score >= 70) return 'epic';
  if (score >= 60) return 'rare';
  return 'normal';
}

function _sqGradeStyle(grade) {
  switch(grade) {
    case 'legend': return { label:'레전드', border:'border:3px solid #ef4444', shadow:'0 0 12px rgba(239,68,68,.5),0 0 24px rgba(239,68,68,.2)', color:'#dc2626', bg:'#fef2f2' };
    case 'unique': return { label:'유일', border:'border:3px solid #eab308', shadow:'0 0 10px rgba(234,179,8,.4)', color:'#ca8a04', bg:'#fefce8' };
    case 'epic':   return { label:'희귀', border:'border:3px solid #3b82f6', shadow:'0 0 8px rgba(59,130,246,.3)', color:'#2563eb', bg:'#eff6ff' };
    case 'rare':   return { label:'레어', border:'border:3px solid #22c55e', shadow:'0 0 8px rgba(34,197,94,.3)', color:'#16a34a', bg:'#f0fdf4' };
    default:       return { label:'일반', border:'border:3px solid #8896a4', shadow:'0 0 4px rgba(100,120,140,.2)', color:'#6b7280', bg:'#eef1f5' };
  }
}

// ── 상태 관리 헬퍼 ──
function _sqIsBusy(id) { return _sqState[id] === 'busy'; }
function _sqSetBusy(id) { _sqState[id] = 'busy'; }
function _sqSetIdle(id) { _sqState[id] = 'idle'; }

// ── 로컬 캐시 업데이트 ──
function _sqUpdate(id, patch) {
  const idx = _sqSquirrels.findIndex(s => s.id === id);
  if (idx >= 0) Object.assign(_sqSquirrels[idx], patch);
}

// ── 카운트다운 인터벌 정리 ──
function _sqClearTimer(id) {
  if (_sqTimers[id]) { clearInterval(_sqTimers[id]); delete _sqTimers[id]; }
}

// ================================================================
//  사운드
// ================================================================
function _sqGetAudio() {
  if (!_sqAudioCtx) _sqAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _sqAudioCtx;
}

function _sqPlayFeedSound(isGood) {
  try {
    const ctx = _sqGetAudio();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
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

// ================================================================
//  파티클
// ================================================================
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
function _sqSpawnParticles(isGood, count = 8) {
  _sqSpawnParticlesAt(window.innerWidth/2, window.innerHeight*0.5, isGood, count);
}

// ================================================================
//  관리자 전용: squirrel 탭 강제 진입
// ================================================================
function sqAdminEnter() {
  document.getElementById('adminMode').classList.add('hidden');
  document.getElementById('userMode').classList.remove('hidden');
  document.getElementById('sqAdminBackBar')?.classList.remove('hidden');
  const sqBtn = document.querySelector('#userTabBar .tab-btn[onclick*="squirrel"]');
  if (sqBtn) sqBtn.click();
}

function sqAdminBack() {
  if (typeof _sqUnsubscribe === 'function') _sqUnsubscribe();
  document.getElementById('sqAdminBackBar')?.classList.add('hidden');
  document.getElementById('userMode').classList.add('hidden');
  document.getElementById('adminMode').classList.remove('hidden');
}
function sqAdminClose() {}

// ================================================================
//  서브탭 전환
// ================================================================
function sqTab(tab) {
  ['my','shop','expedition'].forEach(t => {
    document.getElementById('sqcontent-' + t)?.classList.toggle('hidden', t !== tab);
    document.getElementById('sqtab-' + t)?.classList.toggle('active', t === tab);
  });
}

// ================================================================
//  초기화
// ================================================================
async function sqInit() {
  await sqLoadSettings();
  await sqLoadSquirrels();
  await sqLoadActiveExpedition();
  _sqSubscribe();
}

// ================================================================
//  Realtime 구독 (다른 탭/기기 변경 사항 반영)
// ================================================================
// ── 폴링 기반 동기화 (현재 Supabase 경량 클라이언트가 Realtime 웹소켓 미지원)
// 다른 탭/기기 변경을 5초마다 DB 조회로 감지
var _sqPollSnapshot = {}; // id → updated_at 스냅샷

function _sqSubscribe() {
  _sqUnsubscribe();
  _sqTakePollSnapshot();
  window._sqPollInterval = setInterval(_sqPoll, 5000);
}

function _sqUnsubscribe() {
  if (window._sqPollInterval) {
    clearInterval(window._sqPollInterval);
    window._sqPollInterval = null;
  }
  _sqPollSnapshot = {};
}

function _sqTakePollSnapshot() {
  _sqPollSnapshot = {};
  _sqSquirrels.forEach(sq => { _sqPollSnapshot[sq.id] = sq.updated_at || sq.created_at; });
}

async function _sqPoll() {
  try {
    const { data } = await sb.from('squirrels')
      .select('*').eq('user_id', myProfile.id).order('created_at');
    if (!data) return;

    const fresh = data;
    const freshIds = new Set(fresh.map(s => s.id));
    const localIds = new Set(_sqSquirrels.map(s => s.id));

    // INSERT: 새로 생긴 것
    fresh.forEach(sq => {
      if (!localIds.has(sq.id)) {
        _sqSquirrels.push(sq);
        _sqState[sq.id] = 'idle';
        const grid = document.getElementById('squirrelGrid');
        if (grid) {
          grid.querySelector('.text-center.py-8')?.remove();
          const tmp = document.createElement('div');
          tmp.innerHTML = sqCardHTML(sq);
          grid.appendChild(tmp.firstElementChild);
          if (sq.status === 'baby' && sq.grows_at) {
            _sqSetBusy(sq.id);
            _sqStartTimer(sq.id, sq);
          }
        }
        const countEl = document.getElementById('squirrelCount');
        if (countEl) countEl.textContent = _sqSquirrels.length + ' / 10';
      }
    });

    // DELETE: 사라진 것
    _sqSquirrels.forEach(sq => {
      if (!freshIds.has(sq.id)) {
        _sqSquirrels = _sqSquirrels.filter(s => s.id !== sq.id);
        delete _sqState[sq.id];
        _sqClearTimer(sq.id);
        document.getElementById('sqCard-' + sq.id)?.remove();
        const countEl = document.getElementById('squirrelCount');
        if (countEl) countEl.textContent = _sqSquirrels.length + ' / 10';
      }
    });

    // UPDATE: updated_at 변경된 것
    fresh.forEach(updated => {
      const id = updated.id;
      if (_sqIsBusy(id)) return; // 로컬 처리 중이면 무시
      const snapshot = _sqPollSnapshot[id];
      if (snapshot && snapshot === (updated.updated_at || updated.created_at)) return; // 변경 없음

      const idx = _sqSquirrels.findIndex(s => s.id === id);
      if (idx < 0) return;
      const prev = _sqSquirrels[idx];
      _sqSquirrels[idx] = updated;

      if (prev.status === 'baby' && updated.status !== 'baby') {
        _sqClearTimer(id);
        _sqGrowCard(id, updated.name, updated.status);
      } else if (!prev.grows_at && updated.grows_at) {
        _sqSetBusy(id);
        const gauge = document.getElementById('sqGauge-' + id);
        if (gauge) requestAnimationFrame(() => { gauge.style.width = '100%'; });
        _sqStartTimer(id, updated);
      } else if (prev.grows_at && !updated.grows_at && updated.status === 'baby') {
        _sqClearTimer(id);
        _sqShowFeedButtons(id);
      } else if (updated.status === 'baby') {
        const pct = Math.min(100, Math.round((updated.acorns_fed / updated.acorns_required) * 100));
        const gauge = document.getElementById('sqGauge-' + id);
        if (gauge) requestAnimationFrame(() => { gauge.style.width = pct + '%'; });
      }
      // recovering ↔ explorer 전환 감지 → 카드 교체
      if ((prev.status === 'recovering' && updated.status === 'explorer') ||
          (prev.status === 'explorer' && updated.status === 'recovering') ||
          (prev.status === 'exploring' && updated.status === 'recovering')) {
        _sqClearTimer(id);
        const cardEl = document.getElementById('sqCard-' + id);
        if (cardEl) {
          const tmp = document.createElement('div');
          tmp.innerHTML = sqCardHTML(updated);
          cardEl.replaceWith(tmp.firstElementChild);
          if (updated.status === 'recovering' && updated.recovers_at) {
            _sqStartRecoverTimer(id, updated);
          }
        }
      }
    });

    // 스냅샷 갱신
    _sqTakePollSnapshot();
  } catch(e) {}
}

// ================================================================
//  설정 로드
// ================================================================
async function sqLoadSettings() {
  try {
    const { data, error } = await sb.from('app_settings')
      .select('value').eq('key','squirrel_settings').limit(1);
    if (!error && data?.length > 0) _sqSettings = { ..._sqSettings, ...data[0].value };
  } catch(e) {}
}

// ================================================================
//  다람쥐 목록 로드 (초기 진입·탐험 시작에만 사용)
// ================================================================
async function sqLoadSquirrels() {
  const { data } = await sb.from('squirrels')
    .select('*').eq('user_id', myProfile.id).order('created_at');
  _sqSquirrels = data || [];

  // grows_at 만료 서버 체크 → grows_at만 null로, 성장은 사용자가 버튼으로
  const now = new Date();
  for (const sq of _sqSquirrels) {
    if (sq.status === 'baby' && sq.grows_at && new Date(sq.grows_at) <= now) {
      // grows_at 만료 → 성장 준비 완료 상태 (acorns_fed를 acorns_required로 세팅)
      await sb.from('squirrels').update({ grows_at: null, acorns_fed: sq.acorns_required }).eq('id', sq.id);
      sq.grows_at = null;
      sq.acorns_fed = sq.acorns_required;
    }
    // recovers_at 만료 체크: 회복 완료 → explorer로 복원, HP 풀회복
    if (sq.status === 'recovering' && sq.recovers_at && new Date(sq.recovers_at) <= now) {
      const fullHp = sq.stats?.hp || 100;
      await sb.from('squirrels').update({ status: 'explorer', recovers_at: null, hp_current: fullHp }).eq('id', sq.id);
      sq.status = 'explorer'; sq.recovers_at = null; sq.hp_current = fullHp;
    }
  }

  // 상태 초기화 (새로 불러온 목록에 맞게)
  _sqState = {};
  _sqSquirrels.forEach(sq => { _sqState[sq.id] = 'idle'; });

  sqRenderGrid();
}

// ================================================================
//  그리드 렌더링 (초기 진입·전체 재렌더 시에만)
// ================================================================
function sqRenderGrid() {
  const grid = document.getElementById('squirrelGrid');
  if (!grid) return;
  document.getElementById('squirrelCount')?.setAttribute('textContent', _sqSquirrels.length + ' / 10');
  const countEl = document.getElementById('squirrelCount');
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

  // 필터
  const filter = window._sqFilter || 'all';
  const filtered = filter === 'all' ? _sqSquirrels : _sqSquirrels.filter(sq => {
    if (filter === 'baby') return sq.status === 'baby';
    if (filter === 'pet') return sq.status === 'pet';
    if (filter === 'explorer') return sq.status === 'explorer' || sq.status === 'exploring' || sq.status === 'recovering';
    return true;
  });

  const filterBtn = (val, label) => {
    const active = filter === val;
    return `<button onclick="window._sqFilter='${val}';sqRenderGrid()" style="padding:5px 14px;border-radius:20px;border:1.5px solid ${active ? '#f59e0b' : '#e5e7eb'};background:${active ? '#fef3c7' : 'white'};color:${active ? '#92400e' : '#6b7280'};font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .15s">${label}</button>`;
  };

  const filterHTML = `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
    ${filterBtn('all', '전체 ' + _sqSquirrels.length)}
    ${filterBtn('baby', '🐿️ 아기')}
    ${filterBtn('explorer', '🗺️ 탐험형')}
    ${filterBtn('pet', '🏡 애완형')}
  </div>`;

  grid.innerHTML = filterHTML + (filtered.length > 0
    ? filtered.map(sq => sqCardHTML(sq)).join('')
    : '<div class="text-center py-4 text-sm text-gray-400">해당하는 다람쥐가 없어요</div>');

  // grows_at 남아있는 카드는 타이머 재개
  _sqSquirrels.forEach(sq => {
    if (sq.status === 'baby' && sq.grows_at) {
      _sqSetBusy(sq.id);
      _sqStartTimer(sq.id, sq);
    }
    // 회복 중 타이머도 시작
    if (sq.status === 'recovering' && sq.recovers_at) {
      _sqStartRecoverTimer(sq.id, sq);
    }
  });
}

// ================================================================
//  카드 HTML 생성
// ================================================================
function sqCardHTML(sq) {
  const borderColor = (sq.status === 'explorer' || sq.status === 'exploring') ? '#3b82f6'
                    : sq.status === 'pet' ? '#ec4899'
                    : sq.status === 'recovering' ? '#f59e0b'
                    : sq.status === 'baby' ? '#fbbf24' : '#a3a3a3';
  const badgeStyle  = (sq.status === 'explorer' || sq.status === 'exploring') ? 'background:#dbeafe;color:#1e40af'
                    : sq.status === 'pet' ? 'background:#fce7f3;color:#9d174d'
                    : sq.status === 'recovering' ? 'background:#fef3c7;color:#92400e'
                    : 'background:#fef3c7;color:#92400e';
  const typeLabel   = { baby:'아기 다람쥐', explorer:'탐험형 🗺️', pet:'애완형 🏡', exploring:'탐험 중 🗺️', recovering:'회복 중 😴' };
  const badgeLabel  = { baby:'아기', explorer:'탐험형', pet:'애완형', exploring:'탐험중', recovering:'회복중' };

  const spriteBase = sq.sprite || 'sq_acorn';
  const spriteFile = (sq.status === 'recovering' || sq.hp_current <= 0) ? spriteBase + '_defeat' : spriteBase;
  const grade = (sq.status !== 'baby') ? _sqCalcGrade(sq) : null;
  const gs = grade ? _sqGradeStyle(grade) : null;

  let imgHTML;
  if (sq.status === 'baby') {
    imgHTML = `<img src="images/baby-squirrel.png" style="width:56px;height:56px;object-fit:contain;border-radius:16px;background:#fff8f0;padding:4px;flex-shrink:0" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div style="display:none;font-size:44px;line-height:1;flex-shrink:0">🐿️</div>`;
  } else {
    imgHTML = `<div style="border-radius:18px;${gs.border};box-shadow:${gs.shadow};padding:2px;flex-shrink:0;background:${gs.bg}">` +
      `<img src="images/squirrels/${spriteFile}.png" style="width:52px;height:52px;object-fit:contain;border-radius:14px;display:block" onerror="this.outerHTML='<div style=\\'font-size:40px;line-height:52px;text-align:center\\'>🦔</div>'">` +
    `</div>`;
  }

  let babyHTML = '';
  if (sq.status === 'baby') {
    const pct = Math.min(100, Math.round((sq.acorns_fed / sq.acorns_required) * 100));
    const isReadyToGrow = !sq.grows_at && sq.acorns_fed >= sq.acorns_required;

    let feedAreaHTML = '';
    if (sq.grows_at) {
      // 타이머 진행 중
      feedAreaHTML = `<div style="background:#f0fdf4;border-radius:14px;padding:12px 16px;text-align:center">
        <div style="font-size:11px;font-weight:800;color:#16a34a;margin-bottom:4px">🌱 성장 준비 중...</div>
        <div id="sqTimer-${sq.id}" style="font-size:22px;font-weight:900;color:#15803d;font-variant-numeric:tabular-nums;letter-spacing:2px">--:--:--</div>
        <div style="font-size:10px;color:#86efac;margin-top:2px">타이머가 끝나면 다시 먹일 수 있어요</div>
      </div>`;
    } else if (isReadyToGrow) {
      // 성장 준비 완료 → 결과 확인 버튼
      feedAreaHTML = `<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:14px;padding:16px;text-align:center;border:2px solid rgba(251,191,36,.3)">
        <div style="font-size:28px;margin-bottom:6px;animation:sqReadyBounce 1s ease-in-out infinite">🎁</div>
        <div style="font-size:14px;font-weight:900;color:#78350f;margin-bottom:4px">성장 완료!</div>
        <div style="font-size:11px;color:#92400e;margin-bottom:10px">어떤 다람쥐가 되었을까요?</div>
        <button onclick="sqRevealGrowth('${sq.id}')" style="width:100%;height:40px;border-radius:12px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 4px 0 #b45309,0 6px 16px rgba(217,119,6,.3);font-family:inherit;transition:transform .1s,box-shadow .1s" onmousedown="this.style.transform='translateY(3px)';this.style.boxShadow='0 1px 0 #b45309'" onmouseup="this.style.transform='';this.style.boxShadow='0 4px 0 #b45309,0 6px 16px rgba(217,119,6,.3)'">✨ 결과 확인하기!</button>
      </div>`;
    } else {
      // 일반 먹이주기 UI
      feedAreaHTML = `<div style="display:flex;align-items:center;gap:8px">
        <button onclick="sqAdjFeed('${sq.id}',-1)" style="width:34px;height:34px;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;color:#92400e;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">−</button>
        <span id="sqFeedCnt-${sq.id}" style="min-width:36px;text-align:center;font-size:18px;font-weight:900;color:#78350f">5</span>
        <button onclick="sqAdjFeed('${sq.id}',1)" style="width:34px;height:34px;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;color:#92400e;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">＋</button>
        <button onclick="sqFeedSquirrel('${sq.id}')" style="flex:1;height:34px;border-radius:10px;border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white;font-size:14px;font-weight:900;cursor:pointer;box-shadow:0 3px 10px rgba(245,158,11,0.3);font-family:inherit">🌰 도토리 주기</button>
      </div>`;
    }

    babyHTML = `
      <div style="margin-top:12px">
        <div style="font-size:11px;font-weight:800;color:#9ca3af;margin-bottom:6px">🌰 성장 게이지</div>
        <div style="height:12px;border-radius:99px;background:#f3f4f6;overflow:hidden;margin-bottom:12px">
          <div id="sqGauge-${sq.id}" style="height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#10b981);width:${pct}%;transition:width 0.9s cubic-bezier(0.34,1.56,0.64,1),background 0.4s ease"></div>
        </div>
        <div id="sqFeedArea-${sq.id}">${feedAreaHTML}</div>
      </div>`;
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

  // 회복 중 UI
  let recoverHTML = '';
  if (sq.status === 'recovering' && sq.recovers_at) {
    const maxCost = _sqSettings.recovery_instant_cost || 15;
    const baseMinutes = _sqSettings.recovery_base_minutes || 60;
    // 남은 시간 비율로 현재 비용 계산
    const remaining = Math.max(0, new Date(sq.recovers_at) - Date.now());
    const totalMs = baseMinutes * 60000;
    const currentCost = Math.max(1, Math.ceil(maxCost * (remaining / totalMs)));
    recoverHTML = `
      <div id="sqRecoverArea-${sq.id}" style="margin-top:12px;background:#fef3c7;border-radius:14px;padding:14px 16px;text-align:center">
        <div style="font-size:11px;font-weight:800;color:#92400e;margin-bottom:4px">😴 회복 중...</div>
        <div id="sqRecoverTimer-${sq.id}" style="font-size:20px;font-weight:900;color:#b45309;font-variant-numeric:tabular-nums;letter-spacing:2px">--:--:--</div>
        <div style="font-size:10px;color:#d97706;margin-top:2px;margin-bottom:10px">회복이 끝나면 다시 탐험할 수 있어요</div>
        <button id="sqRecoverBtn-${sq.id}" onclick="sqInstantRecover('${sq.id}')" style="width:100%;height:36px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-size:13px;font-weight:900;cursor:pointer;box-shadow:0 3px 10px rgba(217,119,6,0.3);font-family:inherit">🌰 ${currentCost} 도토리로 즉시 회복</button>
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
          <div style="font-size:18px;font-weight:900;color:#1f2937;cursor:pointer" onclick="sqEditName('${sq.id}')" title="클릭하여 이름 변경">${sq.name} <span style="font-size:11px;color:#d1d5db">✏️</span>${gs ? ` <span style="font-size:9px;font-weight:900;color:${gs.color};background:${gs.color}15;padding:1px 6px;border-radius:8px;vertical-align:middle">${gs.label}</span>` : ''}</div>
          <div style="font-size:12px;font-weight:800;color:#9ca3af;margin-top:2px">${typeLabel[sq.status]||sq.status}</div>
        </div>
        <span style="font-size:10px;font-weight:900;padding:3px 10px;border-radius:99px;${badgeStyle}">${badgeLabel[sq.status]||sq.status}</span>
      </div>
      ${babyHTML}${statsHTML}${recoverHTML}${sellBtn}
    </div>`;
}

// ================================================================
//  카드 feedArea 교체 헬퍼
// ================================================================
function _sqShowFeedButtons(id) {
  const area = document.getElementById('sqFeedArea-' + id);
  if (!area) return;
  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <button onclick="sqAdjFeed('${id}',-1)" style="width:34px;height:34px;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;color:#92400e;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">−</button>
      <span id="sqFeedCnt-${id}" style="min-width:36px;text-align:center;font-size:18px;font-weight:900;color:#78350f">5</span>
      <button onclick="sqAdjFeed('${id}',1)" style="width:34px;height:34px;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;color:#92400e;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">＋</button>
      <button onclick="sqFeedSquirrel('${id}')" style="flex:1;height:34px;border-radius:10px;border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white;font-size:14px;font-weight:900;cursor:pointer;box-shadow:0 3px 10px rgba(245,158,11,0.3);font-family:inherit">🌰 도토리 주기</button>
    </div>`;
}

function _sqShowTimerUI(id) {
  const area = document.getElementById('sqFeedArea-' + id);
  if (!area) return;
  area.innerHTML = `
    <div style="background:#f0fdf4;border-radius:14px;padding:12px 16px;text-align:center">
      <div style="font-size:11px;font-weight:800;color:#16a34a;margin-bottom:4px">🌱 성장 준비 중...</div>
      <div id="sqTimer-${id}" style="font-size:22px;font-weight:900;color:#15803d;font-variant-numeric:tabular-nums;letter-spacing:2px">--:--:--</div>
      <div style="font-size:10px;color:#86efac;margin-top:2px">타이머가 끝나면 다시 먹일 수 있어요</div>
    </div>`;
}

// ================================================================
//  타이머 시작 (grows_at 카운트다운)
// ================================================================
function _sqStartTimer(id, sq) {
  _sqClearTimer(id); // 기존 인터벌 정리
  _sqShowTimerUI(id);

  const growsAt = new Date(sq.grows_at);

  function fmt(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  }

  _sqTimers[id] = setInterval(async () => {
    const remaining = growsAt - Date.now();
    const el = document.getElementById('sqTimer-' + id);
    if (el) el.textContent = fmt(remaining);

    if (remaining <= 0) {
      _sqClearTimer(id);
      _sqUpdate(id, { grows_at: null });
      _sqSetIdle(id);

      // 먹이 다 먹은 상태 → 성장 준비 완료 UI
      const curSq = _sqSquirrels.find(s => s.id === id);
      if (curSq && curSq.acorns_fed >= curSq.acorns_required) {
        // acorns_fed를 확실히 맞추고 카드 교체
        const cardEl = document.getElementById('sqCard-' + id);
        if (cardEl) {
          const tmp = document.createElement('div');
          tmp.innerHTML = sqCardHTML(curSq);
          cardEl.replaceWith(tmp.firstElementChild);
        }
        toast('🎁', `${sq.name}의 성장이 완료되었어요! 결과를 확인해보세요!`);
      } else {
        // 중간 쉬는 타이머 → 도토리 주기 버튼 복원
        _sqShowFeedButtons(id);
        toast('🌱', `${sq.name}이(가) 쉬었어요! 이제 다시 먹일 수 있어요`);
      }
    }
  }, 1000);
}

// ================================================================
//  회복 타이머 (recovers_at 카운트다운)
// ================================================================
function _sqStartRecoverTimer(id, sq) {
  _sqClearTimer(id);

  const recoversAt = new Date(sq.recovers_at);

  function fmt(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  }

  _sqTimers[id] = setInterval(async () => {
    const remaining = recoversAt - Date.now();
    const el = document.getElementById('sqRecoverTimer-' + id);
    if (el) el.textContent = fmt(remaining);

    // 남은 시간 비율에 따라 즉시회복 비용 갱신
    const maxCost = _sqSettings.recovery_instant_cost || 15;
    const baseMinutes = _sqSettings.recovery_base_minutes || 60;
    const totalMs = baseMinutes * 60000;
    const currentCost = remaining > 0 ? Math.max(1, Math.ceil(maxCost * (remaining / totalMs))) : 0;
    const btn = document.getElementById('sqRecoverBtn-' + id);
    if (btn && remaining > 0) btn.textContent = '🌰 ' + currentCost + ' 도토리로 즉시 회복';

    if (remaining <= 0) {
      _sqClearTimer(id);
      // 회복 완료 → explorer 복원 + HP 풀회복
      const fullHp = sq.stats?.hp || 100;
      try {
        await sb.from('squirrels').update({ status: 'explorer', recovers_at: null, hp_current: fullHp }).eq('id', id);
      } catch(e) {}
      _sqUpdate(id, { status: 'explorer', recovers_at: null, hp_current: fullHp });
      _sqSetIdle(id);
      // 카드 교체
      const cardEl = document.getElementById('sqCard-' + id);
      if (cardEl) {
        const updatedSq = _sqSquirrels.find(s => s.id === id);
        if (updatedSq) {
          const tmp = document.createElement('div');
          tmp.innerHTML = sqCardHTML(updatedSq);
          cardEl.replaceWith(tmp.firstElementChild);
        }
      }
      toast('💚', `${sq.name}이(가) 완전히 회복했어요!`);
    }
  }, 1000);
}

// ================================================================
//  즉시 회복 (도토리 소모)
// ================================================================
async function sqInstantRecover(id) {
  if (_sqIsBusy(id)) return;
  _sqSetBusy(id);

  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq || sq.status !== 'recovering') { _sqSetIdle(id); return; }

  // 남은 시간 비율로 비용 계산
  const maxCost = _sqSettings.recovery_instant_cost || 15;
  const baseMinutes = _sqSettings.recovery_base_minutes || 60;
  const totalMs = baseMinutes * 60000;
  const remaining = Math.max(0, new Date(sq.recovers_at) - Date.now());
  const cost = remaining > 0 ? Math.max(1, Math.ceil(maxCost * (remaining / totalMs))) : 0;

  if (cost <= 0) {
    // 이미 회복 완료됨
    _sqSetIdle(id);
    toast('💚', '이미 회복이 완료되었어요!');
    return;
  }

  if (!canAfford(cost)) {
    toast('🌰', '도토리가 부족해요 (' + cost + '개 필요)');
    _sqSetIdle(id);
    return;
  }

  try {
    await spendAcorns(cost, '다람쥐 즉시회복');
    const fullHp = sq.stats?.hp || 100;
    await sb.from('squirrels').update({ status: 'explorer', recovers_at: null, hp_current: fullHp }).eq('id', id);
    _sqClearTimer(id);
    _sqUpdate(id, { status: 'explorer', recovers_at: null, hp_current: fullHp });
    _sqSetIdle(id);

    // 카드 교체
    const cardEl = document.getElementById('sqCard-' + id);
    if (cardEl) {
      const updatedSq = _sqSquirrels.find(s => s.id === id);
      if (updatedSq) {
        const tmp = document.createElement('div');
        tmp.innerHTML = sqCardHTML(updatedSq);
        cardEl.replaceWith(tmp.firstElementChild);
      }
    }

    _sqPlayFeedSound(true);
    toast('💚', `${sq.name}이(가) 즉시 회복했어요!`);
    if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
  } catch(e) {
    console.error(e);
    toast('❌', '회복 처리 중 오류');
    _sqSetIdle(id);
  }
}

// ================================================================
//  성장 연출 (흔들림 → 페이드아웃 → 새 카드 페이드인)
// ================================================================
function _sqGrowCard(id, name, growType) {
  const cardEl = document.getElementById('sqCard-' + id);
  if (!cardEl) {
    // 카드가 DOM에 없으면 로컬 상태만 갱신하고 카드 새로 추가
    _sqUpdate(id, { status: growType, grows_at: null });
    _sqSetIdle(id);
    return;
  }

  const r = cardEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

  // 흔들림 + 긴장감 사운드 (두근두근 → 서스펜스)
  cardEl.style.transition = 'none';
  cardEl.style.animation = 'sqCardShake 0.5s ease';
  _sqSpawnParticlesAt(cx, cy, true, 12);
  // 두근두근 리듬
  _playTone(220, 'sine', 0.12, 0.18);
  setTimeout(() => _playTone(220, 'sine', 0.12, 0.18), 200);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 400);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 600);
  // 서스펜스 상승
  setTimeout(() => _playTone(310, 'triangle', 0.2, 0.15), 800);
  setTimeout(() => _playTone(370, 'triangle', 0.2, 0.15), 1000);
  setTimeout(() => _playTone(440, 'triangle', 0.25, 0.15), 1200);
  setTimeout(() => _playTone(523, 'triangle', 0.3, 0.12), 1400);

  setTimeout(() => {
    cardEl.style.animation = '';
    cardEl.style.transition = 'opacity 0.4s, transform 0.4s, box-shadow 0.4s';
    cardEl.style.boxShadow = '0 0 40px rgba(251,191,36,0.8), 0 0 80px rgba(251,191,36,0.4)';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.85)';

    setTimeout(() => {
      _sqPlayGrowSound();
      _sqSpawnParticlesAt(cx, cy, true, 20);

      // 로컬 캐시 업데이트
      _sqUpdate(id, { status: growType, grows_at: null });
      _sqSetIdle(id);

      const sq = _sqSquirrels.find(s => s.id === id);
      if (!sq) return;

      const tmp = document.createElement('div');
      tmp.innerHTML = sqCardHTML(sq);
      const newCard = tmp.firstElementChild;
      newCard.style.opacity = '0';
      newCard.style.transform = 'scale(0.88) translateY(12px)';
      newCard.style.transition = 'opacity 0.5s, transform 0.5s';
      cardEl.replaceWith(newCard);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        newCard.style.opacity = '1';
        newCard.style.transform = 'scale(1) translateY(0)';
      }));

      toast('🎉', `${name}이(가) ${growType === 'explorer' ? '탐험형 🗺️' : '애완형 🏡'}으로 성장했어요!`);
      setTimeout(() => _sqSpawnParticlesAt(cx, cy, true, 15), 300);
    }, 1500);
  }, 500);
}

// ================================================================
//  먹이기
// ================================================================
function sqAdjFeed(id, delta) {
  const el = document.getElementById('sqFeedCnt-' + id);
  if (!el) return;
  let v = parseInt(el.textContent) + delta;
  el.textContent = Math.max(1, Math.min(99, v));
}

async function sqFeedSquirrel(id) {
  // ── busy 체크: 처리 중이면 즉시 리턴 ──
  if (_sqIsBusy(id)) return;
  _sqSetBusy(id);

  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) { _sqSetIdle(id); return; }

  const cntEl = document.getElementById('sqFeedCnt-' + id);
  const amount = cntEl ? parseInt(cntEl.textContent) : 5;
  if (!amount || amount < 1) { _sqSetIdle(id); return; }
  if (!canAfford(amount)) { toast('🌰', '도토리가 부족해요'); _sqSetIdle(id); return; }

  // 버튼 즉시 비활성화
  const feedArea = document.getElementById('sqFeedArea-' + id);
  if (feedArea) feedArea.querySelectorAll('button').forEach(b => {
    b.disabled = true; b.style.opacity = '0.4'; b.style.pointerEvents = 'none';
  });

  // 배율 계산
  const minM = _sqSettings.feed_multi_min || 0.5;
  const maxM = _sqSettings.feed_multi_max || 1.3;
  const multi   = minM + Math.random() * (maxM - minM);
  const applied = Math.round(amount * multi * 10) / 10;
  const isGood  = multi >= 1.0;

  const newFed   = Math.round(sq.acorns_fed + applied); // integer 컬럼 — 소수 불가
  const newSpent = (sq.acorns_spent || 0) + amount;
  const updates  = { acorns_fed: newFed, acorns_spent: newSpent };

  // ── 성장 조건 판단 ──
  const prevPct    = Math.min(100, Math.round((sq.acorns_fed / sq.acorns_required) * 100));
  const newPct     = Math.min(100, Math.round((newFed / sq.acorns_required) * 100));
  const triggerPct = sq.time_trigger_pct || null;

  let action = 'none'; // 'timer' | 'grow' | 'none'

  // 1) needs_time + trigger 구간 통과 → 타이머 발동
  if (sq.needs_time && !sq.grows_at && triggerPct && prevPct < triggerPct && newPct >= triggerPct) {
    const minutes = Math.floor(Math.random() * ((_sqSettings.time_max_minutes||60) - (_sqSettings.time_min_minutes||10) + 1)) + (_sqSettings.time_min_minutes||10);
    updates.grows_at = new Date(Date.now() + minutes * 60000).toISOString();
    action = 'timer';
  }
  // 2) needs_time + triggerPct 없음(구버전 호환) + 100% → 타이머 발동
  else if (sq.needs_time && !sq.grows_at && !triggerPct && newFed >= sq.acorns_required) {
    const minutes = Math.floor(Math.random() * ((_sqSettings.time_max_minutes||60) - (_sqSettings.time_min_minutes||10) + 1)) + (_sqSettings.time_min_minutes||10);
    updates.grows_at = new Date(Date.now() + minutes * 60000).toISOString();
    action = 'timer';
  }
  // 3) 타이머 완료 후 100% 도달 → 성장
  else if (sq.grows_at && new Date(sq.grows_at) <= new Date() && newFed >= sq.acorns_required) {
    const growType = Math.random() < 0.5 ? 'explorer' : 'pet';
    updates.status = growType;
    updates.grows_at = null;
    updates.sprite = _sqRandomSprite();
    action = 'grow:' + growType;
  }
  // 4) needs_time 없이 100% 도달 → 성장
  else if (!sq.needs_time && !sq.grows_at && newFed >= sq.acorns_required) {
    const growType = Math.random() < 0.5 ? 'explorer' : 'pet';
    updates.status = growType;
    updates.sprite = _sqRandomSprite();
    action = 'grow:' + growType;
  }

  try {
    await spendAcorns(amount, '다람쥐 먹이기');
    await sb.from('squirrels').update(updates).eq('id', id);

    // 게이지 업데이트
    const gauge = document.getElementById('sqGauge-' + id);
    if (gauge) {
      gauge.style.background = isGood
        ? 'linear-gradient(90deg,#fbbf24,#f59e0b,#10b981)'
        : 'linear-gradient(90deg,#fb923c,#f97316)';
      requestAnimationFrame(() => { gauge.style.width = newPct + '%'; });
    }

    _sqPlayFeedSound(isGood);
    const cardEl = document.getElementById('sqCard-' + id);
    if (cardEl) {
      const r = cardEl.getBoundingClientRect();
      _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, isGood, isGood ? 10 : 5);
    }

    // 로컬 캐시 업데이트 (status/grows_at은 아래 action 처리에서)
    _sqUpdate(id, { acorns_fed: newFed, acorns_spent: newSpent });

    if (action === 'timer') {
      _sqUpdate(id, { grows_at: updates.grows_at });
      // gauge 100%
      if (gauge) requestAnimationFrame(() => { gauge.style.width = '100%'; });
      _sqStartTimer(id, { ...sq, grows_at: updates.grows_at });
      toast('⏳', `${sq.name}이(가) 잠시 쉬어야 해요! 타이머가 끝나면 계속 먹일 수 있어요`);
      // busy는 _sqStartTimer 완료 시 풀림 (_sqSetIdle in timer)

    } else if (action.startsWith('grow:')) {
      const growType = action.split(':')[1];
      _sqUpdate(id, { status: growType, grows_at: null });
      // 게이지 100% 보여주고 성장 연출 (busy는 _sqGrowCard 완료 시 풀림)
      if (gauge) requestAnimationFrame(() => { gauge.style.width = '100%'; });
      setTimeout(() => _sqGrowCard(id, sq.name, growType), 1200);

    } else {
      // 일반 먹이기 완료 → 버튼 복원
      _sqSetIdle(id);
      _sqShowFeedButtons(id);
    }

  } catch(e) {
    console.error(e);
    toast('❌', '오류가 발생했어요');
    _sqSetIdle(id);
    _sqShowFeedButtons(id);
  }
}

// ================================================================
//  구매
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
  if (!canAfford(price)) {
    showModal(`<div class="text-center"><div style="font-size:40px">🌰</div><div class="title-font text-lg text-gray-800 my-2">도토리 부족</div><div class="text-sm text-gray-500 mb-4">${price} 도토리가 필요해요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }
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

async function sqDoBuySquirrel(price) {
  closeModal();
  const acornsNeeded = Math.floor(Math.random() * ((_sqSettings.acorn_max||50) - (_sqSettings.acorn_min||20) + 1)) + (_sqSettings.acorn_min||20);
  const needsTime    = Math.random() * 100 < (_sqSettings.time_chance||40);
  const trigMin = _sqSettings.time_trigger_min || 40;
  const trigMax = _sqSettings.time_trigger_max || 80;
  const timeTriggerPct = needsTime ? (trigMin + Math.floor(Math.random() * (trigMax - trigMin + 1))) : null;
  const baseHp  = (_sqSettings.stat_hp_min||60)  + Math.floor(Math.random() * ((_sqSettings.stat_hp_max||120)  - (_sqSettings.stat_hp_min||60)  + 1));
  const baseAtk = (_sqSettings.stat_atk_min||8)  + Math.floor(Math.random() * ((_sqSettings.stat_atk_max||20)  - (_sqSettings.stat_atk_min||8)  + 1));
  const baseDef = (_sqSettings.stat_def_min||4)  + Math.floor(Math.random() * ((_sqSettings.stat_def_max||14)  - (_sqSettings.stat_def_min||4)  + 1));

  // time_trigger_pct 컬럼 존재 여부 확인
  let hasTriggerCol = false;
  try {
    const { error } = await sb.from('squirrels').select('time_trigger_pct').limit(1);
    hasTriggerCol = !error;
  } catch(e) {}

  try {
    await spendAcorns(price, '다람쥐 구매');

    const insertData = {
      user_id: myProfile.id, name: sqRandomName(), status: 'baby',
      acorns_fed: 0, acorns_required: acornsNeeded, needs_time: needsTime,
      stats: { hp: baseHp, atk: baseAtk, def: baseDef },
      hp_current: baseHp, acquired_from: 'shop'
    };
    if (hasTriggerCol && timeTriggerPct !== null) insertData.time_trigger_pct = timeTriggerPct;

    const { data: inserted, error: e2 } = await sb.from('squirrels').insert(insertData).select().single();
    if (e2) throw e2;

    // 로컬 캐시에 추가 + 카드만 DOM에 append (전체 재렌더 없음)
    _sqSquirrels.push(inserted);
    _sqState[inserted.id] = 'idle';
    sqTab('my');

    const grid = document.getElementById('squirrelGrid');
    const countEl = document.getElementById('squirrelCount');
    if (countEl) countEl.textContent = _sqSquirrels.length + ' / 10';
    if (grid) {
      grid.querySelector('.text-center.py-8')?.remove(); // 빈 상태 메시지 제거
      const tmp = document.createElement('div');
      tmp.innerHTML = sqCardHTML(inserted);
      grid.appendChild(tmp.firstElementChild);
    }
    toast('🎉', '새 다람쥐를 분양받았어요!');
  } catch(e) {
    console.error(e);
    toast('❌', '오류가 발생했어요');
  }
}

// ================================================================
//  도토리 배지 동기화
// ================================================================
function sqSyncAcornBadge() {
  const el = document.getElementById('acornBadge');
  if (el) el.textContent = myProfile.acorns.toLocaleString();
}

// ================================================================
//  성장 결과 확인 (시간 경과 후 성장 준비 완료된 다람쥐)
// ================================================================
async function sqRevealGrowth(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq || sq.status !== 'baby') return;

  const growType = Math.random() < 0.5 ? 'explorer' : 'pet';
  const sprite = _sqRandomSprite();
  try {
    await sb.from('squirrels').update({ status: growType, grows_at: null, sprite: sprite }).eq('id', id);
    _sqUpdate(id, { status: growType, grows_at: null, sprite: sprite });
    // 성장 연출 (흔들림 → 페이드 → 새 카드)
    _sqGrowCard(id, sq.name, growType);
  } catch(e) {
    console.error(e);
    toast('❌', '성장 처리 중 오류');
  }
}

// ================================================================
//  이름 변경
// ================================================================
function sqEditName(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  showModal(`
    <div class="text-center">
      <div style="font-size:40px" class="mb-2">✏️</div>
      <div class="title-font text-lg text-gray-800 mb-1">이름 변경</div>
      <div class="text-sm text-gray-500 mb-3">새 이름을 입력해주세요 (최대 8글자)</div>
      <input type="text" id="sqNewName" class="field mb-3" value="${sq.name}" maxlength="8" style="text-align:center;font-size:16px;font-weight:900">
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="sqDoRename('${id}')">변경하기</button>
        <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
      </div>
    </div>`);
  setTimeout(() => {
    const inp = document.getElementById('sqNewName');
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

async function sqDoRename(id) {
  const inp = document.getElementById('sqNewName');
  const newName = inp?.value?.trim();
  if (!newName || newName.length === 0) { toast('⚠️', '이름을 입력해주세요'); return; }
  if (newName.length > 8) { toast('⚠️', '최대 8글자까지 가능해요'); return; }
  try {
    await sb.from('squirrels').update({ name: newName }).eq('id', id);
    _sqUpdate(id, { name: newName });
    closeModal();
    // 카드 교체
    const cardEl = document.getElementById('sqCard-' + id);
    const sq = _sqSquirrels.find(s => s.id === id);
    if (cardEl && sq) {
      const tmp = document.createElement('div');
      tmp.innerHTML = sqCardHTML(sq);
      cardEl.replaceWith(tmp.firstElementChild);
    }
    toast('✏️', newName + '(으)로 이름이 변경되었어요!');
  } catch(e) {
    console.error(e);
    toast('❌', '이름 변경 실패');
  }
}

// ================================================================
//  펫샵 판매
// ================================================================
function sqSellSquirrel(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  const sellBase  = _sqSettings.sell_price_base || 20;
  const sellMax   = _sqSettings.sell_price_max  || 80;
  const statSum   = (sq.stats?.hp||100) + (sq.stats?.atk||10) * 3 + (sq.stats?.def||5) * 2;
  const maxStat   = (_sqSettings.stat_hp_max||120) + (_sqSettings.stat_atk_max||20) * 3 + (_sqSettings.stat_def_max||14) * 2;
  const price     = Math.round(sellBase + (statSum / maxStat) * (sellMax - sellBase));
  const desc      = sq.status === 'explorer' ? '탐험을 즐기는 활발한 녀석이군요!' : '온순하고 귀여운 애완 다람쥐네요!';

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
    if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    // 로컬 캐시에서 제거 + DOM 카드 제거
    _sqSquirrels = _sqSquirrels.filter(s => s.id !== id);
    delete _sqState[id];
    _sqClearTimer(id);
    document.getElementById('sqCard-' + id)?.remove();
    const countEl = document.getElementById('squirrelCount');
    if (countEl) countEl.textContent = _sqSquirrels.length + ' / 10';
    if (_sqSquirrels.length === 0) {
      const grid = document.getElementById('squirrelGrid');
      if (grid) grid.innerHTML = `
        <div class="text-center py-8">
          <div style="font-size:48px">🐿️</div>
          <div class="text-sm text-gray-400 font-bold mt-2">아직 다람쥐가 없어요</div>
          <div class="text-xs text-gray-300 mt-1">상점에서 분양받아보세요!</div>
        </div>`;
    }
    toast('🏪', `${price} 도토리를 받았어요!`);
  } catch(e) {
    toast('❌', '오류가 발생했어요');
  }
}

// ================================================================
//  이름 랜덤 생성
// ================================================================
function sqRandomName() {
  const names = ['솜이','구름','밤이','콩이','도토리','알밤','새벽','별이','하늘','눈송이','복실','뭉치','보리','찰떡','깜찍이','토리','몽실','솔이','바람','이슬'];
  return names[Math.floor(Math.random() * names.length)];
}

// ================================================================
//  탐험
// ================================================================
async function sqLoadActiveExpedition() {
  try {
    const { data } = await sb.from('expeditions')
      .select('*').eq('user_id', myProfile.id).eq('status','active').limit(1);
    const area = document.getElementById('sqActiveExpeditionArea');
    const exp = data?.[0];
    if (area && exp) {
      area.innerHTML = `
        <div class="clay-card p-4 mb-4" style="background:#eff6ff;border-left:4px solid #3b82f6">
          <div class="flex items-center gap-3">
            <div class="text-3xl">🗺️</div>
            <div>
              <div class="font-black text-gray-700">${exp.current_step} / ${exp.total_steps} 칸 진행</div>
              <div class="text-xs text-gray-400">획득 보상: ${(exp.loot||[]).length}개</div>
            </div>
            <button class="btn btn-primary btn-sm ml-auto" onclick="sqContinueExpedition('${exp.id}')">계속하기 →</button>
          </div>
        </div>`;
    } else if (area) {
      area.innerHTML = '';
    }
  } catch(e) {}
}

async function sqStartExpeditionFlow() {
  const explorers = _sqSquirrels.filter(s => s.status === 'explorer');
  const recovering = _sqSquirrels.filter(s => s.status === 'recovering');

  if (explorers.length === 0) {
    const recoverMsg = recovering.length > 0
      ? `<div class="text-xs text-amber-600 mt-2">😴 회복 중인 다람쥐 ${recovering.length}마리가 있어요</div>`
      : '';
    showModal(`<div class="text-center"><div style="font-size:40px">🗺️</div><div class="title-font text-lg text-gray-800 my-2">출발 가능한 다람쥐가 없어요</div><div class="text-sm text-gray-500 mb-2">탐험형 다람쥐를 키우거나 회복을 기다려주세요!</div>${recoverMsg}<button class="btn btn-primary w-full mt-4" onclick="closeModal()">확인</button></div>`);
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
      ${explorers.map(sq => {
        const _g = _sqCalcGrade(sq);
        const _gs = _sqGradeStyle(_g);
        return `
        <div id="expcard-${sq.id}" onclick="sqToggleExpSelect('${sq.id}')" style="background:white;border-radius:16px;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:2px solid transparent;cursor:pointer;transition:all .2s">
          <div class="flex items-center gap-3">
            <div style="border-radius:14px;${_gs.border};box-shadow:${_gs.shadow};padding:2px;flex-shrink:0;background:${_gs.bg}">
              <img src="images/squirrels/${sq.sprite || 'sq_acorn'}.png" style="width:36px;height:36px;object-fit:contain;border-radius:10px;display:block">
            </div>
            <div class="flex-1">
              <div class="font-black text-gray-700">${sq.name} <span style="font-size:9px;color:${_gs.color}">${_gs.label}</span></div>
              <div class="text-xs text-gray-400">❤️${sq.hp_current} ⚔️${sq.stats?.atk||10} 🛡️${sq.stats?.def||5}</div>
            </div>
            <div id="expcheck-${sq.id}" class="text-xl">⬜</div>
          </div>
        </div>`;
      }).join('')}
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
    if (window._sqExpSelected.length >= 3) { toast('⚠️','최대 3마리까지 선택할 수 있어요'); return; }
    window._sqExpSelected.push(id);
    document.getElementById('expcard-' + id).style.borderColor = '#3b82f6';
    document.getElementById('expcheck-' + id).textContent = '✅';
  }
}

async function sqLaunchExpedition() {
  const ids = window._sqExpSelected || [];
  if (!ids.length) { toast('⚠️','다람쥐를 선택해주세요'); return; }
  try {
    const { data: inserted, error } = await sb.from('expeditions').insert({
      user_id: myProfile.id, squirrel_ids: ids,
      current_step: 0, total_steps: 5, status: 'active', loot: []
    }).select('id').single();
    if (error) throw error;
    await sb.from('squirrels').update({ status: 'exploring' }).in('id', ids);
    ids.forEach(id => _sqUpdate(id, { status: 'exploring' }));
    closeModal();
    toast('🗺️', '탐험을 떠났어요!');
    sqRenderGrid();
    // 바로 탐험 맵으로 진입
    sqTab('expedition');
    sqContinueExpedition(inserted.id);
  } catch(e) {
    console.error(e);
    toast('❌', '출발 실패');
  }
}

// sqContinueExpedition은 expedition.js로 이동됨

// ================================================================
//  관리자 패널
// ================================================================
async function sqAdminInit() {
  await sqLoadSettings();
  document.getElementById('sqSet_shopPrice').value       = _sqSettings.shop_price        || 30;
  document.getElementById('sqSet_acornMin').value    = _sqSettings.acorn_min         || 20;
  document.getElementById('sqSet_acornMax').value    = _sqSettings.acorn_max         || 50;
  document.getElementById('sqSet_timeChance').value  = _sqSettings.time_chance       || 40;
  document.getElementById('sqSet_timeMin').value     = _sqSettings.time_min_minutes  || 10;
  document.getElementById('sqSet_timeMax').value     = _sqSettings.time_max_minutes  || 60;
  document.getElementById('sqSet_multiMin').value    = _sqSettings.feed_multi_min    || 0.5;
  document.getElementById('sqSet_multiMax').value    = _sqSettings.feed_multi_max    || 1.3;
  document.getElementById('sqSet_hpMin').value       = _sqSettings.stat_hp_min       || 60;
  document.getElementById('sqSet_hpMax').value       = _sqSettings.stat_hp_max       || 120;
  document.getElementById('sqSet_atkMin').value      = _sqSettings.stat_atk_min      || 8;
  document.getElementById('sqSet_atkMax').value      = _sqSettings.stat_atk_max      || 20;
  document.getElementById('sqSet_defMin').value      = _sqSettings.stat_def_min      || 4;
  document.getElementById('sqSet_defMax').value      = _sqSettings.stat_def_max      || 14;
  document.getElementById('sqSet_sellBase').value    = _sqSettings.sell_price_base   || 20;
  document.getElementById('sqSet_sellMax').value     = _sqSettings.sell_price_max    || 80;
  document.getElementById('sqSet_recoveryMinutes').value = _sqSettings.recovery_base_minutes || 60;
  document.getElementById('sqSet_recoveryCost').value    = _sqSettings.recovery_instant_cost || 15;
  document.getElementById('sqSet_triggerMin').value       = _sqSettings.time_trigger_min || 40;
  document.getElementById('sqSet_triggerMax').value       = _sqSettings.time_trigger_max || 80;
  // 탐험 보상 설정 로드
  await expLoadSettings();
  await expAdminLoadUI();
  await sqAdminLoadList();
}

async function sqSaveSettings() {
  const settings = {
    shop_price:       parseInt(document.getElementById('sqSet_shopPrice').value)      || 30,
    acorn_min:        parseInt(document.getElementById('sqSet_acornMin').value)   || 20,
    acorn_max:        parseInt(document.getElementById('sqSet_acornMax').value)   || 50,
    time_chance:      parseInt(document.getElementById('sqSet_timeChance').value) || 40,
    time_min_minutes: parseInt(document.getElementById('sqSet_timeMin').value)    || 10,
    time_max_minutes: parseInt(document.getElementById('sqSet_timeMax').value)    || 60,
    feed_multi_min:   parseFloat(document.getElementById('sqSet_multiMin').value) || 0.5,
    feed_multi_max:   parseFloat(document.getElementById('sqSet_multiMax').value) || 1.3,
    stat_hp_min:      parseInt(document.getElementById('sqSet_hpMin').value)      || 60,
    stat_hp_max:      parseInt(document.getElementById('sqSet_hpMax').value)      || 120,
    stat_atk_min:     parseInt(document.getElementById('sqSet_atkMin').value)     || 8,
    stat_atk_max:     parseInt(document.getElementById('sqSet_atkMax').value)     || 20,
    stat_def_min:     parseInt(document.getElementById('sqSet_defMin').value)     || 4,
    stat_def_max:     parseInt(document.getElementById('sqSet_defMax').value)     || 14,
    sell_price_base:  parseInt(document.getElementById('sqSet_sellBase').value)   || 20,
    sell_price_max:   parseInt(document.getElementById('sqSet_sellMax').value)    || 80,
    recovery_base_minutes: parseInt(document.getElementById('sqSet_recoveryMinutes').value) || 60,
    recovery_instant_cost: parseInt(document.getElementById('sqSet_recoveryCost').value)    || 15,
    time_trigger_min:      parseInt(document.getElementById('sqSet_triggerMin').value)       || 40,
    time_trigger_max:      parseInt(document.getElementById('sqSet_triggerMax').value)       || 80,
  };
  const { error } = await sb.from('app_settings')
    .upsert({ key:'squirrel_settings', value: settings, updated_at: new Date().toISOString() }, { onConflict:'key' });
  if (!error) { _sqSettings = settings; toast('✅','설정이 저장되었어요'); }
  else toast('❌','저장 실패');
}

async function sqAdminLoadList() {
  const el = document.getElementById('sqAdminList');
  if (!el) return;
  const { data } = await sb.from('squirrels').select('*').order('created_at', { ascending: false });
  if (!data?.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">다람쥐가 없어요</div>'; return; }
  el.innerHTML = data.map(sq => `
    <div style="background:white;border-radius:12px;padding:10px 14px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);display:flex;align-items:center;gap:10px">
      <div style="font-size:24px">${sq.status==='baby'?'🐿️':sq.status==='pet'?'🐱':'🦔'}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:900;color:#1f2937">${sq.name} <span style="font-size:10px;color:#9ca3af">(${sq.status})</span></div>
        <div style="font-size:10px;color:#9ca3af">${sq.status==='baby'?`게이지 ${sq.acorns_fed}/${sq.acorns_required}`:`HP ${sq.hp_current} / ATK ${sq.stats?.atk||'?'} / DEF ${sq.stats?.def||'?'}`}</div>
      </div>
    </div>`).join('');
}
