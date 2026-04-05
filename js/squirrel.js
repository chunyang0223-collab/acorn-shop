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
  stat_hp_min: 60, stat_hp_max: 150,
  stat_atk_min: 8, stat_atk_max: 20,
  stat_def_min: 4, stat_def_max: 20,
  sell_price_base: 20, sell_price_max: 80,
  recovery_base_minutes: 60, recovery_instant_cost: 15,
  time_trigger_min: 40, time_trigger_max: 80,
  max_squirrels: 10,
  // 합성 설정
  fuse_cost: 10,
  fuse_upgrade_normal: 15,
  fuse_upgrade_rare: 12,
  fuse_upgrade_epic: 8,
  fuse_upgrade_unique: 5,
  fuse_upgrade_legend: 0,
  // 훈련 설정
  training_dot_rate: 30,
  training_hp_min: 1,
  training_hp_max: 10,
  training_count_min: 0,
  training_count_max: 2,
  // 등급심사 설정
  exam_cost: 10,
  exam_pass_rate: 40,
  exam_cooldown_hours: 48,
  exam_bonus_min: 1,
  exam_bonus_max: 1,
  exam_item_boost: 5,
  exam_item_max: 12
};
var _sqAudioCtx = null;

// ── 스프라이트 목록 (17종) ──
var _sqSprites = ['sq_acorn','sq_white','sq_choco','sq_black','sq_beige','sq_gold','sq_pink','sq_gray','sq_darkbrown','sq_stripe','sq_ribbon1','sq_ribbon2','sq_mahogany','sq_cream','sq_mocha','sq_silver','sq_heart','sq_curious'];
function _sqRandomSprite() {
  return _sqSprites[Math.floor(Math.random() * _sqSprites.length)];
}

// ── 등급 시스템 ──
var _sqGradeOrder = ['normal','rare','epic','unique','legend'];
var _sqGradeLabel = { normal:'일반', rare:'레어', epic:'희귀', unique:'유일', legend:'레전드' };
// HP/150 + ATK/20 + DEF/20 평균 → 백분율
function _sqCalcGrade(sq) {
  var maxHp = _sqSettings.stat_hp_max || 150;
  var maxAtk = _sqSettings.stat_atk_max || 20;
  var maxDef = _sqSettings.stat_def_max || 20;
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
//  회복 전용 사운드 (상승 치유음)
// ================================================================
function _sqPlayRecoverSound() {
  try {
    const ctx = _sqGetAudio();
    // 부드러운 상승 치유음 (C5 → E5 → G5 → C6)
    [[523,0],[659,0.12],[784,0.24],[1047,0.36]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.2, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.4);
    });
    // 마지막에 반짝이는 벨 사운드
    setTimeout(() => {
      const osc2 = ctx.createOscillator(), g2 = ctx.createGain();
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1568, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(2093, ctx.currentTime + 0.15);
      g2.gain.setValueAtTime(0.15, ctx.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc2.start(ctx.currentTime); osc2.stop(ctx.currentTime + 0.4);
    }, 450);
  } catch(e) {}
}

// ================================================================
//  회복 전용 파티클 (초록 하트 + 반짝이)
// ================================================================
function _sqRecoverParticles(cardEl) {
  const rect = cardEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * 0.6;
  const emojis = ['💚','✨','🌿','💫','🍀','🌟'];
  _sqSpawnParticlesAt(cx, cy, true, 10);
  // 추가 초록 파티클
  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      _sqSpawnParticlesAt(cx + (Math.random()-0.5)*80, cy + (Math.random()-0.5)*30, true, 3);
    }, i * 100);
  }
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
  document.getElementById('atab-squirrelSettings')?.classList.add('hidden');
  document.getElementById('userMode').classList.remove('hidden');
  document.getElementById('sqAdminBackBar')?.classList.remove('hidden');
  // 관리자 설정 패널 표시
  document.querySelectorAll('.sq-admin-panel').forEach(el => el.classList.remove('hidden'));
  const sqBtn = document.querySelector('#userTabBar .tab-btn[onclick*="squirrel"]');
  if (sqBtn) sqBtn.click();
  // 설정값 로드
  sqAdminInit();
}

function sqAdminBack() {
  if (typeof _sqUnsubscribe === 'function') _sqUnsubscribe();
  document.getElementById('sqAdminBackBar')?.classList.add('hidden');
  // 관리자 설정 패널 숨기기
  document.querySelectorAll('.sq-admin-panel').forEach(el => el.classList.add('hidden'));
  document.getElementById('userMode').classList.add('hidden');
  document.getElementById('adminMode').classList.remove('hidden');
}
function sqAdminClose() {}

// ================================================================
//  서브탭 전환
// ================================================================
function sqTab(tab) {
  ['my','shop','fuse','expedition','farm'].forEach(t => {
    document.getElementById('sqcontent-' + t)?.classList.toggle('hidden', t !== tab);
    document.getElementById('sqtab-' + t)?.classList.toggle('active', t === tab);
  });

  // 서브탭 점검 체크 (농장)
  if (tab === 'farm') {
    const maint = window._maintSettings || {};
    const area = document.getElementById('sqFarmArea');
    if (area) {
      if (maint['sq_farm'] && !_isMaintBypassed()) {
        area.innerHTML = `
          <div class="clay-card p-8 text-center mt-4">
            <div style="font-size:3rem;margin-bottom:12px">🔧</div>
            <p class="text-lg font-black text-gray-700 mb-2">점검 중입니다</p>
            <p class="text-sm text-gray-400">농장 기능을 준비하고 있어요!</p>
          </div>`;
      } else {
        sqFarmInit();
      }
    }
  }

  // 탭별 초기화
  if (tab === 'fuse') sqFuseInit();
  // 탭별 배경음
  if (typeof _sndPlayBGM === 'function') {
    if (tab === 'shop') _sndPlayBGM('shop');
    else if (tab === 'expedition') _sndPlayBGM('explorer');
    else if (tab === 'my') _sndPlayBGM('my');
    else if (tab === 'fuse') _sndPlayBGM('fuse');
    else if (tab === 'farm') _sndPlayBGM('farm');
    else _sndStopBGM();
  }
}

// ================================================================
//  초기화
// ================================================================
async function sqInit() {
  await sqLoadSettings();
  await sqLoadSquirrels();
  await sqLoadActiveExpedition();
  _sqSubscribe();
  // 최초 진입 시 배경음 (기본 탭이 '내 다람쥐')
  if (typeof _sndPlayBGM === 'function') _sndPlayBGM('my');
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
          if (sq.type === 'baby' && sq.grows_at) {
            _sqSetBusy(sq.id);
            _sqStartTimer(sq.id, sq);
          }
        }
        const countEl = document.getElementById('squirrelCount');
        if (countEl) countEl.textContent = _sqSquirrels.length + ' / ' + (_sqSettings.max_squirrels || 10);
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
        if (countEl) countEl.textContent = _sqSquirrels.length + ' / ' + (_sqSettings.max_squirrels || 10);
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
      // sprite가 DB에 없으면(null) 기존 로컬 값 보존
      if (!updated.sprite && prev.sprite) updated.sprite = prev.sprite;
      _sqSquirrels[idx] = updated;

      if (prev.type === 'baby' && updated.type !== 'baby') {
        _sqClearTimer(id);
        _sqGrowCard(id, updated.name, updated.type);
      } else if (!prev.grows_at && updated.grows_at) {
        _sqSetBusy(id);
        const gauge = document.getElementById('sqGauge-' + id);
        if (gauge) requestAnimationFrame(() => { gauge.style.width = '100%'; });
        _sqStartTimer(id, updated);
      } else if (prev.grows_at && !updated.grows_at && updated.type === 'baby') {
        _sqClearTimer(id);
        _sqShowFeedButtons(id);
      } else if (updated.type === 'baby') {
        const pct = Math.min(100, Math.round((updated.acorns_fed / updated.acorns_required) * 100));
        const gauge = document.getElementById('sqGauge-' + id);
        if (gauge) requestAnimationFrame(() => { gauge.style.width = pct + '%'; });
      }
      // recovering ↔ idle 전환 감지 → 카드 교체
      if ((prev.status === 'recovering' && updated.status === 'idle') ||
          (prev.status === 'idle' && updated.status === 'recovering') ||
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
    if (sq.type === 'baby' && sq.grows_at && new Date(sq.grows_at) <= now) {
      await sb.from('squirrels').update({ grows_at: null, acorns_fed: sq.acorns_required }).eq('id', sq.id);
      sq.grows_at = null;
      sq.acorns_fed = sq.acorns_required;
    }
    if (sq.status === 'recovering' && sq.recovers_at && new Date(sq.recovers_at) <= now) {
      const fullHp = sq.stats?.hp || 100;
      await sb.from('squirrels').update({ status: 'idle', recovers_at: null, hp_current: fullHp }).eq('id', sq.id);
      sq.status = 'idle'; sq.recovers_at = null; sq.hp_current = fullHp;
    }
    // 성체인데 sprite가 없으면 1회만 배정 (이전 버전 호환)
    if (sq.type !== 'baby' && !sq.sprite) {
      const newSprite = _sqRandomSprite();
      try {
        const { error } = await sb.from('squirrels').update({ sprite: newSprite }).eq('id', sq.id);
        if (!error) sq.sprite = newSprite;
        else sq.sprite = newSprite; // DB 실패해도 로컬에는 고정
      } catch(e) {
        sq.sprite = newSprite; // 에러나도 로컬에 고정
      }
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
async function sqRenderGrid() {
  const grid = document.getElementById('squirrelGrid');
  if (!grid) return;
  document.getElementById('squirrelCount')?.setAttribute('textContent', _sqSquirrels.length + ' / ' + (_sqSettings.max_squirrels || 10));
  const countEl = document.getElementById('squirrelCount');
  if (countEl) countEl.textContent = _sqSquirrels.length + ' / ' + (_sqSettings.max_squirrels || 10);

  // 농부 데이터가 아직 로드되지 않았으면 한 번 로드
  if (typeof _farmFarmers !== 'undefined' && !window._farmDataLoaded) {
    try {
      const { data: fd } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
      _farmData = fd;
      const { data: ff } = await sb.from('farm_farmers').select('*').eq('user_id', myProfile.id);
      _farmFarmers = ff || [];
      window._farmDataLoaded = true;
    } catch(e) { console.warn('[sqRenderGrid] farm data load failed', e); }
  }

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
  const filtered = filter === 'all' ? [..._sqSquirrels] : _sqSquirrels.filter(sq => {
    if (filter === 'baby') return sq.type === 'baby';
    if (filter === 'pet') return sq.type === 'pet';
    if (filter === 'explorer') return sq.type === 'explorer';
    return true;
  });

  // 등급순 자동정렬 (높은 등급이 위)
  const _gradeRank = { legend: 5, unique: 4, epic: 3, rare: 2, normal: 1 };
  const _typeRank = (sq) => {
    const isExplorer = sq.type === 'explorer';
    if (isExplorer) return 3;
    const isFarmer = typeof _farmFarmers !== 'undefined' && _farmFarmers.some(f => f.squirrel_id === sq.id);
    if (sq.type === 'pet' && isFarmer) return 1;
    if (sq.type === 'pet') return 2;
    if (sq.type === 'baby') return 0;
    return 0;
  };
  filtered.sort((a, b) => {
    const ta = _typeRank(a), tb = _typeRank(b);
    if (ta !== tb) return tb - ta; // 탐험형 > 애완형 > 애완형+농부 > 아기
    const ga = _gradeRank[_sqCalcGrade(a)] || 0;
    const gb = _gradeRank[_sqCalcGrade(b)] || 0;
    return gb - ga; // 높은 등급 우선
  });

  const _ftDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const filterBtn = (val, label) => {
    const active = filter === val;
    // ── 필터 버튼 색상 (라이트/다크 × 활성/비활성) ──
    const bg = active
      ? (_ftDark ? 'linear-gradient(180deg,#fde68a,#fbbf24)' : 'linear-gradient(180deg,#fef3c7,#fde68a)')
      : (_ftDark ? 'linear-gradient(180deg,#2a3a4e,#1e2d40)' : 'linear-gradient(180deg,#ffffff,#f1f5f9)');
    const border = active
      ? (_ftDark ? '#d97706' : '#f59e0b')
      : (_ftDark ? '#475569' : '#d1d5db');
    const color = active
      ? (_ftDark ? '#1e1e1e' : '#1e1e1e')
      : (_ftDark ? '#e2e8f0' : '#4b5563');
    const shadow = active
      ? (_ftDark ? '0 2px 0 #b45309,0 4px 10px rgba(245,158,11,0.25)' : '0 2px 0 #d97706,0 4px 10px rgba(251,191,36,0.15)')
      : (_ftDark ? '0 2px 0 #0f172a,0 3px 6px rgba(0,0,0,0.25)' : '0 2px 0 #e2e8f0,0 3px 6px rgba(0,0,0,0.04)');
    const gloss = active ? 'rgba(255,255,255,0.3)' : (_ftDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)');
    return `<button onclick="window._sqFilter='${val}';sqRenderGrid()"
      style="padding:5px 14px;border-radius:20px;
        border:1.5px solid ${border};
        background:${bg};
        color:${color};font-size:12px;font-weight:800;
        cursor:pointer;font-family:inherit;
        box-shadow:${shadow};
        position:relative;overflow:hidden;
        transition:all .15s"
      onmousedown="this.style.transform='translateY(1px)';this.style.boxShadow='none'"
      onmouseup="this.style.transform='';this.style.boxShadow='${shadow}'"
      onmouseleave="this.style.transform='';this.style.boxShadow='${shadow}'"><span style="position:absolute;top:1px;left:15%;right:15%;height:6px;background:${gloss};border-radius:99px;pointer-events:none;filter:blur(0.5px)"></span><span style="position:relative">${label}</span></button>`;
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
    if (sq.type === 'baby' && sq.grows_at) {
      _sqSetBusy(sq.id);
      _sqStartTimer(sq.id, sq);
    }
    // 회복 중 타이머도 시작
    if (sq.status === 'recovering' && sq.recovers_at) {
      _sqStartRecoverTimer(sq.id, sq);
    }
  });

  // 수습 농부 타이머 시작
  if (typeof _farmData !== 'undefined' && _farmData?.farmer_status === 'apprentice' && _farmData?.apprentice_until && _farmData?.apprentice_squirrel_id) {
    const until = new Date(_farmData.apprentice_until);
    const sqId = _farmData.apprentice_squirrel_id;
    const timerEl = document.getElementById('sqApprenticeTimer-' + sqId);
    if (timerEl && until > Date.now()) {
      if (window._sqApprenticeTimer) clearInterval(window._sqApprenticeTimer);
      window._sqApprenticeTimer = setInterval(() => {
        const rem = until - Date.now();
        const el = document.getElementById('sqApprenticeTimer-' + sqId);
        if (el) el.textContent = _farmFmtTime(rem);
        if (rem <= 0) {
          clearInterval(window._sqApprenticeTimer);
          window._sqApprenticeTimer = null;
          _farmReloadAll().then(() => sqRenderGrid());
        }
      }, 1000);
    }
  }
}

// ================================================================
//  카드 HTML 생성
// ================================================================
function sqCardHTML(sq) {
  const borderColor = sq.type === 'explorer' ? '#3b82f6'
                    : sq.type === 'pet' ? '#ec4899'
                    : sq.type === 'baby' ? '#fbbf24' : '#a3a3a3';
  const badgeStyle  = sq.type === 'explorer' ? 'background:#3b82f6;color:#ffffff'
                    : sq.type === 'pet' ? 'background:#fce7f3;color:#9d174d'
                    : 'background:#fef3c7;color:#92400e';
  const badgeLabel  = sq.type === 'explorer' ? '탐험형' : sq.type === 'pet' ? '애완형' : '아기';

  // 상태 텍스트 (이름 아래 표시)
  const getStatusText = () => {
    if (sq.type === 'baby') return '';
    if (sq.status === 'idle') return sq.type === 'explorer' ? '<span style="color:#22c55e">🟢 대기 중</span>' : '<span style="color:#ec4899">🏡 편안하게 쉬는 중</span>';
    if (sq.status === 'exploring') return '<span style="color:#3b82f6">⚔️ 탐험 중</span>';
    if (sq.status === 'recovering') return '';
    return '';
  };
  const statusText = getStatusText();

  const spriteBase = sq.sprite || 'sq_acorn';
  const spriteFile = (sq.status === 'recovering' || sq.hp_current <= 0) ? spriteBase + '_defeat' : spriteBase;
  const grade = (sq.type !== 'baby') ? _sqCalcGrade(sq) : null;
  const gs = grade ? _sqGradeStyle(grade) : null;

  let imgHTML;
  if (sq.type === 'baby') {
    imgHTML = `<img src="images/baby-squirrel.png" style="width:56px;height:56px;object-fit:contain;border-radius:16px;background:#fff8f0;padding:4px;flex-shrink:0" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div style="display:none;font-size:44px;line-height:1;flex-shrink:0">🐿️</div>`;
  } else {
    imgHTML = `<div style="border-radius:18px;${gs.border};box-shadow:${gs.shadow};padding:2px;flex-shrink:0;background:${gs.bg}">` +
      `<img src="images/squirrels/${spriteFile}.png" style="width:52px;height:52px;object-fit:contain;border-radius:14px;display:block" onerror="this.outerHTML='<div style=\\'font-size:40px;line-height:52px;text-align:center\\'>🦔</div>'">` +
    `</div>`;
  }

  let babyHTML = '';
  if (sq.type === 'baby') {
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
        <button onclick="sqAdjFeed('${sq.id}',-1)" style="width:34px;height:34px;border-radius:10px;border:2px solid var(--feed-btn-border);background:var(--feed-btn-bg);color:var(--feed-btn-text);font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">−</button>
        <span id="sqFeedCnt-${sq.id}" style="min-width:36px;text-align:center;font-size:18px;font-weight:900;color:#78350f">5</span>
        <button onclick="sqAdjFeed('${sq.id}',1)" style="width:34px;height:34px;border-radius:10px;border:2px solid var(--feed-btn-border);background:var(--feed-btn-bg);color:var(--feed-btn-text);font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">＋</button>
        <button onclick="sqFeedSquirrel('${sq.id}')" style="flex:1;height:34px;border-radius:10px;border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white;font-size:14px;font-weight:900;cursor:pointer;box-shadow:0 3px 10px rgba(245,158,11,0.3);font-family:inherit">🌰 도토리 주기</button>
      </div>`;
    }

    babyHTML = `
      <div style="margin-top:12px">
        <div style="font-size:11px;font-weight:800;color:#9ca3af;margin-bottom:6px">🌰 성장 게이지</div>
        <div style="height:12px;border-radius:99px;background:var(--progress-track-bg);overflow:hidden;margin-bottom:12px">
          <div id="sqGauge-${sq.id}" style="height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#10b981);width:${pct}%;transition:width 0.9s cubic-bezier(0.34,1.56,0.64,1),background 0.4s ease"></div>
        </div>
        <div id="sqFeedArea-${sq.id}">${feedAreaHTML}</div>
      </div>`;
  }

  let statsHTML = '';
  if (sq.type !== 'baby') {
    statsHTML = `
      <div style="display:flex;gap:8px;margin-top:12px">
        <div style="flex:1;background:var(--surface-50);border-radius:12px;padding:8px 4px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">❤️ HP</div>
          <div style="font-size:16px;font-weight:900;color:#ef4444;margin-top:1px">${sq.hp_current}<span style="font-size:10px;color:#d1d5db">/${sq.stats?.hp||100}</span></div>
        </div>
        <div style="flex:1;background:var(--surface-50);border-radius:12px;padding:8px 4px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">⚔️ 공격</div>
          <div style="font-size:16px;font-weight:900;color:#f97316;margin-top:1px">${sq.stats?.atk||10}</div>
        </div>
        <div style="flex:1;background:var(--surface-50);border-radius:12px;padding:8px 4px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">🛡️ 방어</div>
          <div style="font-size:16px;font-weight:900;color:#3b82f6;margin-top:1px">${sq.stats?.def||5}</div>
        </div>
      </div>`;
  }

  // 훈련 정보는 카드에 표시하지 않음 (액션 모달에서만 확인)

  // 회복 중 UI — 가로 풀와이드 젤리 버튼 (타이머 + 비용 통합)
  let recoverHTML = '';
  if (sq.status === 'recovering' && sq.recovers_at) {
    const _recMaxCost = _sqSettings.recovery_instant_cost || 15;
    const _recBaseMin = _sqSettings.recovery_base_minutes || 60;
    const _recRemaining = Math.max(0, new Date(sq.recovers_at) - Date.now());
    const _recTotalMs = _recBaseMin * 60000;
    const _recCost = Math.max(1, Math.ceil(_recMaxCost * (_recRemaining / _recTotalMs)));
    const _isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const _rcBg = _isDark
      ? 'linear-gradient(135deg,#818cf8,#a78bfa,#f0abfc,#c084fc,#818cf8)'
      : 'linear-gradient(135deg,#c4b5fd,#d8b4fe,#f0abfc,#e9d5ff,#c4b5fd)';
    const _rcColor = _isDark ? 'white' : '#581c87';
    const _rcShadowBase = _isDark ? '#7c3aed' : '#a855f7';
    const _rcShadowGlow = _isDark ? 'rgba(124,58,237,0.3)' : 'rgba(168,85,247,0.2)';
    const _rcTextShadow = _isDark ? '0 1px 3px rgba(0,0,0,0.15)' : 'none';
    const _rcGloss = _isDark ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.55)';
    const _rcShadowFull = `0 4px 0 ${_rcShadowBase},0 6px 20px ${_rcShadowGlow}`;
    const _rcShadowDown = `0 1px 0 ${_rcShadowBase}`;
    recoverHTML = `
      <div id="sqRecoverArea-${sq.id}" style="margin-top:12px;position:relative">
        <button onclick="sqInstantRecover('${sq.id}')" id="sqRecoverBtn-${sq.id}"
          style="width:100%;height:48px;border-radius:99px;border:none;
            background:${_rcBg};
            background-size:300% 300%;
            animation:sqAuroraFlow 5s ease infinite;
            color:${_rcColor};font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;
            box-shadow:${_rcShadowFull};
            display:flex;align-items:center;justify-content:center;gap:10px;
            position:relative;overflow:hidden;
            text-shadow:${_rcTextShadow};
            transition:transform 0.1s,box-shadow 0.1s"
          onmousedown="this.style.transform='translateY(3px)';this.style.boxShadow='${_rcShadowDown}'"
          onmouseup="this.style.transform='';this.style.boxShadow='${_rcShadowFull}'"
          onmouseleave="this.style.transform='';this.style.boxShadow='${_rcShadowFull}'">
          <span style="position:absolute;top:3px;left:15%;right:15%;height:10px;background:${_rcGloss};border-radius:99px;pointer-events:none;filter:blur(1px)"></span>
          <span style="position:relative;display:flex;align-items:center;gap:10px">
            <span id="sqRecoverTimer-${sq.id}" style="font-size:16px;font-variant-numeric:tabular-nums;letter-spacing:1.5px">--:--:--</span>
            <span style="font-size:6px;opacity:0.35">●</span>
            <span id="sqRecoverCostText-${sq.id}" style="font-size:12px;font-weight:800;opacity:0.9">🌰 ${_recCost} 도토리로 회복</span>
          </span>
        </button>
      </div>`;
  }

  // 수습 농부 상태 표시 (버튼은 액션 모달로 이동)
  let apprenticeHTML = '';
  const _isThisApprentice = typeof _farmData !== 'undefined' && _farmData?.farmer_status === 'apprentice' && _farmData?.apprentice_squirrel_id === sq.id;
  if (_isThisApprentice && _farmData?.apprentice_until) {
    const until = new Date(_farmData.apprentice_until);
    const remaining = until - Date.now();
    if (remaining <= 0) {
      apprenticeHTML = `
        <div onclick="farmRevealResult()" style="margin-top:10px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;padding:10px 14px;text-align:center;border:2px solid rgba(251,191,36,.3);cursor:pointer">
          <div style="font-size:14px;font-weight:900;color:#78350f">🎁 수습 완료! <span style="font-size:11px;color:#92400e">결과 확인 →</span></div>
        </div>`;
    } else {
      apprenticeHTML = `
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <div style="font-size:11px;font-weight:800;color:#15803d">🌾 수습 알바 중</div>
          <div id="sqApprenticeTimer-${sq.id}" style="font-size:13px;font-weight:900;color:#16a34a;font-variant-numeric:tabular-nums;letter-spacing:1px">${_farmFmtTime(remaining)}</div>
        </div>`;
    }
  }

  // 농부 / 역할 뱃지
  const _isActiveFarmer = typeof _farmData !== 'undefined' && _farmData?.active_farmer_id === sq.id;
  let roleTag = '';
  if (sq.type !== 'baby') {
    if (_isActiveFarmer) {
      roleTag = '<span style="font-size:10px;font-weight:800;color:#15803d;background:#dcfce7;padding:2px 6px;border-radius:6px;margin-left:4px">🌾 농부</span>';
    } else if (typeof _farmFarmers !== 'undefined' && _farmFarmers.some(f => f.squirrel_id === sq.id)) {
      roleTag = '<span style="font-size:10px;font-weight:800;color:#15803d;background:#ecfdf5;padding:2px 6px;border-radius:6px;margin-left:4px">농부</span>';
    }
  }

  // 성체 다람쥐: 이미지를 클릭하면 액션 모달
  // 훈련 가능 → 💪 뱃지, 재심사 대기 중 → ⏳ 뱃지
  const _hasTraining = sq.type !== 'baby' && ((sq.training_total || 0) - (sq.training_used || 0)) > 0 && !((sq.stats?.hp || 60) >= (_sqSettings.stat_hp_max || 150));
  const _hasCooldown = sq.type !== 'baby' && sq.exam_cooldown_until && new Date(sq.exam_cooldown_until) > new Date();
  let badgeHTML = '';
  if (_hasTraining) {
    badgeHTML = `<div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 1px 4px rgba(0,0,0,0.15)">💪</div>`;
  } else if (_hasCooldown) {
    badgeHTML = `<div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:#dc2626;display:flex;align-items:center;justify-content:center;font-size:9px;box-shadow:0 1px 4px rgba(0,0,0,0.15)">⏳</div>`;
  }
  const clickableImg = (sq.type !== 'baby')
    ? `<div onclick="sqShowActionModal('${sq.id}')" style="cursor:pointer;position:relative" title="탭하여 관리">${imgHTML}${badgeHTML}</div>`
    : imgHTML;

  return `
    <div id="sqCard-${sq.id}" style="background:var(--sq-card-bg);border-radius:24px;padding:16px 20px;margin-bottom:12px;box-shadow:var(--sq-card-shadow);border-left:5px solid ${borderColor};transition:border-left-color 0.5s">
      <div style="display:flex;align-items:center;gap:14px">
        ${clickableImg}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <span style="font-size:16px;font-weight:900;color:#1f2937">${sq.name}</span>
            <span onclick="sqEditName('${sq.id}')" style="font-size:12px;cursor:pointer;padding:1px 4px;display:inline-flex;align-items:center" title="클릭하여 이름 변경">✏️</span>
            ${gs ? `<span style="font-size:9px;font-weight:900;color:${gs.color};background:${gs.color}15;padding:2px 7px;border-radius:8px">${gs.label}</span>` : ''}
            ${roleTag}
          </div>
          <div style="font-size:11px;font-weight:700;margin-top:2px">${statusText}</div>
        </div>
        <span style="font-size:12px;font-weight:900;padding:4px 10px;border-radius:99px;text-align:center;white-space:nowrap;${badgeStyle}">${badgeLabel}</span>
      </div>
      ${statsHTML}${recoverHTML}${apprenticeHTML}${babyHTML}
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
      <button onclick="sqAdjFeed('${id}',-1)" style="width:34px;height:34px;border-radius:10px;border:2px solid var(--feed-btn-border);background:var(--feed-btn-bg);color:var(--feed-btn-text);font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">−</button>
      <span id="sqFeedCnt-${id}" style="min-width:36px;text-align:center;font-size:18px;font-weight:900;color:#78350f">5</span>
      <button onclick="sqAdjFeed('${id}',1)" style="width:34px;height:34px;border-radius:10px;border:2px solid var(--feed-btn-border);background:var(--feed-btn-bg);color:var(--feed-btn-text);font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit">＋</button>
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
//  액션 모달 (이미지 클릭 → 관리 메뉴)
// ================================================================
function sqShowActionModal(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;

  const grade = _sqCalcGrade(sq);
  const gs = _sqGradeStyle(grade);
  const spriteBase = sq.sprite || 'sq_acorn';
  const spriteFile = (sq.status === 'recovering' || sq.hp_current <= 0) ? spriteBase + '_defeat' : spriteBase;

  // 상태 정보
  const getActionStatusLabel = () => {
    if (sq.type === 'baby') return '';
    if (sq.status === 'idle') return sq.type === 'explorer' ? '🟢 대기 중' : '🏡 편안하게 쉬는 중';
    if (sq.status === 'exploring') return '⚔️ 탐험 중';
    if (sq.status === 'recovering') return '😴 회복 중';
    return '';
  };
  const statusLabel = getActionStatusLabel();

  // 조건 계산
  const tTotal = sq.training_total || 0;
  const tUsed  = sq.training_used  || 0;
  const tRemain = tTotal - tUsed;
  const hpMax = _sqSettings.stat_hp_max || 150;
  const currentHp = sq.stats?.hp || 60;
  const hpMaxed = currentHp >= hpMax;
  const canAct = sq.status === 'idle' && (sq.type === 'explorer' || sq.type === 'pet');

  const _isThisApprentice = typeof _farmData !== 'undefined' && _farmData?.farmer_status === 'apprentice' && _farmData?.apprentice_squirrel_id === sq.id;
  const _isActiveFarmer = typeof _farmData !== 'undefined' && _farmData?.active_farmer_id === sq.id;
  const isFarmer = typeof _farmFarmers !== 'undefined' && _farmFarmers.some(f => f.squirrel_id === sq.id);
  const hasApprentice = typeof _farmData !== 'undefined' && _farmData?.farmer_status === 'apprentice';

  // ── 버튼 목록 조립 ──
  let buttons = [];

  // 1) 훈련 버튼
  if (tTotal > 0 && tRemain > 0 && !hpMaxed) {
    const canTrain = canAct;
    const trainLabel = canTrain ? '💪 체력 훈련' : (sq.status === 'exploring' ? '⚔️ 탐험 중엔 훈련 불가' : '😴 회복 후 훈련 가능');
    const trainSub = canTrain ? `남은 횟수 ${tRemain}/${tTotal}` : '';
    buttons.push({
      label: trainLabel, sub: trainSub,
      action: canTrain ? `sqShowTrainingModal('${sq.id}')` : '',
      bg: canTrain ? 'linear-gradient(135deg,#38bdf8,#0284c7)' : '#e2e8f0',
      color: canTrain ? 'white' : '#94a3b8',
      disabled: !canTrain
    });
  }

  // 2) 등급심사 버튼
  if (tRemain <= 0 || hpMaxed) {
    if (hpMaxed) {
      buttons.push({
        label: '📋 등급심사 신청',
        sub: '',
        action: `toast('⚠️','HP가 이미 최대치예요!')`,
        bg: '#e2e8f0',
        color: '#94a3b8',
        disabled: false
      });
    } else {
      const examCheck = sqCanExam(sq);
      const canExam = examCheck.ok && canAct;
      let examLabel = '📋 등급심사 신청';
      if (!canExam) {
        if (examCheck.reason) examLabel = examCheck.reason;
        else if (sq.status === 'exploring') examLabel = '⚔️ 탐험 중엔 심사 불가';
        else if (sq.status === 'recovering') examLabel = '😴 회복 중엔 심사 불가';
        else examLabel = '현재 심사 불가';
      }
      buttons.push({
        label: examLabel,
        sub: canExam ? `비용 ${_sqSettings.exam_cost || 10} 도토리` : '',
        action: canExam ? `sqShowExamModal('${sq.id}')` : '',
        bg: canExam ? 'linear-gradient(135deg,#a78bfa,#7c3aed)' : '#e2e8f0',
        color: canExam ? 'white' : '#94a3b8',
        disabled: !canExam
      });
    }
  }

  // 2-1) 관리자 쿨타임 초기화 버튼
  if (myProfile?.is_admin && sq.exam_cooldown_until && new Date(sq.exam_cooldown_until) > new Date()) {
    buttons.push({
      label: '⏩ 재심사 쿨타임 초기화 (관리자)', sub: '',
      action: `sqAdminResetCooldown('${sq.id}')`,
      bg: '#fef3c7', color: '#92400e', disabled: false
    });
  }

  // 3) 즉시 회복 버튼
  if (sq.status === 'recovering' && sq.recovers_at) {
    const maxCost = _sqSettings.recovery_instant_cost || 15;
    const baseMinutes = _sqSettings.recovery_base_minutes || 60;
    const remaining = Math.max(0, new Date(sq.recovers_at) - Date.now());
    const totalMs = baseMinutes * 60000;
    const currentCost = Math.max(1, Math.ceil(maxCost * (remaining / totalMs)));
    buttons.push({
      label: `🌰 ${currentCost} 도토리로 즉시 회복`,
      sub: '', action: `sqInstantRecover('${sq.id}')`,
      bg: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', disabled: false
    });
  }

  // 4) 수습 농부 버튼 (관련 조건)
  if (sq.type === 'pet' && !isFarmer && !_isThisApprentice && !_isActiveFarmer) {
    const apprenticeDisabled = hasApprentice;
    buttons.push({
      label: apprenticeDisabled ? '🌾 다른 수습 중' : '🌾 농부로 전직',
      sub: apprenticeDisabled ? '' : '수습 기간 후 농부가 돼요',
      action: apprenticeDisabled ? '' : `farmStartApprentice('${sq.id}')`,
      bg: apprenticeDisabled ? '#f3f4f6' : '#ecfdf5',
      color: apprenticeDisabled ? '#9ca3af' : '#15803d',
      disabled: apprenticeDisabled
    });
  }

  // 5) 수습 완료 확인 버튼
  if (_isThisApprentice && _farmData?.apprentice_until) {
    const until = new Date(_farmData.apprentice_until);
    if (until - Date.now() <= 0) {
      buttons.push({
        label: '🎁 수습 결과 확인하기', sub: '',
        action: `farmRevealResult()`,
        bg: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: 'white', disabled: false
      });
    }
  }

  // 6) 관리자 수습 스킵
  if (_isThisApprentice && myProfile?.is_admin) {
    buttons.push({
      label: '⏩ 수습 스킵 (관리자)', sub: '',
      action: `farmSkipApprentice()`,
      bg: '#fef3c7', color: '#92400e', disabled: false
    });
  }

  // 7) 팔기 버튼 (맨 마지막)
  if (sq.status === 'idle' && sq.type !== 'baby' && !_isActiveFarmer && !_isThisApprentice) {
    buttons.push({
      label: '🏪 펫샵에 팔기', sub: '',
      action: `sqSellSquirrel('${sq.id}')`,
      bg: '#fee2e2', color: '#dc2626', disabled: false
    });
  } else if (_isActiveFarmer) {
    buttons.push({
      label: '🌾 농장에서 일하는 중', sub: '판매 불가',
      action: '', bg: '#f3f4f6', color: '#9ca3af', disabled: true
    });
  }

  // ── 버튼 HTML 생성 ──
  // 모달을 여는 액션(showTrainingModal, showExamModal)은 closeModal 불필요 (showModal이 교체함)
  // 즉시 실행 액션(sell, recover, farmStart 등)은 closeModal 필요
  const modalActions = ['sqShowTrainingModal', 'sqShowExamModal', 'farmRevealResult', 'sqSellSquirrel', 'farmStartApprentice', 'sqAdminResetCooldown', 'toast'];
  const btnHTML = buttons.map(b => {
    const needsClose = b.action && !modalActions.some(ma => b.action.includes(ma));
    const onclick = b.action ? (needsClose ? b.action + ';closeModal()' : b.action) : '';
    return `
    <button onclick="${onclick}" ${b.disabled ? 'disabled' : ''} style="width:100%;height:${b.sub ? '50px' : '40px'};border-radius:12px;border:none;background:${b.bg};color:${b.color};font-size:13px;font-weight:900;cursor:${b.disabled ? 'default' : 'pointer'};font-family:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;${b.disabled ? 'opacity:0.7;' : ''}">
      <span>${b.label}</span>
      ${b.sub ? `<span style="font-size:10px;font-weight:600;opacity:0.8">${b.sub}</span>` : ''}
    </button>`;
  }).join('');

  showModal(`
    <div style="text-align:center">
      <div style="border-radius:18px;${gs.border};box-shadow:${gs.shadow};padding:2px;display:inline-block;background:${gs.bg};margin-bottom:10px">
        <img src="images/squirrels/${spriteFile}.png" style="width:64px;height:64px;object-fit:contain;border-radius:14px;display:block" onerror="this.outerHTML='<div style=\\'font-size:48px;line-height:64px;text-align:center\\'>🦔</div>'">
      </div>
      <div style="font-size:18px;font-weight:900;color:#1f2937;margin-bottom:2px">${sq.name}</div>
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">${statusLabel}</div>
      <div style="display:flex;justify-content:center;gap:4px;margin-bottom:14px">
        <span style="font-size:9px;font-weight:900;color:${gs.color};background:${gs.color}15;padding:2px 8px;border-radius:8px">${gs.label}</span>
      </div>
      <div style="display:flex;gap:12px;justify-content:center;margin-bottom:16px">
        <div style="text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">❤️ HP</div>
          <div style="font-size:15px;font-weight:900;color:#ef4444">${sq.stats?.hp||60}<span style="font-size:9px;color:#d1d5db">/${hpMax}</span></div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">⚔️ 공격</div>
          <div style="font-size:15px;font-weight:900;color:#f97316">${sq.stats?.atk||10}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:#9ca3af;font-weight:800">🛡️ 방어</div>
          <div style="font-size:15px;font-weight:900;color:#3b82f6">${sq.stats?.def||5}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${btnHTML || '<div style="font-size:12px;color:#9ca3af;padding:8px">현재 가능한 액션이 없어요</div>'}
      </div>
      <button onclick="closeModal()" style="margin-top:12px;width:100%;height:36px;border-radius:10px;border:none;background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:13px;font-weight:900;cursor:pointer;font-family:inherit">닫기</button>
    </div>`);
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
        toast('🎁', `${sq.name}이(가) 털갈이를 합니다! 어떤 털 색깔을 가지고 있을까요?`);
        sendBrowserNotif('🐿️ 성장 완료!', `${sq.name}이(가) 성장을 마쳤어요! 어떤 다람쥐가 되었을지 확인해보세요.`);
      } else {
        // 중간 쉬는 타이머 → 도토리 주기 버튼 복원
        _sqShowFeedButtons(id);
        toast('🌱', `${sq.name}이(가) 다시 배가 고파졌어요!`);
        sendBrowserNotif('🐿️ 아기 다람쥐가 배가 고파요!', `${sq.name}이(가) 다시 배가 고파졌어요! 도토리를 주세요.`);
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
    const costEl = document.getElementById('sqRecoverCostText-' + id);
    if (costEl && remaining > 0) costEl.textContent = '🌰 ' + currentCost + ' 도토리로 회복';

    if (remaining <= 0) {
      _sqClearTimer(id);
      // 회복 완료 → idle 복원 + HP 풀회복
      const fullHp = sq.stats?.hp || 100;
      try {
        await sb.from('squirrels').update({ status: 'idle', recovers_at: null, hp_current: fullHp }).eq('id', id);
      } catch(e) {}
      _sqUpdate(id, { status: 'idle', recovers_at: null, hp_current: fullHp });
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
      toast('💚', `${sq.name}이(가) 회복되었어요!`);
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
    // 버튼 흔들기 + 실패 사운드
    const shakeBtn = document.getElementById('sqRecoverBtn-' + id);
    if (shakeBtn) {
      shakeBtn.style.animation = 'sqCardShake 0.4s ease';
      setTimeout(() => { if (shakeBtn) shakeBtn.style.animation = ''; }, 500);
    }
    _sqPlayFeedSound(false);
    toast('🌰', '도토리가 부족해요 (' + cost + '개 필요)');
    _sqSetIdle(id);
    return;
  }

  // 버튼 비활성화 + 누르는 애니메이션
  const recoverBtn = document.getElementById('sqRecoverBtn-' + id);
  if (recoverBtn) {
    recoverBtn.disabled = true;
    recoverBtn.style.opacity = '0.7';
    recoverBtn.style.pointerEvents = 'none';
  }

  try {
    await spendAcorns(cost, '다람쥐 즉시회복');
    const fullHp = sq.stats?.hp || 100;
    await sb.from('squirrels').update({ status: 'idle', recovers_at: null, hp_current: fullHp }).eq('id', id);
    _sqClearTimer(id);
    _sqUpdate(id, { status: 'idle', recovers_at: null, hp_current: fullHp });
    _sqSetIdle(id);

    // 회복 성공 사운드 (상승 치유음)
    _sqPlayRecoverSound();

    // 버튼 → 성공 애니메이션
    if (recoverBtn) {
      recoverBtn.style.transition = 'all 0.4s ease';
      recoverBtn.style.background = 'linear-gradient(135deg,#86efac,#34d399,#10b981)';
      recoverBtn.style.animation = 'none';
      recoverBtn.style.color = 'white';
      recoverBtn.style.boxShadow = '0 4px 0 #059669,0 6px 20px rgba(16,185,129,0.35)';
      recoverBtn.style.opacity = '1';
      recoverBtn.innerHTML = '<span style="position:absolute;top:3px;left:15%;right:15%;height:10px;background:rgba(255,255,255,0.4);border-radius:99px;pointer-events:none;filter:blur(1px)"></span><span style="position:relative;display:flex;align-items:center;gap:6px">💚 회복 완료!</span>';
      void recoverBtn.offsetWidth;
      recoverBtn.style.animation = 'sqRecoverSuccess 0.5s ease';
    }

    // 파티클 이펙트
    const cardEl = document.getElementById('sqCard-' + id);
    if (cardEl) {
      _sqRecoverParticles(cardEl);
    }

    // 카드 교체 (약간 딜레이)
    setTimeout(() => {
      const cardEl2 = document.getElementById('sqCard-' + id);
      if (cardEl2) {
        const updatedSq = _sqSquirrels.find(s => s.id === id);
        if (updatedSq) {
          const tmp = document.createElement('div');
          tmp.innerHTML = sqCardHTML(updatedSq);
          cardEl2.replaceWith(tmp.firstElementChild);
        }
      }
    }, 800);

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
    _sqUpdate(id, { type: growType, status: 'idle', grows_at: null });
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
      _sqUpdate(id, { type: growType, status: 'idle', grows_at: null });
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
    updates.type = growType;
    updates.status = 'idle';
    updates.grows_at = null;
    updates.sprite = _sqRandomSprite();
    action = 'grow:' + growType;
  }
  // 4) needs_time 없이 100% 도달 → 성장
  else if (!sq.needs_time && !sq.grows_at && newFed >= sq.acorns_required) {
    const growType = Math.random() < 0.5 ? 'explorer' : 'pet';
    updates.type = growType;
    updates.status = 'idle';
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

      // busy는 _sqStartTimer 완료 시 풀림 (_sqSetIdle in timer)

    } else if (action.startsWith('grow:')) {
      const growType = action.split(':')[1];
      _sqUpdate(id, { type: growType, status: 'idle', grows_at: null, sprite: updates.sprite });
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

    const grid = document.getElementById('squirrelGrid');
    const countEl = document.getElementById('squirrelCount');
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
      '<div style="font-size:11px;letter-spacing:3px;color:#fbbf24;margin-bottom:6px">✦ NEW SQUIRREL ✦</div>' +
      '<div style="font-size:22px;font-weight:900;color:white;text-shadow:0 0 20px rgba(251,191,36,.4)">아기 다람쥐 등장!</div>' +
      '<div style="font-size:12px;color:#a5b4fc;margin-top:6px;line-height:1.5">도토리를 먹여서 어떤 다람쥐로<br>성장할지 확인해보세요</div>' +
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

// ================================================================
//  성장 결과 확인 (시간 경과 후 성장 준비 완료된 다람쥐)
// ================================================================
async function sqRevealGrowth(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq || sq.type !== 'baby') return;

  const growType = Math.random() < 0.5 ? 'explorer' : 'pet';
  const sprite = _sqRandomSprite();
  // 훈련 횟수 부여 (가중치 랜덤)
  const countPool = _sqSettings.training_count_pool || _sqBuildWeightedPool(_sqSettings.training_count_min ?? 0, _sqSettings.training_count_max || 2);
  const trainingTotal = _sqPickFromPool(countPool);
  try {
    await sb.from('squirrels').update({
      type: growType, status: 'idle', grows_at: null, sprite: sprite,
      training_total: trainingTotal, training_used: 0
    }).eq('id', id);
    _sqUpdate(id, {
      type: growType, status: 'idle', grows_at: null, sprite: sprite,
      training_total: trainingTotal, training_used: 0
    });
    // 성장 연출 (흔들림 → 페이드 → 새 카드)
    _sqGrowCard(id, sq.name, growType);
  } catch(e) {
    console.error(e);
    toast('❌', '성장 처리 중 오류');
  }
}

// ================================================================
//  훈련 시스템
// ================================================================

// 가중치 풀에서 랜덤 뽑기 (범용)
function _sqPickFromPool(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}
// min~max 범위에서 낮은 값이 더 자주 나오는 가중치 풀 생성
function _sqBuildWeightedPool(min, max) {
  const pool = [];
  for (let v = min; v <= max; v++) {
    const weight = max - v + 1; // 낮을수록 가중치 높음
    for (let w = 0; w < weight; w++) pool.push(v);
  }
  return pool.length ? pool : [min];
}

// 훈련 실행
async function sqDoTraining(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  if (sq.type === 'baby') { toast('⚠️', '아기 다람쥐는 훈련할 수 없어요'); return; }

  const total = sq.training_total || 0;
  const used  = sq.training_used  || 0;
  const remain = total - used;
  if (remain <= 0) { toast('⚠️', '남은 훈련 횟수가 없어요'); return; }

  const hpMax = _sqSettings.stat_hp_max || 150;
  const currentHp = sq.stats?.hp || 60;
  if (currentHp >= hpMax) { toast('⚠️', 'HP가 이미 최대치예요!'); return; }

  // 5회 개별 판정: 각 동그라미마다 성공/실패 → 3개 이상 성공 시 최종 성공
  const dotRate = _sqSettings.training_dot_rate || 30;
  const dotResults = [];
  for (let i = 0; i < 5; i++) {
    dotResults.push(Math.random() * 100 < dotRate);
  }
  const dotSuccessCount = dotResults.filter(Boolean).length;
  const success = dotSuccessCount >= 3;

  const newUsed = used + 1;
  let newHp = currentHp;
  let hpGain = 0;
  let newGrade = _sqCalcGrade(sq);
  let gradeUp = false;

  if (success) {
    const hpPool = _sqSettings.training_hp_pool || _sqBuildWeightedPool(_sqSettings.training_hp_min || 1, _sqSettings.training_hp_max || 10);
    hpGain = _sqPickFromPool(hpPool);
    newHp = Math.min(currentHp + hpGain, hpMax);

    // 등급 재계산
    const oldGrade = newGrade;
    const tempSq = { stats: { hp: newHp, atk: sq.stats?.atk || 8, def: sq.stats?.def || 4 } };
    newGrade = _sqCalcGrade(tempSq);
    gradeUp = _sqGradeOrder.indexOf(newGrade) > _sqGradeOrder.indexOf(oldGrade);
  }

  // DB 업데이트
  const updatedStats = { ...sq.stats, hp: newHp };
  try {
    await sb.from('squirrels').update({
      stats: updatedStats,
      hp_current: newHp,
      training_used: newUsed
    }).eq('id', id);
    _sqUpdate(id, { stats: updatedStats, hp_current: newHp, training_used: newUsed });
  } catch(e) {
    console.error(e);
    toast('❌', '훈련 처리 중 오류');
    return;
  }

  // 결과 반환 (UI에서 사용)
  return { success, dotResults, dotSuccessCount, hpGain, newHp, hpMax, currentHp, newGrade, gradeUp, remain: remain - 1, total };
}

// 훈련 확인 모달
function sqShowTrainingModal(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  const tRemain = (sq.training_total || 0) - (sq.training_used || 0);
  const grade = _sqCalcGrade(sq);
  const gs = _sqGradeStyle(grade);
  showModal(`
    <div style="text-align:center">
      <div style="font-size:40px;margin-bottom:8px">🏋️</div>
      <div style="font-size:18px;font-weight:900;color:var(--modal-title-text);margin-bottom:4px">체력 훈련</div>
      <div style="font-size:13px;color:var(--modal-subtitle-text);margin-bottom:16px">${sq.name}의 HP를 강화합니다</div>
      <div style="background:var(--modal-infobox-bg);border-radius:14px;padding:14px;margin-bottom:16px;text-align:left">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--modal-infobox-text)">현재 HP</span>
          <span style="font-size:12px;font-weight:900;color:#ef4444">${sq.stats?.hp || 60} / ${_sqSettings.stat_hp_max || 150}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--modal-infobox-text)">현재 등급</span>
          <span style="font-size:12px;font-weight:900;color:${gs.color}">${gs.label}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--modal-infobox-text)">남은 훈련 횟수</span>
          <span style="font-size:12px;font-weight:900;color:#0284c7">${tRemain}회</span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="sqExecuteTraining('${sq.id}')" style="flex:1;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#38bdf8,#0284c7);color:white;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 4px 0 #0369a1,0 6px 16px rgba(2,132,199,.3);font-family:inherit;transition:transform .1s" onmousedown="this.style.transform='translateY(3px)';this.style.boxShadow='0 1px 0 #0369a1'" onmouseup="this.style.transform='';this.style.boxShadow='0 4px 0 #0369a1,0 6px 16px rgba(2,132,199,.3)'">💪 훈련하기!</button>
        <button onclick="closeModal()" style="flex:1;height:42px;border-radius:12px;border:none;background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:15px;font-weight:900;cursor:pointer;font-family:inherit">취소</button>
      </div>
    </div>`);
}

// 훈련 중 별 파티클 생성
function _trainStarBurst(container, count) {
  const emojis = ['⭐','✨','💥','🔥','💪'];
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    const angle = (Math.PI * 2 * i) / count;
    const dist = 40 + Math.random() * 50;
    s.textContent = emojis[i % emojis.length];
    s.style.cssText = `position:absolute;top:50%;left:50%;font-size:${14 + Math.random()*10}px;pointer-events:none;z-index:10;--sx:${Math.cos(angle)*dist}px;--sy:${Math.sin(angle)*dist}px;animation:trainStarBurst 0.6s ${i*0.04}s ease-out forwards`;
    container.appendChild(s);
  }
}

// 훈련 실행 + 시네마틱 연출 (5회 개별 판정 연출)
async function sqExecuteTraining(id) {
  // ── 0단계: 결과 먼저 판정 (DB 반영 포함) ──
  const result = await sqDoTraining(id);
  if (!result) { closeModal(); return; }

  // ── 1단계: 훈련 시작 사운드 + 준비 화면 (5개 빈 동그라미) ──
  playSound('trainStart');

  const dotHtml = result.dotResults.map((_, i) =>
    `<span id="trainDot${i}" style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#555;margin:0 6px;transition:all 0.3s"></span>`
  ).join('');

  showModal(`
    <div id="trainCinematic" style="text-align:center;min-height:220px;position:relative;overflow:hidden">
      <div id="trainEmoji" style="font-size:56px;margin:20px 0 12px">🏋️</div>
      <div style="font-size:16px;font-weight:900;color:var(--text);margin-bottom:16px">훈련 중...</div>
      <div id="trainDots" style="display:flex;justify-content:center;align-items:center;gap:4px;margin:16px 0">${dotHtml}</div>
      <div id="trainParticles" style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none"></div>
    </div>`, { noClose: true });

  const emoji = document.getElementById('trainEmoji');
  const particles = document.getElementById('trainParticles');

  // ── 2단계: 5개 동그라미 순차 판정 연출 ──
  for (let i = 0; i < 5; i++) {
    // 펌프 애니메이션
    if (emoji) { emoji.style.animation = ''; void emoji.offsetWidth; emoji.style.animation = 'trainPump 0.5s ease-in-out'; }
    playSound('trainPunch');
    await new Promise(r => setTimeout(r, 600));

    // 동그라미 결과 표시
    const dot = document.getElementById('trainDot' + i);
    const isSuccess = result.dotResults[i];
    if (dot) {
      dot.style.transform = 'scale(1.3)';
      if (isSuccess) {
        dot.style.background = '#22c55e';
        dot.style.boxShadow = '0 0 14px #22c55e';
        playSound('trainDotSuccess');
      } else {
        dot.style.background = '#ef4444';
        dot.style.boxShadow = '0 0 14px #ef4444';
        playSound('trainDotFail');
      }
      setTimeout(() => { if (dot) dot.style.transform = 'scale(1)'; }, 200);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── 3단계: 잠깐 대기 후 결과 화면 전환 ──
  await new Promise(r => setTimeout(r, 600));

  const sq = _sqSquirrels.find(s => s.id === id);
  const gs = _sqGradeStyle(result.newGrade);
  const hpPctFrom = Math.round((result.currentHp / result.hpMax) * 100);
  const hpPctTo = Math.round((result.newHp / result.hpMax) * 100);

  // 잠깐 멈추고 결과 전환
  await new Promise(r => setTimeout(r, 300));

  if (result.success) {
    playSound('trainSuccess');
    if (particles) _trainStarBurst(particles, 10);

    showModal(`
      <div style="text-align:center;position:relative;overflow:hidden">
        <div style="position:relative;display:inline-block">
          <div style="font-size:52px;animation:trainPump 0.6s ease-in-out">💪</div>
        </div>
        <div style="font-size:22px;font-weight:900;color:#059669;margin:8px 0 2px;animation:trainFadeUp 0.4s ease-out">훈련 성공!</div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:16px;animation:trainFadeUp 0.4s 0.1s ease-out both">체력이 강화되었어요!</div>

        <div style="background:#f0fdf4;border-radius:14px;padding:16px;margin-bottom:10px;animation:trainFadeUp 0.4s 0.2s ease-out both">
          <div style="font-size:28px;font-weight:900;color:#15803d;margin-bottom:8px;animation:trainCountPop 0.5s 0.5s ease-out both">HP +${result.hpGain}</div>
          <div style="font-size:18px;font-weight:900;color:#ef4444;margin-bottom:10px">${result.currentHp} → ${result.newHp}<span style="font-size:12px;color:#d1d5db"> / ${result.hpMax}</span></div>
          <div style="background:#e5e7eb;border-radius:8px;height:12px;overflow:hidden;position:relative">
            <div style="--hp-from:${hpPctFrom}%;--hp-to:${hpPctTo}%;height:100%;border-radius:8px;background:linear-gradient(90deg,#22c55e,#16a34a);animation:trainHpFill 0.8s 0.4s ease-out both"></div>
          </div>
        </div>

        ${result.gradeUp ? `
          <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:14px;padding:14px;margin-bottom:10px;border:2px solid rgba(251,191,36,.3);animation:trainFadeUp 0.4s 0.6s ease-out both">
            <div style="font-size:28px;margin-bottom:4px">🎉</div>
            <div style="font-size:16px;font-weight:900;color:#78350f">등급 승급!</div>
            <div style="font-size:14px;font-weight:800;color:${gs.color};margin-top:4px">${gs.label} 등급 달성!</div>
          </div>` : ''}

        <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">남은 훈련 횟수: ${result.remain}회</div>
        <div style="display:flex;gap:8px">
          ${result.remain > 0 && result.newHp < result.hpMax ? `<button onclick="sqShowTrainingModal('${id}')" style="flex:1;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#38bdf8,#0284c7);color:white;font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 4px 0 #0369a1">계속 훈련</button>` : ''}
          <button onclick="closeModal()" style="flex:1;height:42px;border-radius:12px;border:none;background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:14px;font-weight:900;cursor:pointer;font-family:inherit">닫기</button>
        </div>
      </div>`);

    if (result.gradeUp) setTimeout(() => playSound('trainGradeUp'), 600);

  } else {
    playSound('trainFail');

    showModal(`
      <div style="text-align:center">
        <div style="font-size:52px;animation:trainShake 0.5s ease-in-out">😓</div>
        <div style="font-size:22px;font-weight:900;color:#dc2626;margin:8px 0 2px;animation:trainFadeUp 0.4s ease-out">훈련 실패...</div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:16px;animation:trainFadeUp 0.4s 0.1s ease-out both">이번에는 성과가 없었어요</div>

        <div style="background:#fef2f2;border-radius:14px;padding:16px;margin-bottom:10px;animation:trainFadeUp 0.4s 0.2s ease-out both">
          <div style="font-size:14px;font-weight:800;color:#dc2626;margin-bottom:6px">HP 변동 없음</div>
          <div style="font-size:18px;font-weight:900;color:#ef4444;margin-bottom:10px">❤️ ${result.newHp}<span style="font-size:12px;color:#d1d5db"> / ${result.hpMax}</span></div>
          <div style="background:#e5e7eb;border-radius:8px;height:12px;overflow:hidden">
            <div style="width:${hpPctTo}%;height:100%;border-radius:8px;background:linear-gradient(90deg,#ef4444,#dc2626)"></div>
          </div>
        </div>

        <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">남은 훈련 횟수: ${result.remain}회</div>
        <div style="display:flex;gap:8px">
          ${result.remain > 0 ? `<button onclick="sqShowTrainingModal('${id}')" style="flex:1;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#38bdf8,#0284c7);color:white;font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 4px 0 #0369a1">다시 훈련</button>` : ''}
          <button onclick="closeModal()" style="flex:1;height:42px;border-radius:12px;border:none;background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:14px;font-weight:900;cursor:pointer;font-family:inherit">닫기</button>
        </div>
      </div>`);
  }

  // 카드 갱신
  const cardEl = document.getElementById('sqCard-' + id);
  if (cardEl && sq) {
    const tmp = document.createElement('div');
    tmp.innerHTML = sqCardHTML(sq);
    cardEl.replaceWith(tmp.firstElementChild);
  }
}

// ================================================================
//  등급심사 시스템
// ================================================================

// 심사 가능 여부 체크
function sqCanExam(sq) {
  if (!sq || sq.type === 'baby') return { ok: false, reason: '아기 다람쥐는 심사할 수 없어요' };
  const total = sq.training_total || 0;
  const used  = sq.training_used  || 0;
  if (used < total) return { ok: false, reason: '아직 훈련 횟수가 남아있어요 (' + (total - used) + '회)' };
  const hpMax = _sqSettings.stat_hp_max || 150;
  if ((sq.stats?.hp || 60) >= hpMax) return { ok: false, reason: 'HP가 이미 최대치예요' };
  // 쿨타임 체크
  if (sq.exam_cooldown_until) {
    const cooldownEnd = new Date(sq.exam_cooldown_until);
    if (cooldownEnd > new Date()) {
      const remain = cooldownEnd - Date.now();
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      return { ok: false, reason: '재심사 대기 중 (' + h + '시간 ' + m + '분 남음)' };
    }
  }
  return { ok: true };
}

// 심사 실행 (코어 로직)
async function sqDoExam(id, itemCount) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return null;

  const check = sqCanExam(sq);
  if (!check.ok) { toast('⚠️', check.reason); return null; }

  itemCount = itemCount || 0;
  const maxItems = _sqSettings.exam_item_max || 12;
  itemCount = Math.min(itemCount, maxItems);

  // 도토리 차감
  const cost = _sqSettings.exam_cost || 10;
  if (!myProfile?.is_admin) {
    if ((myProfile?.acorns || 0) < cost) { toast('⚠️', '도토리가 부족해요 (필요: ' + cost + '🌰)'); return null; }
    const spendRes = await spendAcorns(cost, '등급심사 비용');
    if (spendRes.error) { toast('❌', '도토리 차감 실패'); return null; }
  }

  // 아이템 차감
  if (itemCount > 0) {
    const consumed = await consumeItem(myProfile.id, '반짝이는 무언가', itemCount);
    if (!consumed) {
      // 아이템 부족 → 도토리 환불
      if (!myProfile?.is_admin) {
        await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: cost, p_reason: '등급심사 아이템 부족 환불' });
        myProfile.acorns = (myProfile.acorns || 0) + cost;
        if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
      }
      toast('⚠️', '반짝이는 무언가가 부족해요');
      return null;
    }
  }

  // 합격 판정
  const baseRate = _sqSettings.exam_pass_rate || 40;
  const boost = (_sqSettings.exam_item_boost || 5) * itemCount;
  const finalRate = Math.min(baseRate + boost, 100);
  const roll = Math.random() * 100;
  const passed = roll < finalRate;

  if (passed) {
    // 합격: 훈련 횟수 리셋 후 새로 부여 (누적 아님)
    const bonusMin = _sqSettings.exam_bonus_min || 1;
    const bonusMax = _sqSettings.exam_bonus_max || 1;
    const bonus = bonusMin + Math.floor(Math.random() * (bonusMax - bonusMin + 1));

    await sb.from('squirrels').update({
      training_total: bonus,
      training_used: 0,
      exam_cooldown_until: null
    }).eq('id', id);
    _sqUpdate(id, { training_total: bonus, training_used: 0, exam_cooldown_until: null });

    return { passed: true, bonus, finalRate, itemCount, cost };
  } else {
    // 불합격: 쿨타임 적용
    const cooldownHours = _sqSettings.exam_cooldown_hours || 48;
    const cooldownUntil = new Date(Date.now() + cooldownHours * 3600000).toISOString();

    await sb.from('squirrels').update({
      exam_cooldown_until: cooldownUntil
    }).eq('id', id);
    _sqUpdate(id, { exam_cooldown_until: cooldownUntil });

    return { passed: false, cooldownHours, finalRate, itemCount, cost };
  }
}

// 심사 확인 모달 (아이템 사용 수량 선택 포함)
async function sqShowExamModal(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;

  const check = sqCanExam(sq);
  if (!check.ok) { toast('⚠️', check.reason); return; }

  const cost = _sqSettings.exam_cost || 10;
  const baseRate = _sqSettings.exam_pass_rate || 40;
  const boostPer = _sqSettings.exam_item_boost || 5;
  const maxItems = _sqSettings.exam_item_max || 12;
  const grade = _sqCalcGrade(sq);
  const gs = _sqGradeStyle(grade);

  // 보유 아이템 수량 조회
  const ownedItems = await getItemQuantity(myProfile.id, '반짝이는 무언가');
  const usableItems = Math.min(ownedItems, maxItems);

  // 아이템 0개 사용이 기본값, 보유 수량도 저장
  window._sqExamItemCount = 0;
  window._sqExamUsableItems = usableItems;

  showModal(`
    <div style="text-align:center">
      <div style="font-size:40px;margin-bottom:8px">📋</div>
      <div style="font-size:18px;font-weight:900;color:var(--modal-title-text);margin-bottom:4px">등급심사 신청</div>
      <div style="font-size:13px;color:var(--modal-subtitle-text);margin-bottom:16px">${sq.name}의 추가 훈련 기회를 얻을 수 있어요</div>
      <div style="background:var(--modal-infobox-bg);border-radius:14px;padding:14px;margin-bottom:12px;text-align:left">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--modal-infobox-text)">현재 등급</span>
          <span style="font-size:12px;font-weight:900;color:${gs.color}">${gs.label}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--modal-infobox-text)">심사 비용</span>
          <span style="font-size:12px;font-weight:900;color:#d97706">🌰 ${cost} 도토리</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:12px;color:var(--modal-infobox-text)">기본 합격률</span>
          <span style="font-size:12px;font-weight:900;color:#059669">${baseRate}%</span>
        </div>
      </div>
      ${usableItems > 0 ? `
        <div style="background:var(--modal-itembox-bg);border-radius:14px;padding:14px;margin-bottom:12px">
          <div style="font-size:12px;font-weight:800;color:var(--modal-itembox-text);margin-bottom:8px">✨ 반짝이는 무언가 (보유: ${ownedItems}개)</div>
          <div style="font-size:11px;color:#ef4444;margin-bottom:8px">심사관에게 건네면 좋은 일이 생길지도...?</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:10px">
            <button onclick="_sqExamItemAdj(-1)" style="width:32px;height:32px;border-radius:10px;border:2px solid var(--modal-itembox-border);background:var(--modal-itembox-bg);color:var(--modal-itembox-text);font-size:16px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit">−</button>
            <span id="sqExamItemCount" style="min-width:32px;text-align:center;font-size:20px;font-weight:900;color:var(--modal-itembox-text)">0</span>
            <button onclick="_sqExamItemAdj(1)" style="width:32px;height:32px;border-radius:10px;border:2px solid var(--modal-itembox-border);background:var(--modal-itembox-bg);color:var(--modal-itembox-text);font-size:16px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit">＋</button>
          </div>
        </div>` : `
        <div style="background:var(--modal-hintbox-bg);border-radius:14px;padding:10px;margin-bottom:12px">
          <div style="font-size:11px;color:var(--modal-hintbox-text)">심사관에게 뇌물을 주면 합격률을 올릴 수 있다는데... ✨</div>
        </div>`}
      <div style="display:flex;gap:8px">
        <button onclick="sqExecuteExam('${sq.id}')" style="flex:1;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#a78bfa,#7c3aed);color:white;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 4px 0 #5b21b6,0 6px 16px rgba(124,58,237,.3);font-family:inherit;transition:transform .1s" onmousedown="this.style.transform='translateY(3px)';this.style.boxShadow='0 1px 0 #5b21b6'" onmouseup="this.style.transform='';this.style.boxShadow='0 4px 0 #5b21b6,0 6px 16px rgba(124,58,237,.3)'">📋 심사 받기!</button>
        <button onclick="closeModal()" style="flex:1;height:42px;border-radius:12px;border:none;background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:15px;font-weight:900;cursor:pointer;font-family:inherit">취소</button>
      </div>
    </div>`);
}

// 아이템 수량 조절
function _sqExamItemAdj(delta) {
  const baseRate = _sqSettings.exam_pass_rate || 40;
  const boostPer = _sqSettings.exam_item_boost || 5;
  const maxItems = _sqSettings.exam_item_max || 12;
  var count = (window._sqExamItemCount || 0) + delta;
  // 보유 수량과 max 둘 다 제한
  const usable = window._sqExamUsableItems || 0;
  count = Math.max(0, Math.min(count, maxItems, usable));
  window._sqExamItemCount = count;
  const el = document.getElementById('sqExamItemCount');
  if (el) el.textContent = count;
  const rateEl = document.getElementById('sqExamFinalRate');
}

// ================================================================
//  심사 연출 시스템
// ================================================================

// 심사 전용 BGM 재생/정지
var _sqExamBGM = null;
function _sqExamPlayBGM() {
  _sqExamStopBGM();
  // 기존 BGM 정지
  if (typeof _sndStopBGM === 'function') _sndStopBGM();
  _sqExamBGM = new Audio('sounds/exam/grade1.mp3');
  _sqExamBGM.volume = (typeof _sndVolBGM !== 'undefined') ? _sndVolBGM : 0.5;
  _sqExamBGM.loop = true;
  _sqExamBGM.play().catch(function(){});
}
function _sqExamStopBGM() {
  if (_sqExamBGM) {
    _sqExamBGM.pause();
    _sqExamBGM.currentTime = 0;
    _sqExamBGM = null;
  }
}
// 도장 효과음 (1회 재생)
function _sqExamPlayStamp() {
  var sfx = new Audio('sounds/exam/stamp.m4a');
  sfx.volume = (typeof _sndVolBGM !== 'undefined') ? Math.min(_sndVolBGM + 0.2, 1) : 0.7;
  sfx.play().catch(function(){});
}

// 타이핑 애니메이션 헬퍼 (\n → <br> 지원)
// ── Animalese 음성 엔진 (여우 목소리, 1.2배속) ──
var _sqAnimalese = {
  voice: { base: 260, range: 50, speed: 0.058, syllable: 0.065, waveType: 'bright', vibrato: 5, vibratoDepth: 6 },
  speedMul: 1.2,
  _master: null,
  getCtx: function() {
    // 앱 메인 AudioContext 공유 (모바일 볼륨 제한 해결)
    if (typeof _audioCtx !== 'undefined' && _audioCtx) {
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      return _audioCtx;
    }
    // fallback
    if (!this._fallbackCtx) this._fallbackCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._fallbackCtx.state === 'suspended') this._fallbackCtx.resume();
    return this._fallbackCtx;
  },
  getMaster: function() {
    var ctx = this.getCtx();
    if (!this._master || this._master.context !== ctx) {
      this._master = ctx.createGain();
      // PC/모바일 동일: 소스 볼륨 자체가 충분하므로 직결
      this._master.connect(ctx.destination);
    }
    // 앱 볼륨 연동 (PC/모바일 베이스 볼륨 분리)
    var _mob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var baseVol = _mob ? 1.0 : 0.75;
    this._master.gain.value = baseVol * (typeof getAppVolume === 'function' ? getAppVolume() : 1);
    return this._master;
  },
  VOWEL_PITCH: [0,-2,3,1,-3,-1,5,3,2,4,1,3,6,-4,-2,-1,0,-5,-1,1,2],
  CHO_WEIGHT: [0,0,1,0,0,2,1,0,0,0,0,-1,0,0,1,1,1,1,1],
  decompose: function(ch) {
    var c = ch.charCodeAt(0);
    if (c < 0xAC00 || c > 0xD7A3) return null;
    var off = c - 0xAC00;
    return { cho: Math.floor(off/(21*28)), jung: Math.floor((off%(21*28))/28), jong: off%28 };
  },
  playSyllable: function(ch, charIdx, totalLen) {
    var ctx = this.getCtx();
    var v = this.voice;
    var sm = this.speedMul;
    var master = this.getMaster();
    if (/[\s.,!?…~\n]/.test(ch)) return;

    var hangul = this.decompose(ch);
    var pitchOffset, hasJong = false;
    if (hangul) {
      var vowelP = this.VOWEL_PITCH[hangul.jung] || 0;
      var choW = this.CHO_WEIGHT[hangul.cho] || 0;
      var contour = Math.sin((charIdx / totalLen) * Math.PI) * 3;
      var jitter = (Math.random() - 0.5) * 4;
      pitchOffset = vowelP + choW + contour + jitter;
      hasJong = hangul.jong > 0;
    } else {
      pitchOffset = (Math.random() - 0.5) * 6;
    }

    var dur = (v.syllable / sm) * (hasJong ? 1.3 : 1.0);
    var freq = v.base + pitchOffset * (v.range / 12);
    var t = ctx.currentTime + 0.01;

    var osc1 = ctx.createOscillator(); osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, t);
    osc1.frequency.linearRampToValueAtTime(freq * (1 + (Math.random()-0.5)*0.06), t + dur*0.5);
    osc1.frequency.linearRampToValueAtTime(freq * 0.97, t + dur);

    var osc2 = ctx.createOscillator(); osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, t);
    osc2.frequency.linearRampToValueAtTime(freq * 2 * 0.96, t + dur);

    var osc3 = ctx.createOscillator(); osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 1.005, t);
    osc3.frequency.linearRampToValueAtTime(freq * 0.995, t + dur);

    var vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = v.vibrato;
    var vibG = ctx.createGain(); vibG.gain.value = v.vibratoDepth;
    vib.connect(vibG); vibG.connect(osc1.frequency); vibG.connect(osc3.frequency);

    var g1 = ctx.createGain(); var g2 = ctx.createGain(); var g3 = ctx.createGain();
    g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(0.45, t+dur*0.08);
    g1.gain.setValueAtTime(0.45, t+dur*0.5); g1.gain.linearRampToValueAtTime(0, t+dur);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.15, t+dur*0.08);
    g2.gain.linearRampToValueAtTime(0, t+dur*0.8);
    g3.gain.setValueAtTime(0, t); g3.gain.linearRampToValueAtTime(0.22, t+dur*0.1);
    g3.gain.linearRampToValueAtTime(0, t+dur);

    osc1.connect(g1); osc2.connect(g2); osc3.connect(g3);
    var merger = ctx.createGain(); merger.gain.value = 1.0;
    g1.connect(merger); g2.connect(merger); g3.connect(merger);

    var lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass';
    lpf.frequency.value = freq * 4; lpf.Q.value = 0.7;
    merger.connect(lpf); lpf.connect(master);

    var end = t + dur + 0.02;
    osc1.start(t); osc1.stop(end);
    osc2.start(t); osc2.stop(end);
    osc3.start(t); osc3.stop(end);
    vib.start(t); vib.stop(end);
  }
};

function _sqTypeText(elementId, text, speed, callback) {
  const el = document.getElementById(elementId);
  if (!el) { if (callback) callback(); return; }
  // flex 컨테이너면 내부 span 사용
  let target = el.querySelector('.exam-txt-inner');
  if (!target) {
    el.innerHTML = '<span class="exam-txt-inner" style="display:block;width:100%;text-align:center"></span>';
    target = el.querySelector('.exam-txt-inner');
  }
  target.innerHTML = '';
  const totalLen = text.length;
  let i = 0;
  const interval = setInterval(() => {
    if (i < totalLen) {
      const ch = text[i];
      if (ch === '\n') {
        target.innerHTML += '<br>';
      } else {
        target.innerHTML += ch;
        _sqAnimalese.playSyllable(ch, i, totalLen);
      }
      i++;
    } else {
      clearInterval(interval);
      if (callback) callback();
    }
  }, speed || 40);
}

// 화면 흔들림 효과
function _sqShakeScreen() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  let count = 0;
  const shake = setInterval(() => {
    const x = (Math.random() - 0.5) * 14;
    const y = (Math.random() - 0.5) * 10;
    modal.style.transform = `translate(${x}px, ${y}px)`;
    count++;
    if (count > 10) {
      clearInterval(shake);
      modal.style.transform = '';
    }
  }, 45);
}

// 심사 실행 + 연출 시퀀스
async function sqExecuteExam(id) {
  const itemCount = window._sqExamItemCount || 0;

  // ── 도토리 사전 체크 (시네마틱 시작 전) ──
  const cost = _sqSettings.exam_cost || 10;
  if (!myProfile?.is_admin) {
    if ((myProfile?.acorns || 0) < cost) {
      toast('⚠️', '도토리가 부족해요 (필요: ' + cost + '🌰)');
      return;
    }
  }

  // ── BGM 시작 ──
  _sqExamPlayBGM();

  // ── 모달: 합친 이미지 1장 + 텍스트 오버레이 + 하단 결과 ──
  showModal(`
    <div id="examCinematic" style="border-radius:16px;margin:-20px;background:#1a1008;overflow:hidden">
      <!-- 1번 공간: 이미지 + 오버레이 -->
      <div id="examImgWrap" style="position:relative;overflow:hidden">
        <img src="images/exam/exam_all.png" id="examSceneImg" style="width:100%;display:block;opacity:0;transition:opacity 0.8s">
        <!-- 도장 (이미지 정중앙) -->
        <div id="examStampArea" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2"></div>
        <!-- 텍스트 (대사창 영역 위에 오버레이) -->
        <div id="examDialogueText" style="position:absolute;bottom:4%;left:10%;right:10%;top:64%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#5c3d1e !important;-webkit-text-fill-color:#5c3d1e;line-height:1.5;text-align:center;word-break:keep-all;overflow-wrap:break-word;z-index:3"></div>
      </div>
      <!-- 2번 공간: 결과 + 확인 버튼 -->
      <div id="examBottomArea" style="background:#1a1008;padding:8px 16px 16px;display:none">
        <div id="examResultInfo" style="margin-bottom:8px"></div>
        <button onclick="_sqExamClose('${id}')" style="width:100%;height:40px;border-radius:12px;border:none;background:rgba(255,255,255,0.12);color:#e8d5b7;font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;position:relative;z-index:10">확인</button>
      </div>
    </div>`, { noClose: true });

  // 클릭 대기 헬퍼: 이미지 영역 클릭 시 resolve + 효과음
  function _waitClick() {
    return new Promise(r => {
      const wrap = document.getElementById('examImgWrap');
      if (!wrap) { r(); return; }
      wrap.style.cursor = 'pointer';
      function handler() { wrap.removeEventListener('click', handler); wrap.style.cursor = ''; playSound('click'); r(); }
      wrap.addEventListener('click', handler);
    });
  }

  try {
    // 전경 페이드인
    await new Promise(r => setTimeout(r, 100));
    const sceneImg = document.getElementById('examSceneImg');
    if (sceneImg) sceneImg.style.opacity = '1';
    await new Promise(r => setTimeout(r, 800));

    // ── 대사 1: 인사 (타이핑 완료 → 클릭 대기) ──
    const greetings = itemCount > 0
      ? '오호, 반짝이는 무언가를가져왔군...\n어디 한번 살펴볼까?'
      : '흠... 어디 한번 실력을 볼까?';
    await new Promise(r => _sqTypeText('examDialogueText', greetings, 40, r));
    await _waitClick();

    // ── 심사 실행 (백엔드, 클릭 직후 바로 실행) ──
    let result;
    try {
      result = await sqDoExam(id, itemCount);
    } catch (e) {
      console.error('sqDoExam error:', e);
      _sqExamStopBGM(); closeModal(); return;
    }
    if (!result) { _sqExamStopBGM(); closeModal(); return; }

    // ── 대사 2: 심사 중 (타이핑 완료 → 클릭 대기) ──
    await new Promise(r => _sqTypeText('examDialogueText', '음... 서류를 확인하고 있어...\n잠깐만...', 40, r));
    await _waitClick();

    // ── 서스펜스 대사: " . . .   . . . " ──
    await new Promise(r => _sqTypeText('examDialogueText', '.\u00a0.\u00a0.\u00a0\u00a0\u00a0.\u00a0.\u00a0.', 170, r));

    // ── 도장 애니메이션 ──
    const stampArea = document.getElementById('examStampArea');

    if (result.passed) {
      if (stampArea) {
        stampArea.innerHTML = `
          <div id="examStamp" style="font-size:48px;font-weight:900;color:#16a34a;opacity:0;transform:scale(4) rotate(-15deg);transition:all 0.35s cubic-bezier(0.17,0.67,0.21,1.3);filter:drop-shadow(0 4px 16px rgba(5,150,105,0.5));pointer-events:none">
            <div style="border:4px solid #22c55e;border-radius:12px;padding:6px 20px;background:rgba(34,197,94,0.15)">합격</div>
          </div>`;
      }
      const stamp = document.getElementById('examStamp');
      if (stamp) { stamp.style.opacity = '1'; stamp.style.transform = 'scale(1) rotate(-5deg)'; }
      await new Promise(r => setTimeout(r, 30));
      _sqExamPlayStamp();

      // 합격 대사 (타이핑 완료 → 자동 전환)
      await new Promise(r => setTimeout(r, 600));
      await new Promise(r => _sqTypeText('examDialogueText', '축하하네! 훌륭한 실력이야!\n추가 훈련 기회를 주지!', 35, r));
      playSound('approve');
      await new Promise(r => setTimeout(r, 1200));

      // 결과 표시
      const bottomArea = document.getElementById('examBottomArea');
      const infoEl = document.getElementById('examResultInfo');
      if (infoEl) {
        infoEl.innerHTML = `
          <div style="background:rgba(34,197,94,0.15);border-radius:12px;padding:10px 14px;border:1px solid rgba(34,197,94,0.3);text-align:center">
            <div style="font-size:14px;font-weight:900;color:#4ade80">🏋️ 추가 훈련 +${result.bonus}회</div>
          </div>`;
      }
      if (bottomArea) { bottomArea.style.display = 'block'; _sqExamAnimateBtn(bottomArea); }

    } else {
      if (stampArea) {
        stampArea.innerHTML = `
          <div id="examStamp" style="font-size:48px;font-weight:900;color:#ff1a1a;opacity:0;transform:scale(4) rotate(10deg);transition:all 0.35s cubic-bezier(0.17,0.67,0.21,1.3);filter:drop-shadow(0 6px 20px rgba(255,0,0,0.6));pointer-events:none">
            <div style="border:4px solid #ff3333;border-radius:12px;padding:6px 20px;background:rgba(255,20,20,0.25)">불합격</div>
          </div>`;
      }
      const stamp = document.getElementById('examStamp');
      if (stamp) { stamp.style.opacity = '1'; stamp.style.transform = 'scale(1) rotate(3deg)'; }
      await new Promise(r => setTimeout(r, 100));
      _sqExamPlayStamp();
      _sqShakeScreen();

      // 불합격 대사 (타이핑 완료 → 자동 전환)
      await new Promise(r => setTimeout(r, 600));
      await new Promise(r => _sqTypeText('examDialogueText', '아쉽군... 다음에 다시 도전하게.\n뭐라도 더 준비해오라고.', 35, r));
      playSound('reject');
      await new Promise(r => setTimeout(r, 1200));

      // 결과 표시
      const bottomArea = document.getElementById('examBottomArea');
      const infoEl = document.getElementById('examResultInfo');
      if (infoEl) {
        infoEl.innerHTML = `
          <div style="background:rgba(239,68,68,0.12);border-radius:12px;padding:10px 14px;border:1px solid rgba(239,68,68,0.3);text-align:center">
            <div style="font-size:14px;font-weight:900;color:#fca5a5">⏳ ${result.cooldownHours}시간 재심사 대기</div>
          </div>`;
      }
      if (bottomArea) { bottomArea.style.display = 'block'; _sqExamAnimateBtn(bottomArea); }
    }
  } catch (e) {
    console.error('sqExecuteExam error:', e);
    _sqExamStopBGM();
    try { closeModal(); } catch(_){}
  }
}

// 확인 버튼 등장 애니메이션
function _sqExamAnimateBtn(bottomArea) {
  const btn = bottomArea?.querySelector('button');
  if (!btn) return;
  btn.style.cssText += ';opacity:0;transform:translateY(12px);transition:opacity 0.4s ease, transform 0.4s ease, background 0.2s, box-shadow 0.2s;background:rgba(255,255,255,0.12);color:#e8d5b7;box-shadow:none;';
  requestAnimationFrame(() => {
    btn.style.opacity = '1';
    btn.style.transform = 'translateY(0)';
    btn.style.background = 'linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.08))';
    btn.style.boxShadow = '0 2px 12px rgba(232,213,183,0.2), inset 0 1px 0 rgba(255,255,255,0.15)';
    btn.style.border = '1.5px solid rgba(232,213,183,0.3)';
  });
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.22)'; btn.style.boxShadow = '0 4px 16px rgba(232,213,183,0.35)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.08))'; btn.style.boxShadow = '0 2px 12px rgba(232,213,183,0.2), inset 0 1px 0 rgba(255,255,255,0.15)'; });
  btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.96)'; });
  btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1)'; });
}

// 심사 모달 닫기 (BGM 복원 + 카드 갱신)
function _sqExamClose(id) {
  playSound('click');
  _sqExamStopBGM();
  // 기존 탭 BGM 복원
  if (typeof _sndPlayBGM === 'function') _sndPlayBGM('my');
  closeModal();
  // 카드 갱신
  const sq = _sqSquirrels.find(s => s.id === id);
  const cardEl = document.getElementById('sqCard-' + id);
  if (cardEl && sq) {
    const tmp = document.createElement('div');
    tmp.innerHTML = sqCardHTML(sq);
    cardEl.replaceWith(tmp.firstElementChild);
  }
}

// ================================================================
//  관리자: 재심사 쿨타임 초기화
// ================================================================
async function sqAdminResetCooldown(id) {
  if (!myProfile?.is_admin) return;
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  const { error } = await sb.from('squirrels').update({ exam_cooldown_until: null }).eq('id', id);
  if (error) { showToast('쿨타임 초기화 실패'); return; }
  _sqUpdate(id, { exam_cooldown_until: null });
  toast('✅', `${sq.name}의 재심사 쿨타임이 초기화되었습니다`);
  // 모달을 닫지 않고 액션 모달 자체를 다시 그려서 버튼 즉시 갱신
  sqShowActionModal(id);
  // 목록 카드 뱃지(⏳) 즉시 갱신
  const cardEl = document.getElementById('sqCard-' + id);
  const updated = _sqSquirrels.find(s => s.id === id);
  if (cardEl && updated) {
    const tmp = document.createElement('div');
    tmp.innerHTML = sqCardHTML(updated);
    cardEl.replaceWith(tmp.firstElementChild);
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
  const maxStat   = (_sqSettings.stat_hp_max||150) + (_sqSettings.stat_atk_max||20) * 3 + (_sqSettings.stat_def_max||20) * 2;
  const price     = Math.round(sellBase + (statSum / maxStat) * (sellMax - sellBase));
  const desc      = sq.type === 'explorer' ? '탐험을 즐기는 활발한 녀석이군요!' : '온순하고 귀여운 애완 다람쥐네요!';

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
    if (countEl) countEl.textContent = _sqSquirrels.length + ' / ' + (_sqSettings.max_squirrels || 10);
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
  const explorers = _sqSquirrels.filter(s => s.type === 'explorer' && s.status === 'idle');
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
        <div id="expcard-${sq.id}" onclick="sqToggleExpSelect('${sq.id}')" style="background:var(--sq-card-bg);border-radius:16px;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:2px solid transparent;cursor:pointer;transition:all .2s">
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
//  🧬 합성 시스템
// ================================================================
var _sqFuseSelected = [null, null]; // 선택된 다람쥐 ID 2개
var _sqFuseSlotPicking = 0;         // 현재 선택 중인 슬롯 (1 or 2)

// _sqGradeOrder, _sqGradeLabel → 파일 상단 등급 시스템 영역으로 이동됨

function sqFuseInit() {
  _sqFuseSelected = [null, null];
  _sqFuseSlotPicking = 0;
  sqFuseRenderSlots();
  sqFuseRenderGrid();
  const costEl = document.getElementById('sqFuseCostDisplay');
  if (costEl) costEl.textContent = _sqSettings.fuse_cost ?? 10;
}

function sqFuseRenderSlots() {
  for (let i = 1; i <= 2; i++) {
    const slot = document.getElementById('sqFuseSlot' + i);
    const sq = _sqFuseSelected[i-1] ? _sqSquirrels.find(s => s.id === _sqFuseSelected[i-1]) : null;
    if (sq) {
      const grade = _sqCalcGrade(sq);
      const gs = _sqGradeStyle(grade);
      const spriteFile = sq.sprite || 'sq_acorn';
      slot.innerHTML = `
        <div style="text-align:center;position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:#9ca3af;z-index:1" onclick="event.stopPropagation();sqFuseClearSlot(${i})">✕</div>
          <div style="border-radius:14px;${gs.border};box-shadow:${gs.shadow};padding:2px;background:${gs.bg}">
            <img src="images/squirrels/${spriteFile}.png" style="width:48px;height:48px;object-fit:contain;border-radius:10px;display:block" onerror="this.outerHTML='<div style=\\'font-size:36px;line-height:48px;text-align:center\\'>🦔</div>'">
          </div>
          <div style="font-size:11px;font-weight:900;color:var(--fuse-slot-name);margin-top:4px">${sq.name}</div>
          <div style="font-size:10px;font-weight:800;color:${gs.color}">${gs.label}</div>
          <div style="font-size:9px;font-weight:700;color:${sq.type==='explorer'?'#059669':'#7c3aed'};margin-top:1px">${sq.type==='explorer'?'탐험형':'애완형'}</div>
        </div>`;
      slot.style.border = '3px solid ' + gs.color;
      slot.style.background = gs.bg;
    } else {
      const isPicking = _sqFuseSlotPicking === i;
      slot.innerHTML = `<span style="font-size:32px;color:var(${isPicking ? '--fuse-slot-active-plus' : '--fuse-slot-plus'})">＋</span>`;
      slot.style.border = isPicking ? '3px solid var(--fuse-slot-active-border)' : '3px dashed var(--fuse-slot-border)';
      slot.style.background = isPicking ? 'var(--fuse-slot-active-bg)' : 'var(--fuse-slot-bg)';
    }
  }

  // 버튼 & 정보 업데이트
  const btn = document.getElementById('sqFuseBtn');
  const info = document.getElementById('sqFuseInfo');
  if (_sqFuseSelected[0] && _sqFuseSelected[1]) {
    const sq1 = _sqSquirrels.find(s => s.id === _sqFuseSelected[0]);
    const sq2 = _sqSquirrels.find(s => s.id === _sqFuseSelected[1]);
    const g1 = _sqCalcGrade(sq1), g2 = _sqCalcGrade(sq2);
    if (g1 !== g2) {
      info.innerHTML = `<div style="color:#dc2626;font-size:13px;font-weight:800">⚠️ 같은 등급끼리만 합성할 수 있어요</div>`;
      btn.style.display = 'none';
    } else if (sq1.type !== sq2.type) {
      info.innerHTML = `<div style="color:#dc2626;font-size:13px;font-weight:800">⚠️ 같은 타입끼리만 합성할 수 있어요 (탐험+탐험 or 애완+애완)</div>`;
      btn.style.display = 'none';
    } else {
      const gs = _sqGradeStyle(g1);
      const gi = _sqGradeOrder.indexOf(g1);
      const upgradeChance = _sqFuseGetUpgradeChance(g1);
      const nextLabel = gi < 4 ? _sqGradeLabel[_sqGradeOrder[gi+1]] : null;
      info.innerHTML = `<div style="font-size:13px;font-weight:800;color:${gs.color}">
        ${gs.label} + ${gs.label} 합성
        ${nextLabel ? `<span style="color:#6b7280;font-weight:600"> · 승급 확률 ${upgradeChance}%</span>` : ''}
      </div>`;
      btn.style.display = '';
    }
  } else {
    info.innerHTML = _sqFuseSlotPicking
      ? `<div style="color:#f59e0b;font-size:13px;font-weight:700">아래에서 다람쥐를 선택해주세요</div>`
      : '';
    btn.style.display = 'none';
  }
}

function sqFuseGetUpgradeChance(grade) { return _sqFuseGetUpgradeChance(grade); }
function _sqFuseGetUpgradeChance(grade) {
  switch(grade) {
    case 'normal': return _sqSettings.fuse_upgrade_normal ?? 15;
    case 'rare':   return _sqSettings.fuse_upgrade_rare ?? 12;
    case 'epic':   return _sqSettings.fuse_upgrade_epic ?? 8;
    case 'unique': return _sqSettings.fuse_upgrade_unique ?? 5;
    default:       return 0;
  }
}

function sqFuseRenderGrid() {
  const grid = document.getElementById('sqFuseGrid');
  if (!grid) return;

  // baby, exploring, recovering, 장착 농부 제외
  const activeFarmerId = typeof _farmData !== 'undefined' ? _farmData?.active_farmer_id : null;
  const fusable = _sqSquirrels.filter(sq =>
    (sq.type === 'explorer' || sq.type === 'pet') && sq.status === 'idle' && sq.id !== activeFarmerId
  );

  if (!fusable.length) {
    grid.innerHTML = '<div class="text-center py-4 text-sm text-gray-400">합성 가능한 다람쥐가 없어요</div>';
    return;
  }

  // 등급별 그룹핑
  const groups = {};
  fusable.forEach(sq => {
    const g = _sqCalcGrade(sq);
    if (!groups[g]) groups[g] = [];
    groups[g].push(sq);
  });

  let html = '';
  _sqGradeOrder.forEach(grade => {
    if (!groups[grade]) return;
    const gs = _sqGradeStyle(grade);
    html += `<div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:900;color:${gs.color};margin-bottom:6px">${gs.label} (${groups[grade].length})</div>`;
    groups[grade].forEach(sq => {
      const isSelected = _sqFuseSelected.includes(sq.id);
      const spriteFile = sq.sprite || 'sq_acorn';
      html += `
        <div onclick="sqFuseSelect('${sq.id}')" style="display:inline-flex;flex-direction:column;align-items:center;width:72px;padding:8px 4px;margin:3px;border-radius:12px;cursor:pointer;border:2px solid ${isSelected ? gs.color : 'transparent'};background:${isSelected ? gs.bg : 'white'};box-shadow:0 2px 8px rgba(0,0,0,0.05);transition:all .15s;text-align:center">
          <div style="border-radius:10px;${gs.border};padding:1px;background:${gs.bg}">
            <img src="images/squirrels/${spriteFile}.png" style="width:40px;height:40px;object-fit:contain;border-radius:8px;display:block" onerror="this.outerHTML='<div style=\\'font-size:28px;line-height:40px\\'>🦔</div>'">
          </div>
          <div style="font-size:10px;font-weight:900;color:#1f2937;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64px">${sq.name}</div>
          <div style="font-size:9px;font-weight:700;color:${sq.type==='explorer'?'#059669':'#7c3aed'}">${sq.type==='explorer'?'탐험형':'애완형'}</div>
          <div style="font-size:8px;color:#9ca3af;margin-top:1px;white-space:nowrap">❤${sq.hp_current||0} ⚔${sq.stats?.atk||0} 🛡${sq.stats?.def||0}</div>
          ${isSelected ? '<div style="font-size:10px;color:#f59e0b;font-weight:800">선택됨</div>' : ''}
        </div>`;
    });
    html += '</div>';
  });
  grid.innerHTML = html;
}

function sqFusePickSlot(slot) {
  _sqFuseSlotPicking = (_sqFuseSlotPicking === slot) ? 0 : slot;
  sqFuseRenderSlots();
  sqFuseRenderGrid();
}

function sqFuseClearSlot(slot) {
  _sqFuseSelected[slot-1] = null;
  _sqFuseSlotPicking = slot;
  sqFuseRenderSlots();
  sqFuseRenderGrid();
}

function sqFuseSelect(id) {
  // 이미 슬롯에 있으면 → 빼기 (토글)
  if (_sqFuseSelected[0] === id) { sqFuseClearSlot(1); return; }
  if (_sqFuseSelected[1] === id) { sqFuseClearSlot(2); return; }

  // 슬롯이 선택되어 있지 않으면 빈 슬롯에 자동 배치
  if (!_sqFuseSlotPicking) {
    if (!_sqFuseSelected[0]) _sqFuseSlotPicking = 1;
    else if (!_sqFuseSelected[1]) _sqFuseSlotPicking = 2;
    else return; // 둘 다 차있으면 무시
  }

  // 이미 다른 슬롯에 있으면 제거
  const otherSlot = _sqFuseSlotPicking === 1 ? 1 : 0;
  if (_sqFuseSelected[otherSlot] === id) _sqFuseSelected[otherSlot] = null;

  _sqFuseSelected[_sqFuseSlotPicking - 1] = id;

  // 다음 빈 슬롯으로 이동
  if (_sqFuseSlotPicking === 1 && !_sqFuseSelected[1]) _sqFuseSlotPicking = 2;
  else _sqFuseSlotPicking = 0;

  sqFuseRenderSlots();
  sqFuseRenderGrid();
}

// ── 합성 실행 ──
async function sqFuseExecute() {
  const id1 = _sqFuseSelected[0], id2 = _sqFuseSelected[1];
  if (!id1 || !id2) return;

  const sq1 = _sqSquirrels.find(s => s.id === id1);
  const sq2 = _sqSquirrels.find(s => s.id === id2);
  if (!sq1 || !sq2) return;

  const grade = _sqCalcGrade(sq1);
  if (grade !== _sqCalcGrade(sq2)) {
    toast('⚠️', '같은 등급끼리만 합성할 수 있어요');
    return;
  }

  const cost = _sqSettings.fuse_cost ?? 10;
  if ((myProfile.acorns || 0) < cost) {
    toast('⚠️', `도토리가 부족해요 (${cost}개 필요)`);
    return;
  }

  // 확인 모달
  const gs = _sqGradeStyle(grade);
  const upgradeChance = _sqFuseGetUpgradeChance(grade);
  const gi = _sqGradeOrder.indexOf(grade);
  const nextLabel = gi < 4 ? _sqGradeLabel[_sqGradeOrder[gi+1]] : null;

  showModal(`
    <div style="text-align:center">
      <div style="font-size:48px;margin-bottom:8px">🧬</div>
      <h2 style="font-size:18px;font-weight:900;color:#1f2937;margin-bottom:8px">다람쥐 합성</h2>
      <p style="font-size:14px;color:#6b7280;margin-bottom:4px"><strong>${sq1.name}</strong> + <strong>${sq2.name}</strong></p>
      <p style="font-size:13px;color:${gs.color};font-weight:800;margin-bottom:4px">${gs.label} 등급 합성</p>
      ${nextLabel ? `<p style="font-size:12px;color:#9ca3af">승급 확률: ${upgradeChance}% → ${nextLabel}</p>` : ''}
      <p style="font-size:13px;color:#b45309;font-weight:700;margin:12px 0">🌰 ${cost} 도토리 소모</p>
      <p style="font-size:12px;color:#dc2626;font-weight:600;margin-bottom:16px">⚠️ 재료 다람쥐 두 마리는 사라집니다!</p>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text)">취소</button>
        <button onclick="closeModal();sqFuseConfirm()" class="btn btn-primary flex-1">합성하기!</button>
      </div>
    </div>
  `);
}

async function sqFuseConfirm() {
  const id1 = _sqFuseSelected[0], id2 = _sqFuseSelected[1];
  if (!id1 || !id2) return;

  const sq1 = _sqSquirrels.find(s => s.id === id1);
  const sq2 = _sqSquirrels.find(s => s.id === id2);
  if (!sq1 || !sq2) return;

  const grade = _sqCalcGrade(sq1);
  if (sq1.type !== sq2.type) { toast('⚠️', '같은 타입끼리만 합성 가능'); return; }
  const cost = _sqSettings.fuse_cost ?? 10;

  // 도토리 차감
  const spendRes = await spendAcorns(cost, '다람쥐 합성');
  if (spendRes.error) {
    toast('❌', '도토리 차감 실패');
    return;
  }

  // 승급 판정
  const upgradeChance = _sqFuseGetUpgradeChance(grade);
  const upgraded = Math.random() * 100 < upgradeChance;
  const resultGrade = upgraded ? _sqGradeOrder[Math.min(4, _sqGradeOrder.indexOf(grade) + 1)] : grade;

  // 해당 등급 범위의 스탯 생성
  const stats = _sqFuseGenerateStats(resultGrade);
  const sprite = _sqRandomSprite();
  const fusionType = sq1.type; // 재료와 같은 타입 유지

  // DB: 새 다람쥐 생성 먼저 → 성공하면 재료 삭제 (안전한 순서)
  try {
    const { data: newSq, error: insErr } = await sb.from('squirrels').insert({
      user_id: myProfile.id,
      name: sq1.name,
      type: fusionType,
      status: 'idle',
      sprite: sprite,
      stats: stats,
      hp_current: stats.hp,
      acorns_fed: 0,
      acorns_required: 0,
      acquired_from: 'shop'
    }).select('*').single();
    if (insErr) throw insErr;

    const { error: delErr } = await sb.from('squirrels').delete().in('id', [id1, id2]);
    if (delErr) {
      console.warn('[fuse] 재료 삭제 실패, 새 다람쥐는 생성됨:', delErr);
    }

    // 로컬 캐시 업데이트
    _sqSquirrels = _sqSquirrels.filter(s => s.id !== id1 && s.id !== id2);
    _sqSquirrels.push(newSq);

    // 결과 연출
    _sqFuseShowResult(newSq, upgraded, grade, resultGrade);
  } catch(e) {
    console.error('[fuse] 합성 실패:', JSON.stringify(e));
    toast('❌', '합성 실패: ' + (e?.message || e?.details || JSON.stringify(e)));
    // 도토리 환불 시도
    try {
      await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: cost, p_reason: '합성 실패 환불' });
      myProfile.acorns += cost;
      if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    } catch(e2) { console.error('[fuse] 환불 실패:', e2); }
  }
}

function _sqFuseGenerateStats(targetGrade) {
  const hpMin = _sqSettings.stat_hp_min || 60, hpMax = _sqSettings.stat_hp_max || 150;
  const atkMin = _sqSettings.stat_atk_min || 8, atkMax = _sqSettings.stat_atk_max || 20;
  const defMin = _sqSettings.stat_def_min || 4, defMax = _sqSettings.stat_def_max || 20;

  // 목표 등급에 맞는 스탯이 나올 때까지 재생성 (최대 500회)
  for (let i = 0; i < 500; i++) {
    const hp  = hpMin  + Math.floor(Math.random() * (hpMax - hpMin + 1));
    const atk = atkMin + Math.floor(Math.random() * (atkMax - atkMin + 1));
    const def = defMin + Math.floor(Math.random() * (defMax - defMin + 1));
    const score = ((hp/hpMax) + (atk/atkMax) + (def/defMax)) / 3 * 100;
    const g = score >= 90 ? 'legend' : score >= 80 ? 'unique' : score >= 70 ? 'epic' : score >= 60 ? 'rare' : 'normal';
    if (g === targetGrade) return { hp, atk, def };
  }
  // fallback: 등급 중간값으로 생성
  const mid = targetGrade === 'legend' ? 95 : targetGrade === 'unique' ? 85 : targetGrade === 'epic' ? 75 : targetGrade === 'rare' ? 65 : 50;
  const ratio = mid / 100;
  return {
    hp:  Math.round(hpMax * ratio),
    atk: Math.round(atkMax * ratio),
    def: Math.round(defMax * ratio)
  };
}

function _sqFuseShowResult(newSq, upgraded, oldGrade, newGrade) {
  const gs = _sqGradeStyle(newGrade);
  const spriteFile = newSq.sprite || 'sq_acorn';
  const typeLabel = newSq.type === 'explorer' ? '탐험형' : '애완형';

  // Phase 1: 합성 중 연출 모달
  showModal(`
    <div id="sqFuseAnim" style="text-align:center;padding:20px 0">
      <div id="sqFuseAnimIcon" style="font-size:56px;animation:sqCardShake 0.5s ease infinite">🧬</div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-top:16px">합성 중...</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:4px">두근두근</div>
    </div>
  `);

  // 두근두근 → 서스펜스 상승 (아기다람쥐 성장 연출과 동일)
  _playTone(220, 'sine', 0.12, 0.18);
  setTimeout(() => _playTone(220, 'sine', 0.12, 0.18), 200);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 400);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 600);
  setTimeout(() => _playTone(310, 'triangle', 0.2, 0.15), 800);
  setTimeout(() => _playTone(370, 'triangle', 0.2, 0.15), 1000);
  setTimeout(() => _playTone(440, 'triangle', 0.25, 0.15), 1200);
  setTimeout(() => _playTone(523, 'triangle', 0.3, 0.12), 1400);

  // Phase 3: 아이콘 흔들림 강화
  setTimeout(() => {
    const icon = document.getElementById('sqFuseAnimIcon');
    if (icon) icon.style.animation = 'sqCardShake 0.2s ease infinite';
  }, 1000);

  // Phase 4: 파티클 + 빛남 효과
  setTimeout(() => {
    const animEl = document.getElementById('sqFuseAnim');
    if (animEl) {
      const r = animEl.getBoundingClientRect();
      _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, true, 15);
    }
  }, 1600);

  // Phase 5: 결과 공개 (약 2초 후)
  setTimeout(() => {
    _sqPlayGrowSound();

    // 승급 시 추가 팡파레
    if (upgraded) {
      setTimeout(() => _playTone(523, 'sine', 0.3, 0.2), 100);
      setTimeout(() => _playTone(659, 'sine', 0.3, 0.2), 250);
      setTimeout(() => _playTone(784, 'sine', 0.4, 0.25), 400);
    }

    closeModal();

    setTimeout(() => {
      showModal(`
        <div style="text-align:center">
          <div style="font-size:14px;color:#9ca3af;font-weight:700;margin-bottom:12px">합성 결과</div>
          ${upgraded ? `
            <div style="font-size:28px;margin-bottom:8px;animation:sqReadyBounce 0.8s ease-in-out infinite">⬆️</div>
            <div style="font-size:16px;font-weight:900;color:#f59e0b;margin-bottom:12px">🎉 등급 승급!</div>
          ` : ''}
          <div id="sqFuseResultImg" style="display:inline-block;border-radius:20px;${gs.border};box-shadow:${gs.shadow};padding:4px;background:${gs.bg};margin-bottom:12px;opacity:0;transform:scale(0.5);transition:opacity 0.5s,transform 0.5s cubic-bezier(0.34,1.56,0.64,1)">
            <img src="images/squirrels/${spriteFile}.png" style="width:80px;height:80px;object-fit:contain;border-radius:16px;display:block" onerror="this.outerHTML='<div style=\\'font-size:60px;line-height:80px\\'>🦔</div>'">
          </div>
          <div style="font-size:18px;font-weight:900;color:#1f2937;margin-bottom:4px">${newSq.name}</div>
          <div style="font-size:14px;font-weight:800;color:${gs.color};margin-bottom:4px">${gs.label} · ${typeLabel}</div>
          <div style="display:flex;gap:12px;justify-content:center;margin:12px 0">
            <div style="text-align:center"><div style="font-size:10px;color:#9ca3af">❤️ HP</div><div style="font-size:16px;font-weight:900;color:#ef4444">${newSq.stats.hp}</div></div>
            <div style="text-align:center"><div style="font-size:10px;color:#9ca3af">⚔️ ATK</div><div style="font-size:16px;font-weight:900;color:#f97316">${newSq.stats.atk}</div></div>
            <div style="text-align:center"><div style="font-size:10px;color:#9ca3af">🛡️ DEF</div><div style="font-size:16px;font-weight:900;color:#3b82f6">${newSq.stats.def}</div></div>
          </div>
          ${upgraded ? `<div style="font-size:12px;color:#6b7280;margin-bottom:12px">${_sqGradeLabel[oldGrade]} → <strong style="color:${gs.color}">${gs.label}</strong></div>` : ''}
          <button onclick="closeModal();sqFuseInit();sqRenderGrid();" class="btn btn-primary w-full">확인</button>
        </div>
      `);

      // 이미지 팝인 애니메이션
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const img = document.getElementById('sqFuseResultImg');
        if (img) { img.style.opacity = '1'; img.style.transform = 'scale(1)'; }
      }));

      // 결과 파티클
      setTimeout(() => {
        const modal = document.querySelector('.modal-content') || document.querySelector('[class*="modal"]');
        if (modal) {
          const r = modal.getBoundingClientRect();
          _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 20);
        }
      }, 200);
    }, 150);
  }, 2000);
}

// ================================================================
//  관리자 패널
// ================================================================
async function sqAdminInit() {
  await sqLoadSettings();
  document.getElementById('sqSet_maxSquirrels').value     = _sqSettings.max_squirrels     || 10;
  document.getElementById('sqSet_shopPrice').value       = _sqSettings.shop_price        || 30;
  document.getElementById('sqSet_acornMin').value    = _sqSettings.acorn_min         || 20;
  document.getElementById('sqSet_acornMax').value    = _sqSettings.acorn_max         || 50;
  document.getElementById('sqSet_timeChance').value  = _sqSettings.time_chance       || 40;
  document.getElementById('sqSet_timeMin').value     = _sqSettings.time_min_minutes  || 10;
  document.getElementById('sqSet_timeMax').value     = _sqSettings.time_max_minutes  || 60;
  document.getElementById('sqSet_multiMin').value    = _sqSettings.feed_multi_min    || 0.5;
  document.getElementById('sqSet_multiMax').value    = _sqSettings.feed_multi_max    || 1.3;
  document.getElementById('sqSet_hpMin').value       = _sqSettings.stat_hp_min       || 60;
  document.getElementById('sqSet_hpMax').value       = _sqSettings.stat_hp_max       || 150;
  document.getElementById('sqSet_atkMin').value      = _sqSettings.stat_atk_min      || 8;
  document.getElementById('sqSet_atkMax').value      = _sqSettings.stat_atk_max      || 20;
  document.getElementById('sqSet_defMin').value      = _sqSettings.stat_def_min      || 4;
  document.getElementById('sqSet_defMax').value      = _sqSettings.stat_def_max      || 20;
  document.getElementById('sqSet_sellBase').value    = _sqSettings.sell_price_base   || 20;
  document.getElementById('sqSet_sellMax').value     = _sqSettings.sell_price_max    || 80;
  document.getElementById('sqSet_recoveryMinutes').value = _sqSettings.recovery_base_minutes || 60;
  document.getElementById('sqSet_recoveryCost').value    = _sqSettings.recovery_instant_cost || 15;
  document.getElementById('sqSet_triggerMin').value       = _sqSettings.time_trigger_min || 40;
  document.getElementById('sqSet_triggerMax').value       = _sqSettings.time_trigger_max || 80;
  // 합성 설정 로드
  document.getElementById('sqSet_fuseCost').value          = _sqSettings.fuse_cost ?? 10;
  document.getElementById('sqSet_fuseUpNormal').value      = _sqSettings.fuse_upgrade_normal ?? 15;
  document.getElementById('sqSet_fuseUpRare').value        = _sqSettings.fuse_upgrade_rare ?? 12;
  document.getElementById('sqSet_fuseUpEpic').value        = _sqSettings.fuse_upgrade_epic ?? 8;
  document.getElementById('sqSet_fuseUpUnique').value      = _sqSettings.fuse_upgrade_unique ?? 5;
  // 등급심사 설정 로드
  document.getElementById('sqSet_examCost').value          = _sqSettings.exam_cost ?? 10;
  document.getElementById('sqSet_examCooldown').value      = _sqSettings.exam_cooldown_hours ?? 48;
  document.getElementById('sqSet_examPassRate').value      = _sqSettings.exam_pass_rate ?? 40;
  document.getElementById('sqSet_examItemBoost').value     = _sqSettings.exam_item_boost ?? 5;
  document.getElementById('sqSet_examItemMax').value       = _sqSettings.exam_item_max ?? 12;
  document.getElementById('sqSet_examBonusMin').value      = _sqSettings.exam_bonus_min ?? 1;
  document.getElementById('sqSet_examBonusMax').value      = _sqSettings.exam_bonus_max ?? 1;
  // 체력훈련 설정 로드
  document.getElementById('sqSet_trainDotRate').value     = _sqSettings.training_dot_rate ?? 30;
  document.getElementById('sqSet_trainHpMin').value      = _sqSettings.training_hp_min ?? 1;
  document.getElementById('sqSet_trainHpMax').value      = _sqSettings.training_hp_max ?? 10;
  document.getElementById('sqSet_trainCountMin').value   = _sqSettings.training_count_min ?? 0;
  document.getElementById('sqSet_trainCountMax').value   = _sqSettings.training_count_max ?? 2;
  // 탐험 보상 설정 로드
  await expLoadSettings();
  await expAdminLoadUI();
  await sqAdminGrantInit();
  await sqAdminLoadList();
  // 농장 설정 로드
  if (typeof farmAdminLoadSettingsUI === 'function') await farmAdminLoadSettingsUI();
}

async function sqSaveSettings() {
  const settings = {
    max_squirrels:    parseInt(document.getElementById('sqSet_maxSquirrels').value)   || 10,
    shop_price:       parseInt(document.getElementById('sqSet_shopPrice').value)      || 30,
    acorn_min:        parseInt(document.getElementById('sqSet_acornMin').value)   || 20,
    acorn_max:        parseInt(document.getElementById('sqSet_acornMax').value)   || 50,
    time_chance:      parseInt(document.getElementById('sqSet_timeChance').value) || 40,
    time_min_minutes: parseInt(document.getElementById('sqSet_timeMin').value)    || 10,
    time_max_minutes: parseInt(document.getElementById('sqSet_timeMax').value)    || 60,
    feed_multi_min:   parseFloat(document.getElementById('sqSet_multiMin').value) || 0.5,
    feed_multi_max:   parseFloat(document.getElementById('sqSet_multiMax').value) || 1.3,
    stat_hp_min:      parseInt(document.getElementById('sqSet_hpMin').value)      || 60,
    stat_hp_max:      parseInt(document.getElementById('sqSet_hpMax').value)      || 150,
    stat_atk_min:     parseInt(document.getElementById('sqSet_atkMin').value)     || 8,
    stat_atk_max:     parseInt(document.getElementById('sqSet_atkMax').value)     || 20,
    stat_def_min:     parseInt(document.getElementById('sqSet_defMin').value)     || 4,
    stat_def_max:     parseInt(document.getElementById('sqSet_defMax').value)     || 20,
    sell_price_base:  parseInt(document.getElementById('sqSet_sellBase').value)   || 20,
    sell_price_max:   parseInt(document.getElementById('sqSet_sellMax').value)    || 80,
    recovery_base_minutes: parseInt(document.getElementById('sqSet_recoveryMinutes').value) || 60,
    recovery_instant_cost: parseInt(document.getElementById('sqSet_recoveryCost').value)    || 15,
    time_trigger_min:      parseInt(document.getElementById('sqSet_triggerMin').value)       || 40,
    time_trigger_max:      parseInt(document.getElementById('sqSet_triggerMax').value)       || 80,
    // 합성 설정
    fuse_cost:             parseInt(document.getElementById('sqSet_fuseCost').value)         || 10,
    fuse_upgrade_normal:   parseInt(document.getElementById('sqSet_fuseUpNormal').value)     ?? 15,
    fuse_upgrade_rare:     parseInt(document.getElementById('sqSet_fuseUpRare').value)       ?? 12,
    fuse_upgrade_epic:     parseInt(document.getElementById('sqSet_fuseUpEpic').value)       ?? 8,
    fuse_upgrade_unique:   parseInt(document.getElementById('sqSet_fuseUpUnique').value)     ?? 5,
    fuse_upgrade_legend:   0,
    // 등급심사 설정
    exam_cost:             parseInt(document.getElementById('sqSet_examCost').value)         || 10,
    exam_cooldown_hours:   parseInt(document.getElementById('sqSet_examCooldown').value)     || 48,
    exam_pass_rate:        parseInt(document.getElementById('sqSet_examPassRate').value)     || 40,
    exam_item_boost:       parseInt(document.getElementById('sqSet_examItemBoost').value)    || 5,
    exam_item_max:         parseInt(document.getElementById('sqSet_examItemMax').value)      || 12,
    exam_bonus_min:        parseInt(document.getElementById('sqSet_examBonusMin').value)     || 1,
    exam_bonus_max:        parseInt(document.getElementById('sqSet_examBonusMax').value)     || 1,
    // 체력훈련 설정
    training_dot_rate:     parseInt(document.getElementById('sqSet_trainDotRate').value)      || 30,
    training_hp_min:       parseInt(document.getElementById('sqSet_trainHpMin').value)       || 1,
    training_hp_max:       parseInt(document.getElementById('sqSet_trainHpMax').value)       || 10,
    training_count_min:    parseInt(document.getElementById('sqSet_trainCountMin').value)    || 0,
    training_count_max:    parseInt(document.getElementById('sqSet_trainCountMax').value)    || 2,
  };
  const { error } = await sb.from('app_settings')
    .upsert({ key:'squirrel_settings', value: settings, updated_at: new Date().toISOString() }, { onConflict:'key' });
  if (!error) { _sqSettings = settings; toast('✅','설정이 저장되었어요'); }
  else toast('❌','저장 실패');
}

// ── 관리자 다람쥐 지급 ──
var _sqGrantUsers = [];

async function sqAdminGrantInit() {
  const sel = document.getElementById('sqGrantUser');
  if (!sel) return;
  const { data: users } = await sb.from('users').select('id, display_name').order('display_name');
  _sqGrantUsers = users || [];
  sel.innerHTML = '<option value="">-- 사용자 선택 --</option>' +
    _sqGrantUsers.map(u => `<option value="${u.id}">${u.display_name}</option>`).join('');
}

async function sqAdminGrantSquirrel() {
  const userId = document.getElementById('sqGrantUser')?.value;
  const grade  = document.getElementById('sqGrantGrade')?.value;
  const type   = document.getElementById('sqGrantType')?.value;
  if (!userId) { toast('⚠️', '사용자를 선택하세요'); return; }
  if (!grade)  { toast('⚠️', '등급을 선택하세요'); return; }
  if (!type)   { toast('⚠️', '타입을 선택하세요'); return; }

  const stats = _sqFuseGenerateStats(grade);
  const sprite = _sqRandomSprite();
  const gradeLabel = _sqGradeLabel[grade] || grade;
  const typeLabel = type === 'explorer' ? '탐험형' : '애완형';
  const userName = _sqGrantUsers.find(u => u.id === userId)?.display_name || '?';

  try {
    const { data: newSq, error } = await sb.rpc('admin_grant_squirrel', {
      p_target_user_id: userId,
      p_name: '지급 다람쥐',
      p_status: type,
      p_sprite: sprite,
      p_stats: stats,
      p_hp_current: stats.hp
    });
    if (error) throw error;

    toast('✅', `${userName}에게 ${gradeLabel} ${typeLabel} 다람쥐 지급 완료!`);
    await sqAdminLoadList();
  } catch (e) {
    console.error('[grant]', e);
    toast('❌', '지급 실패: ' + (e?.message || JSON.stringify(e)));
  }
}

async function sqAdminLoadList() {
  const el = document.getElementById('sqAdminList');
  if (!el) return;
  const { data } = await sb.from('squirrels').select('*, users!squirrels_user_id_fkey(display_name)').order('created_at', { ascending: false });
  if (!data?.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">다람쥐가 없어요</div>'; return; }

  // 사용자별 그룹화
  const groups = {};
  data.forEach(sq => {
    const uid = sq.user_id || '_unknown';
    if (!groups[uid]) groups[uid] = { name: sq.users?.display_name || '?', squirrels: [] };
    groups[uid].squirrels.push(sq);
  });

  el.innerHTML = Object.entries(groups).map(([uid, g]) => {
    const cooldownCount = g.squirrels.filter(s => s.exam_cooldown_until && new Date(s.exam_cooldown_until) > new Date()).length;
    const cooldownBadge = cooldownCount > 0 ? `<span style="background:#fee2e2;color:#dc2626;font-size:9px;font-weight:900;padding:1px 6px;border-radius:6px;margin-left:6px">⏳${cooldownCount}</span>` : '';

    const rows = g.squirrels.map(sq => {
      const hasCooldown = sq.exam_cooldown_until && new Date(sq.exam_cooldown_until) > new Date();
      const cooldownBtn = hasCooldown
        ? `<button onclick="sqAdminResetCooldownAny('${sq.id}','${sq.name.replace(/'/g,"\\'")}');event.stopPropagation()" style="flex-shrink:0;padding:4px 10px;border-radius:8px;border:none;background:#fef3c7;color:#92400e;font-size:10px;font-weight:900;cursor:pointer;font-family:inherit">⏩ 해제</button>`
        : '';
      const statusIcon = sq.type==='baby'?'🐿️':sq.type==='pet'?'🐱':sq.status==='recovering'?'😴':'🦔';
      const statLine = sq.type==='baby'
        ? `게이지 ${sq.acorns_fed}/${sq.acorns_required}`
        : `HP ${sq.hp_current} / ATK ${sq.stats?.atk||'?'} / DEF ${sq.stats?.def||'?'}`;
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(0,0,0,0.04)">
          <div style="font-size:20px;flex-shrink:0">${statusIcon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:900;color:#1f2937">${sq.name} <span style="font-size:9px;font-weight:700;color:#9ca3af">${sq.status}</span></div>
            <div style="font-size:10px;color:#9ca3af">${statLine}${hasCooldown?' · <span style="color:#ef4444">⏳쿨타임</span>':''}</div>
          </div>
          ${cooldownBtn}
        </div>`;
    }).join('');

    return `
    <div style="border-radius:14px;margin-bottom:10px;overflow:hidden;border:1px solid var(--border)">
      <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.sq-adm-arrow').textContent=this.nextElementSibling.style.display==='none'?'▶':'▼'" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none;background:var(--surface-50);border-bottom:1px solid var(--border)">
        <span class="sq-adm-arrow" style="font-size:10px;color:var(--text-muted);flex-shrink:0">▼</span>
        <div style="flex:1;min-width:0">
          <span style="font-size:14px;font-weight:900;color:var(--text-primary)">${g.name}</span>
          <span style="font-size:10px;color:var(--text-tertiary);margin-left:6px">🐿️ ${g.squirrels.length}마리</span>
          ${cooldownBadge}
        </div>
      </div>
      <div style="background:var(--surface-white)">${rows}</div>
    </div>`;
  }).join('');
}

async function sqAdminResetCooldownAny(id, name) {
  const { error } = await sb.rpc('admin_reset_exam_cooldown', { p_squirrel_id: id });
  if (error) { toast('❌', '쿨타임 초기화 실패: ' + (error.message || '')); return; }
  toast('✅', `${name}의 재심사 쿨타임이 초기화되었습니다`);
  await sqAdminLoadList();
}