// ──────────────────────────────────────────────
//  미니게임 시스템 v2 (도전/보상 횟수 분리)
// ──────────────────────────────────────────────

const MG_DEFAULTS = {
  catch: {
    name: '도토리 캐치', icon: '🧺',
    playLimit: 10,
    rewardLimit: 3,
    entryFee: 0,
    rewardRate: 10,
    maxReward: 20,
    duration: 30
  },
  '2048': {
    name: '2048 하드코어', icon: '💀',
    playLimit: 10, rewardLimit: 3, unlimitedPlays: false,
    entryFee: 0, duration: 30,
    dropChance: 20, dropAmount: 1,
    bombStartTurn: 3, bombMaxChance: 60, defuseBonus: 1.2, comboBonus: 0.5
  },
  roulette: {
    name: '행운의 룰렛', icon: '🎡',
    playLimit: 10, rewardLimit: 5,
    entryFee: 5, rewardRate: 1, maxReward: 50, duration: 0
  }
};

let _mgSettings = {};
let _mgTodayPlays = {};
let _mgTodayRewards = {};
let _mgBonusPlays = {};
let _mgBonusRewards = {};

// ── 설정 로드 ──
async function loadMinigameSettings() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'minigame_settings').maybeSingle();
    _mgSettings = _parseValue(data?.value) || {};
  } catch(e) { _mgSettings = {}; }
  return _mgSettings;
}

function getMgSetting(gameId, key) {
  if (key === 'playLimit' && _mgSettings?.[gameId]?.playLimit === undefined && _mgSettings?.[gameId]?.dailyLimit !== undefined) {
    return _mgSettings[gameId].dailyLimit;
  }
  return _mgSettings?.[gameId]?.[key] ?? MG_DEFAULTS[gameId]?.[key] ?? 0;
}

// ✅ value 컬럼이 문자열로 저장된 경우를 대비한 방어적 파싱
function _parseValue(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch(e) { return {}; }
  }
  return {};
}

// ── 오늘 도전/보상 횟수 조회 ──
async function loadTodayPlays() {
  if (!myProfile) return;

  // ✅ KST 기준 오늘 날짜
  const today = getToday();
  const fromUTC = today + 'T00:00:00+09:00';
  const toUTC   = today + 'T23:59:59+09:00';

  try {
    const { data } = await sb
      .from('minigame_plays')
      .select('game_id, rewarded')
      .eq('user_id', myProfile.id)
      .gte('played_at', fromUTC)
      .lte('played_at', toUTC);

    _mgTodayPlays = {};
    _mgTodayRewards = {};
    (data || []).forEach(r => {
      _mgTodayPlays[r.game_id] = (_mgTodayPlays[r.game_id] || 0) + 1;
      if (r.rewarded) _mgTodayRewards[r.game_id] = (_mgTodayRewards[r.game_id] || 0) + 1;
    });
  } catch(e) { console.warn('[minigame] 횟수 조회 실패:', e); }

  await _loadBonusPlays();
}

async function _loadBonusPlays() {
  if (!myProfile) return;
  try {
    const { data } = await sb.from('app_settings')
      .select('value')
      .eq('key', 'mg_bonus_' + myProfile.id)
      .maybeSingle();
    // ✅ 방어적 파싱
    const bonus = _parseValue(data?.value);
    _mgBonusPlays   = bonus.plays   || {};
    _mgBonusRewards = bonus.rewards || {};
  } catch(e) {
    _mgBonusPlays   = {};
    _mgBonusRewards = {};
  }
}

function getPlayLimit(gameId) {
  return getMgSetting(gameId, 'playLimit') + (_mgBonusPlays[gameId] || 0);
}
function getRewardLimit(gameId) {
  return getMgSetting(gameId, 'rewardLimit') + (_mgBonusRewards[gameId] || 0);
}

// ── 플레이 기록 저장 ──
async function recordPlay(gameId, score, rewarded) {
  if (!myProfile) return;
  const reward = rewarded ? Math.min(getMgSetting(gameId, 'maxReward'), Math.max(score > 0 ? 1 : 0, Math.floor(score / getMgSetting(gameId, 'rewardRate')))) : 0;
  try {
    await sb.from('minigame_plays').insert({
      user_id: myProfile.id,
      game_id: gameId,
      score: score,
      reward: reward,
      rewarded: rewarded,
      played_at: new Date().toISOString()
    });
    _mgTodayPlays[gameId] = (_mgTodayPlays[gameId] || 0) + 1;
    if (rewarded) _mgTodayRewards[gameId] = (_mgTodayRewards[gameId] || 0) + 1;
  } catch(e) { console.warn('[minigame] 기록 실패:', e); }
  return reward;
}

const MINIGAMES = [
  { id: 'catch',    name: '🌰 도토리 캐치',   desc: '하늘에서 떨어지는 도토리를 바구니로 받아요!', icon: '🧺', color: 'linear-gradient(135deg, #87CEEB, #90EE90)', ready: true },
  { id: '2048',     name: '⚡ 2048 하드코어',  desc: '30초 생존! 폭탄을 피하고 콤보를 터뜨려라!', icon: '💀', color: 'linear-gradient(135deg, #fecaca, #fde68a)', ready: true },
  { id: 'roulette', name: '🎡 행운의 룰렛',   desc: '도토리를 걸고 룰렛을 돌려보세요!',            icon: '🎡', color: 'linear-gradient(135deg, #fce4ff, #dbeafe)', ready: true }
];

// ──────────────────────────────────────────────
//  게임 허브
// ──────────────────────────────────────────────
async function renderMinigameHub() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.remove('hidden');
  play.classList.add('hidden');
  play.innerHTML = '';

  await loadMinigameSettings();
  await loadTodayPlays();

  const grid = document.getElementById('minigameGrid');
  grid.innerHTML = MINIGAMES.map(g => {
    const pLimit    = getPlayLimit(g.id);
    const rLimit    = getRewardLimit(g.id);
    const played    = _mgTodayPlays[g.id]   || 0;
    const rewarded  = _mgTodayRewards[g.id] || 0;
    const pRemain   = Math.max(0, pLimit - played);
    const rRemain   = Math.max(0, rLimit - rewarded);
    const fee       = getMgSetting(g.id, 'entryFee');
    const maxReward = getMgSetting(g.id, 'maxReward');
    const duration  = getMgSetting(g.id, 'duration');
    const maint     = getMgSetting(g.id, 'maintenance');
    const unlimited = getMgSetting(g.id, 'unlimitedPlays');
    const exhausted = !unlimited && pRemain <= 0 && g.ready;
    const blocked   = !g.ready || maint || exhausted;

    return `
    <div class="mg-card clay-card ${!blocked ? 'card-hover' : ''}"
         ${!blocked ? `onclick="startMinigame('${g.id}')"` : ''}
         style="cursor:${!blocked ? 'pointer' : 'default'}">
      <div class="mg-card-preview" style="background:${g.color}">
        <span class="mg-card-icon">${g.icon}</span>
        ${!g.ready   ? '<div class="mg-coming-soon">COMING SOON</div>' : ''}
        ${maint      ? '<div class="mg-coming-soon">🔧 점검중</div>' : ''}
        ${exhausted && !maint ? '<div class="mg-coming-soon">오늘 도전 횟수 소진</div>' : ''}
      </div>
      <div class="p-4">
        <h3 class="font-black text-gray-800 text-base mb-1">${g.name}</h3>
        <p class="text-xs text-gray-400 font-semibold mb-3">${g.desc}</p>
        <div class="flex gap-1 flex-wrap">
          ${duration > 0 ? `<span class="mg-tag">⏱ ${duration}초</span>` : ''}
          ${fee > 0 ? `<span class="mg-tag">🌰 ${fee} 참가비</span>` : '<span class="mg-tag">무료</span>'}
          ${maxReward && !unlimited ? `<span class="mg-tag">🎁 최대 ${maxReward}</span>` : ''}
          ${g.ready && !maint && !unlimited ? `<span class="mg-tag ${exhausted ? 'mg-tag-danger' : ''}">🎮 도전 ${pRemain}/${pLimit}</span>` : ''}
          ${g.ready && !maint && !unlimited ? `<span class="mg-tag ${rRemain <= 0 ? 'mg-tag-danger' : 'mg-tag-reward'}">🌰 보상 ${rRemain}/${rLimit}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

async function startMinigame(id) {
  await loadMinigameSettings();
  await loadTodayPlays();

  if (getMgSetting(id, 'maintenance')) {
    toast('🔧', '이 게임은 현재 점검중이에요!');
    return;
  }

  const pLimit = getPlayLimit(id);
  const played = _mgTodayPlays[id] || 0;
  const unlimited = getMgSetting(id, 'unlimitedPlays');
  if (!unlimited && played >= pLimit) {
    toast('⚠️', `오늘 도전 횟수를 모두 사용했어요! (${pLimit}/${pLimit}회)`);
    renderMinigameHub();
    return;
  }

  const fee = getMgSetting(id, 'entryFee');

  // 룰렛은 배수 선택 화면으로 진입
  if (id === 'roulette') {
    startRouletteGame();
    return;
  }

  if (fee > 0) {
    if ((myProfile?.acorns || 0) < fee) {
      toast('❌', `참가비가 부족해요! (필요: 🌰${fee}, 보유: 🌰${myProfile?.acorns || 0})`);
      return;
    }
    const rLimit   = getRewardLimit(id);
    const rewarded = _mgTodayRewards[id] || 0;
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">🎮</div>
      <h2 class="text-lg font-black text-gray-800 mb-2">게임 시작</h2>
      <p class="text-sm text-gray-500 mb-1">참가비 <span class="font-black text-amber-600">🌰 ${fee}</span>이 차감됩니다.</p>
      <p class="text-xs text-gray-400 mb-1">도전: ${pLimit - played}/${pLimit}회 · 보상: ${rLimit - rewarded}/${rLimit}회</p>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-primary flex-1 py-2" onclick="closeModal();_confirmStartGame('${id}',${fee})">시작하기</button>
      </div>
    </div>`);
    return;
  }
  _confirmStartGame(id, 0);
}

async function _confirmStartGame(id, fee) {
  if (fee > 0) {
    try {
      const res = await sb.rpc('adjust_acorns', {
        p_user_id: myProfile.id, p_amount: -fee,
        p_reason: `미니게임 [${MG_DEFAULTS[id]?.name || id}] 참가비 -${fee}🌰`
      });
      if (!res.data?.success) { toast('❌', '참가비 차감 실패!'); return; }
      myProfile.acorns = res.data.balance;
      updateAcornDisplay();
    } catch(e) { toast('❌', '참가비 차감 중 오류'); return; }
  }
  if (id === 'catch') startCatchGame();
  else if (id === '2048') start2048Game();
  else if (id === 'roulette') startRouletteGame();
}

function exitMinigame() {
  document.getElementById('minigame-hub').classList.remove('hidden');
  document.getElementById('minigame-play').classList.add('hidden');
  document.getElementById('minigame-play').innerHTML = '';
  renderMinigameHub();
}



// ══════════════════════════════════════════════
//  관리자: 미니게임 설정 UI
// ══════════════════════════════════════════════

async function renderMinigameAdmin() {
  await loadMinigameSettings();
  const list  = document.getElementById('mgSettingsList');
  const games = ['catch', '2048', 'roulette'];

  list.innerHTML = games.map(id => {
    const def = MG_DEFAULTS[id];
    const s   = _mgSettings[id] || {};
    const val = (key) => s[key] ?? def[key];

    // 룰렛은 전용 UI
    if (id === 'roulette') {
      var rProb = s.probs || { miss: 38, x1: 30, x15: 20, x3: 10, x10: 2 };
      var rWidth = s.widths || { miss: 38, x1: 30, x15: 20, x3: 10, x10: 2 };
      return `
      <div class="clay-card p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-black text-gray-800 text-base">${def.icon} ${def.name}</h3>
          <label class="flex items-center gap-2 cursor-pointer">
            <span class="text-xs font-bold ${val('maintenance') ? 'text-red-500' : 'text-gray-400'}">🔧 점검</span>
            <input type="checkbox" id="mg-roulette-maintenance" ${val('maintenance') ? 'checked' : ''} style="width:18px;height:18px;accent-color:#ef4444">
          </label>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🎮 1일 도전 횟수</label>
            <input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-roulette-playLimit" value="${val('playLimit')}">
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🌰 1일 보상 횟수</label>
            <input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-roulette-rewardLimit" value="${val('rewardLimit')}">
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🌰 참가비 (기본)</label>
            <input class="field text-center" type="number" min="1" max="1000" style="width:80px" id="mg-roulette-entryFee" value="${val('entryFee')}">
          </div>
          <hr style="border-color:rgba(0,0,0,.08);margin:8px 0">
          <div class="text-xs font-black text-gray-600 mb-1">🎯 당첨 확률 (합계 100%)</div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">꽝 (0배)</label>
            <div class="flex items-center gap-1"><input class="field text-center" type="number" min="0" max="100" style="width:60px" id="mg-roulette-prob-miss" value="${rProb.miss}"><span class="text-xs text-gray-400">%</span></div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×1 (본전)</label>
            <div class="flex items-center gap-1"><input class="field text-center" type="number" min="0" max="100" style="width:60px" id="mg-roulette-prob-x1" value="${rProb.x1}"><span class="text-xs text-gray-400">%</span></div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×1.5 (소당첨)</label>
            <div class="flex items-center gap-1"><input class="field text-center" type="number" min="0" max="100" style="width:60px" id="mg-roulette-prob-x15" value="${rProb.x15}"><span class="text-xs text-gray-400">%</span></div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×3 (당첨)</label>
            <div class="flex items-center gap-1"><input class="field text-center" type="number" min="0" max="100" style="width:60px" id="mg-roulette-prob-x3" value="${rProb.x3}"><span class="text-xs text-gray-400">%</span></div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×10 (대박)</label>
            <div class="flex items-center gap-1"><input class="field text-center" type="number" min="0" max="100" step="0.1" style="width:60px" id="mg-roulette-prob-x10" value="${rProb.x10}"><span class="text-xs text-gray-400">%</span></div>
          </div>
          <hr style="border-color:rgba(0,0,0,.08);margin:8px 0">
          <div class="text-xs font-black text-gray-600 mb-1">🎡 룰렛 칸 너비 (보이는 비율, 합계 100)</div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">꽝</label>
            <input class="field text-center" type="number" min="1" max="100" style="width:60px" id="mg-roulette-width-miss" value="${rWidth.miss}">
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×1</label>
            <input class="field text-center" type="number" min="1" max="100" style="width:60px" id="mg-roulette-width-x1" value="${rWidth.x1}">
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×1.5</label>
            <input class="field text-center" type="number" min="1" max="100" style="width:60px" id="mg-roulette-width-x15" value="${rWidth.x15}">
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×3</label>
            <input class="field text-center" type="number" min="1" max="100" style="width:60px" id="mg-roulette-width-x3" value="${rWidth.x3}">
          </div>
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-bold text-gray-400 whitespace-nowrap">×10</label>
            <input class="field text-center" type="number" min="1" max="100" style="width:60px" id="mg-roulette-width-x10" value="${rWidth.x10}">
          </div>
        </div>
        <button class="btn btn-primary w-full py-2 mt-3 text-sm" onclick="saveMinigameSetting('roulette')">💾 저장</button>
      </div>`;
    }

    return `
    <div class="clay-card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-black text-gray-800 text-base">${def.icon} ${def.name}</h3>
        <label class="flex items-center gap-2 cursor-pointer">
          <span class="text-xs font-bold ${val('maintenance') ? 'text-red-500' : 'text-gray-400'}">🔧 점검</span>
          <input type="checkbox" id="mg-${id}-maintenance" ${val('maintenance') ? 'checked' : ''} style="width:18px;height:18px;accent-color:#ef4444">
        </label>
      </div>
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🎮 1일 도전 횟수</label>
          <div class="flex items-center gap-2">
            <input class="field text-center" type="number" min="0" max="100" style="width:70px" id="mg-${id}-playLimit" value="${val('playLimit')}" ${val('unlimitedPlays') ? 'disabled style="width:70px;opacity:0.4"' : ''}>
            <label class="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" id="mg-${id}-unlimitedPlays" ${val('unlimitedPlays') ? 'checked' : ''} onchange="document.getElementById('mg-${id}-playLimit').disabled=this.checked;document.getElementById('mg-${id}-playLimit').style.opacity=this.checked?'0.4':'1'" style="width:16px;height:16px">
              <span class="text-xs font-bold text-gray-400">무제한</span>
            </label>
          </div>
        </div>
        ${id !== '2048' ? `
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🌰 1일 보상 횟수</label>
          <input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-${id}-rewardLimit" value="${val('rewardLimit')}">
        </div>` : ''}
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🌰 참가비</label>
          <input class="field text-center" type="number" min="0" max="1000" style="width:80px" id="mg-${id}-entryFee" value="${val('entryFee')}">
        </div>
        ${id !== '2048' ? `
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">📊 N점당 1도토리</label>
          <input class="field text-center" type="number" min="1" max="1000" style="width:80px" id="mg-${id}-rewardRate" value="${val('rewardRate')}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🎁 최대 보상</label>
          <input class="field text-center" type="number" min="0" max="1000" style="width:80px" id="mg-${id}-maxReward" value="${val('maxReward')}">
        </div>` : ''}
        ${id === '2048' ? `
        <hr style="border-color:rgba(0,0,0,.08);margin:8px 0">
        <div class="text-xs font-black text-gray-600 mb-1">🌰 도토리 드롭</div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-400 whitespace-nowrap">합칠 때 드롭 확률(%)</label>
          <input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-2048-dropChance" value="${val('dropChance') ?? 20}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-400 whitespace-nowrap">드롭 시 도토리 개수</label>
          <input class="field text-center" type="number" min="1" max="100" style="width:80px" id="mg-2048-dropAmount" value="${val('dropAmount') ?? 1}">
        </div>` : ''}
        ${def.duration > 0 || id === 'catch' || id === '2048' ? `
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">⏱ 게임 시간(초)</label>
          <input class="field text-center" type="number" min="10" max="300" style="width:80px" id="mg-${id}-duration" value="${val('duration')}">
        </div>` : ''}
        ${id === 'catch' ? `
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🐌 시작 속도</label>
          <input class="field text-center" type="number" min="0.5" max="10" step="0.1" style="width:80px" id="mg-${id}-baseSpeed" value="${val('baseSpeed') ?? 2.2}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🚀 최대 속도</label>
          <input class="field text-center" type="number" min="1" max="20" step="0.1" style="width:80px" id="mg-${id}-maxSpeed" value="${val('maxSpeed') ?? 5.5}">
        </div>` : ''}
        ${id === '2048' ? `
        <hr style="border-color:rgba(0,0,0,.08);margin:8px 0">
        <div class="text-xs font-black text-gray-600 mb-1">💀 폭탄 설정</div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-400 whitespace-nowrap">폭탄 시작 턴</label>
          <input class="field text-center" type="number" min="1" max="20" style="width:80px" id="mg-2048-bombStartTurn" value="${val('bombStartTurn') ?? 3}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-400 whitespace-nowrap">최대 등장 확률(%)</label>
          <input class="field text-center" type="number" min="5" max="100" style="width:80px" id="mg-2048-bombMaxChance" value="${val('bombMaxChance') ?? 60}">
        </div>
        <hr style="border-color:rgba(0,0,0,.08);margin:8px 0">
        <div class="text-xs font-black text-gray-600 mb-1">🔥 보너스 설정</div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-400 whitespace-nowrap">💥 상쇄 보너스(초)</label>
          <input class="field text-center" type="number" min="0" max="10" step="0.1" style="width:80px" id="mg-2048-defuseBonus" value="${val('defuseBonus') ?? 1.2}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-400 whitespace-nowrap">🔥 콤보당 보너스(초)</label>
          <input class="field text-center" type="number" min="0" max="5" step="0.1" style="width:80px" id="mg-2048-comboBonus" value="${val('comboBonus') ?? 0.5}">
        </div>` : ''}
      </div>
      <button class="btn btn-primary w-full py-2 mt-3 text-sm" onclick="saveMinigameSetting('${id}')">💾 저장</button>
    </div>`;
  }).join('');
  _renderMinigameStats();
}

async function saveMinigameSetting(gameId) {
  const intKeys = ['playLimit', 'rewardLimit', 'entryFee', 'rewardRate', 'maxReward', 'duration', 'bombStartTurn', 'bombMaxChance', 'dropChance', 'dropAmount'];
  const floatKeys = ['baseSpeed', 'maxSpeed', 'defuseBonus', 'comboBonus'];
  const updated = {};
  for (const key of intKeys) {
    const el = document.getElementById(`mg-${gameId}-${key}`);
    if (el) updated[key] = parseInt(el.value) || 0;
  }
  for (const key of floatKeys) {
    const el = document.getElementById(`mg-${gameId}-${key}`);
    if (el) updated[key] = parseFloat(el.value) || 0;
  }
  const maintEl = document.getElementById(`mg-${gameId}-maintenance`);
  if (maintEl) updated.maintenance = maintEl.checked;
  const unlimEl = document.getElementById(`mg-${gameId}-unlimitedPlays`);
  if (unlimEl) updated.unlimitedPlays = unlimEl.checked;

  // 룰렛 전용: 확률 + 칸 너비
  if (gameId === 'roulette') {
    var probKeys = ['miss','x1','x15','x3','x10'];
    var probs = {}, widths = {};
    probKeys.forEach(function(k) {
      var pEl = document.getElementById('mg-roulette-prob-' + k);
      var wEl = document.getElementById('mg-roulette-width-' + k);
      probs[k] = pEl ? parseFloat(pEl.value) || 0 : 0;
      widths[k] = wEl ? parseFloat(wEl.value) || 1 : 1;
    });
    var probSum = probKeys.reduce(function(s, k) { return s + probs[k]; }, 0);
    if (Math.abs(probSum - 100) > 0.5) {
      toast('⚠️', '확률 합계가 100%가 아닙니다 (현재: ' + probSum.toFixed(1) + '%)');
      return;
    }
    updated.probs = probs;
    updated.widths = widths;
  }

  _mgSettings[gameId] = { ...(_mgSettings[gameId] || {}), ...updated };
  delete _mgSettings[gameId].dailyLimit; // v1→v2 마이그레이션

  try {
    // ✅ upsert 사용 (check-then-insert/update 패턴 제거)
    const { error } = await sb.from('app_settings').upsert(
      { key: 'minigame_settings', value: _mgSettings, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) throw new Error(error.message);
    toast('✅', `${MG_DEFAULTS[gameId]?.name || gameId} 설정이 저장되었습니다!`);
  } catch(e) { toast('❌', '설정 저장 실패: ' + (e.message || e)); }
}

// ── 관리자: 게임횟수 조정 모달 ──
let _mgChargeState = {};

async function showMgChargeModal(userId, userName) {
  await loadMinigameSettings();

  const today   = getToday();
  const fromUTC = today + 'T00:00:00+09:00';
  const toUTC   = today + 'T23:59:59+09:00';

  let userPlays = {}, userRewards = {};
  try {
    const { data } = await sb.from('minigame_plays')
      .select('game_id, rewarded')
      .eq('user_id', userId)
      .gte('played_at', fromUTC)
      .lte('played_at', toUTC);
    (data || []).forEach(r => {
      userPlays[r.game_id]   = (userPlays[r.game_id]   || 0) + 1;
      if (r.rewarded) userRewards[r.game_id] = (userRewards[r.game_id] || 0) + 1;
    });
  } catch(e) {}

  _mgChargeState = { userId, userName, userPlays, userRewards };
  _renderMgChargeModal('catch');
}

function _renderMgChargeModal(gameId) {
  const s      = _mgChargeState;
  const pLimit = getMgSetting(gameId, 'playLimit');
  const rLimit = getMgSetting(gameId, 'rewardLimit');
  const pUsed  = s.userPlays[gameId]   || 0;
  const rUsed  = s.userRewards[gameId] || 0;
  const pLeft  = Math.max(0, pLimit - pUsed);
  const rLeft  = Math.max(0, rLimit - rUsed);

  _mgChargeState._curPlayUsed    = pUsed;
  _mgChargeState._curRewardUsed  = rUsed;
  _mgChargeState._origPlayUsed   = pUsed;
  _mgChargeState._origRewardUsed = rUsed;
  _mgChargeState._gameId         = gameId;

  showModal(`<div class="text-center">
    <div style="font-size:2rem;margin-bottom:8px">🎮</div>
    <h2 class="text-lg font-black text-gray-800 mb-1">${s.userName} 게임횟수 조정</h2>
    <p class="text-xs text-gray-400 mb-4">오늘의 사용 횟수를 조정합니다</p>

    <select class="field mb-3" id="mgChargeGame" onchange="_onMgChargeGameChange()">
      ${Object.entries(MG_DEFAULTS).map(([id, d]) =>
        `<option value="${id}" ${id === gameId ? 'selected' : ''}>${d.icon} ${d.name}</option>`
      ).join('')}
    </select>

    <div class="mgc-status">
      <div class="mgc-status-title">오늘 현황</div>
      <div class="mgc-status-row">
        <div class="mgc-stat"><span class="mgc-stat-num mgc-play">${pUsed}</span><span class="mgc-stat-label">도전 사용</span></div>
        <span class="mgc-slash">/</span>
        <div class="mgc-stat"><span class="mgc-stat-num">${pLimit}</span><span class="mgc-stat-label">도전 한도</span></div>
        <span class="mgc-slash">→</span>
        <div class="mgc-stat"><span class="mgc-stat-num" style="color:#059669">${pLeft}</span><span class="mgc-stat-label">남은 횟수</span></div>
      </div>
      <div class="mgc-status-row" style="margin-top:4px">
        <div class="mgc-stat"><span class="mgc-stat-num mgc-reward">${rUsed}</span><span class="mgc-stat-label">보상 사용</span></div>
        <span class="mgc-slash">/</span>
        <div class="mgc-stat"><span class="mgc-stat-num">${rLimit}</span><span class="mgc-stat-label">보상 한도</span></div>
        <span class="mgc-slash">→</span>
        <div class="mgc-stat"><span class="mgc-stat-num" style="color:#059669">${rLeft}</span><span class="mgc-stat-label">남은 횟수</span></div>
      </div>
    </div>

    <div class="mgc-adjust">
      <div class="mgc-adjust-row">
        <span class="mgc-adjust-label">🎮 도전 사용횟수</span>
        <div class="mgc-adj-btns">
          <button class="mgc-adj-btn" onclick="_mgcUsedAdj('play',-1)">−</button>
          <span class="mgc-val" id="mgcPlayVal">${pUsed}</span>
          <button class="mgc-adj-btn" onclick="_mgcUsedAdj('play',+1)">+</button>
        </div>
        <span class="mgc-diff" id="mgcPlayDiff"></span>
      </div>
      <div class="mgc-adjust-row">
        <span class="mgc-adjust-label">🌰 보상 사용횟수</span>
        <div class="mgc-adj-btns">
          <button class="mgc-adj-btn" onclick="_mgcUsedAdj('reward',-1)">−</button>
          <span class="mgc-val" id="mgcRewardVal">${rUsed}</span>
          <button class="mgc-adj-btn" onclick="_mgcUsedAdj('reward',+1)">+</button>
        </div>
        <span class="mgc-diff" id="mgcRewardDiff"></span>
      </div>
    </div>

    <p class="text-xs text-gray-400 mt-2 mb-3">
      − 줄이면 기회가 늘어납니다 &nbsp;|&nbsp; + 늘리면 기회가 줄어듭니다
    </p>

    <div class="flex gap-2 mt-3">
      <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
      <button class="btn btn-primary flex-1 py-2" onclick="_doMgCharge()">적용</button>
    </div>
  </div>`);
}

function _onMgChargeGameChange() {
  const gameId = document.getElementById('mgChargeGame').value;
  _renderMgChargeModal(gameId);
}

function _mgcUsedAdj(type, delta) {
  const s = _mgChargeState;
  if (type === 'play') {
    s._curPlayUsed = Math.max(0, s._curPlayUsed + delta);
    document.getElementById('mgcPlayVal').textContent = s._curPlayUsed;
    _showUsedDiff('mgcPlayDiff', s._curPlayUsed - s._origPlayUsed, 'mgcPlayVal');
  } else {
    s._curRewardUsed = Math.max(0, s._curRewardUsed + delta);
    document.getElementById('mgcRewardVal').textContent = s._curRewardUsed;
    _showUsedDiff('mgcRewardDiff', s._curRewardUsed - s._origRewardUsed, 'mgcRewardVal');
  }
}

function _showUsedDiff(diffId, diff, valId) {
  const el = document.getElementById(diffId);
  const valEl = document.getElementById(valId);
  if (diff === 0) {
    el.textContent  = '';
    el.className    = 'mgc-diff';
    valEl.className = 'mgc-val';
  } else if (diff > 0) {
    el.textContent  = '+' + diff;
    el.className    = 'mgc-diff mgc-diff-plus';
    valEl.className = 'mgc-val mgc-val-plus';
  } else {
    el.textContent  = '' + diff;
    el.className    = 'mgc-diff mgc-diff-minus';
    valEl.className = 'mgc-val mgc-val-minus';
  }
}

async function _doMgCharge() {
  const s          = _mgChargeState;
  const gameId     = s._gameId;
  const playDiff   = s._curPlayUsed   - s._origPlayUsed;
  const rewardDiff = s._curRewardUsed - s._origRewardUsed;
  if (playDiff === 0 && rewardDiff === 0) { toast('⚠️', '변경사항이 없습니다'); return; }

  closeModal();
  try {
    const today = getToday();

    // 사용횟수 증가 → 가짜 기록 추가 (기회 차감)
    if (playDiff > 0) {
      const rows = [];
      for (let i = 0; i < playDiff; i++) {
        rows.push({
          user_id: s.userId, game_id: gameId,
          score: 0, reward: 0,
          rewarded: rewardDiff > 0 && i < rewardDiff,
          played_at: new Date().toISOString()
        });
      }
      await sb.from('minigame_plays').insert(rows);
    }

    // 사용횟수 감소 → 최신 기록 삭제 (기회 복구)
    if (playDiff < 0) {
      const deleteCount = Math.abs(playDiff);
      const { data: recent } = await sb.from('minigame_plays')
        .select('id')
        .eq('user_id', s.userId)
        .eq('game_id', gameId)
        .gte('played_at', today + 'T00:00:00+09:00')
        .lte('played_at', today + 'T23:59:59+09:00')
        .order('played_at', { ascending: false })
        .limit(deleteCount);
      if (recent?.length) {
        const ids = recent.map(r => r.id);
        await sb.from('minigame_plays').delete().in('id', ids);
      }
    }

    // 보상횟수만 별도 조정 (도전 변경 없이 보상만)
    if (rewardDiff !== 0 && playDiff === 0) {
      if (rewardDiff > 0) {
        const { data: unrewarded } = await sb.from('minigame_plays')
          .select('id').eq('user_id', s.userId).eq('game_id', gameId)
          .eq('rewarded', false)
          .gte('played_at', today + 'T00:00:00+09:00')
          .lte('played_at', today + 'T23:59:59+09:00')
          .order('played_at', { ascending: false })
          .limit(rewardDiff);
        if (unrewarded?.length) {
          await sb.from('minigame_plays').update({ rewarded: true }).in('id', unrewarded.map(r => r.id));
        }
      } else {
        const { data: rewarded } = await sb.from('minigame_plays')
          .select('id').eq('user_id', s.userId).eq('game_id', gameId)
          .eq('rewarded', true)
          .gte('played_at', today + 'T00:00:00+09:00')
          .lte('played_at', today + 'T23:59:59+09:00')
          .order('played_at', { ascending: false })
          .limit(Math.abs(rewardDiff));
        if (rewarded?.length) {
          await sb.from('minigame_plays').update({ rewarded: false }).in('id', rewarded.map(r => r.id));
        }
      }
    }

    const parts = [];
    if (playDiff   !== 0) parts.push(`도전 ${playDiff > 0 ? '+' : ''}${playDiff}`);
    if (rewardDiff !== 0) parts.push(`보상 ${rewardDiff > 0 ? '+' : ''}${rewardDiff}`);
    toast('✅', `${s.userName} ${MG_DEFAULTS[gameId]?.name} ${parts.join(', ')} 조정 완료!`);

  } catch(e) { toast('❌', '처리 실패: ' + (e.message || e)); }
}

// ── 통계 ──
async function _renderMinigameStats() {
  const area = document.getElementById('mgStatsArea');
  if (!area) return;

  // ✅ KST 기준 오늘 날짜
  const today   = getToday();
  const fromUTC = today + 'T00:00:00+09:00';
  const toUTC   = today + 'T23:59:59+09:00';

  try {
    const { data } = await sb.from('minigame_plays')
      .select('game_id, score, reward, user_id, rewarded')
      .gte('played_at', fromUTC)
      .lte('played_at', toUTC);

    if (!data?.length) { area.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">오늘 플레이 기록이 없습니다</p>'; return; }

    const stats = {}, players = new Set();
    for (const r of data) {
      if (!stats[r.game_id]) stats[r.game_id] = { plays: 0, claims: 0, totalReward: 0, bestScore: 0 };
      stats[r.game_id].plays++;
      if (r.rewarded) stats[r.game_id].claims++;
      stats[r.game_id].totalReward += r.reward || 0;
      stats[r.game_id].bestScore = Math.max(stats[r.game_id].bestScore, r.score || 0);
      players.add(r.user_id);
    }

    area.innerHTML = `
      <div class="text-xs text-gray-400 mb-3 text-left">총 ${players.size}명 · ${data.length}회 플레이</div>
      ${Object.entries(stats).map(([gid, s]) => `
        <div class="clay-card p-3 mb-2 text-left">
          <span class="font-black text-sm text-gray-700">${MG_DEFAULTS[gid]?.icon || '🎮'} ${MG_DEFAULTS[gid]?.name || gid}</span>
          <div class="flex gap-3 mt-1 text-xs text-gray-500 font-semibold flex-wrap">
            <span>🎮 ${s.plays}회</span>
            <span>🌰 수령 ${s.claims}회</span>
            <span>🏆 최고 ${s.bestScore}점</span>
            <span>🌰 총 ${s.totalReward} 지급</span>
          </div>
        </div>`).join('')}`;
  } catch(e) { area.innerHTML = '<p class="text-sm text-gray-400">통계 조회 실패</p>'; }
}


// ══════════════════════════════════════════════
//  랭킹 시스템
// ══════════════════════════════════════════════

let _rankPeriod      = 'daily';
let _adminRankPeriod = 'daily';
let _mgLogOffset     = 0;
const MG_LOG_PAGE    = 20;

function _getPeriodRange(period) {
  // ✅ KST 기준
  if (period === 'daily') {
    const d = getToday();
    return { from: d + 'T00:00:00+09:00', to: d + 'T23:59:59+09:00' };
  }
  if (period === 'weekly') {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    // KST 기준 월요일 날짜 문자열
    const monKST = new Date(mon.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const todStr = getToday();
    return { from: monKST + 'T00:00:00+09:00', to: todStr + 'T23:59:59+09:00' };
  }
  return { from: '2020-01-01T00:00:00+09:00', to: '2099-12-31T23:59:59+09:00' };
}

function _medalEmoji(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `<span class="rank-num">${rank}</span>`;
}

function _periodLabel(p) { return p === 'daily' ? '오늘' : p === 'weekly' ? '이번 주' : '전체'; }

function setRankPeriod(period, btn) {
  _rankPeriod = period;
  document.querySelectorAll('#utab-ranking .rank-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderUserRanking();
}

async function renderUserRanking() {
  const gameId = document.getElementById('rankGameFilter')?.value || 'catch';
  const range  = _getPeriodRange(_rankPeriod);
  const list   = document.getElementById('userRankingList');
  list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">로딩 중...</p>';

  try {
    const { data } = await sb.from('minigame_plays').select('user_id, score')
      .eq('game_id', gameId).gte('played_at', range.from).lte('played_at', range.to)
      .order('score', { ascending: false }).limit(200);

    if (!data?.length) {
      list.innerHTML = `<p class="text-sm text-gray-400 text-center py-6">📊 ${_periodLabel(_rankPeriod)} 기록이 없습니다</p>`;
      _renderMyStats(gameId); return;
    }

    const best = {};
    for (const r of data) { if (!best[r.user_id] || r.score > best[r.user_id]) best[r.user_id] = r.score; }
    const userIds = Object.keys(best);
    const { data: users } = await sb.from('users').select('id, display_name').in('id', userIds);
    const nameMap = {};
    (users || []).forEach(u => nameMap[u.id] = u.display_name);

    const sorted = Object.entries(best)
      .map(([uid, score]) => ({ uid, score, name: nameMap[uid] || '알 수 없음' }))
      .sort((a, b) => b.score - a.score);
    const myId   = myProfile?.id;
    const myRank = sorted.findIndex(r => r.uid === myId) + 1;

    list.innerHTML = sorted.slice(0, 20).map((r, i) => {
      const rank = i + 1, isMe = r.uid === myId;
      return `<div class="rank-row ${isMe ? 'rank-row-me' : ''} ${rank <= 3 ? 'rank-row-top' : ''}">
        <div class="rank-medal">${_medalEmoji(rank)}</div>
        <div class="rank-name">${r.name}${isMe ? ' <span class="rank-me-badge">나</span>' : ''}</div>
        <div class="rank-score">${r.score.toLocaleString()}점</div>
      </div>`;
    }).join('');

    if (myRank > 20 && myId) {
      const me = sorted.find(r => r.uid === myId);
      if (me) list.innerHTML += `<div class="rank-divider">⋯</div><div class="rank-row rank-row-me">
        <div class="rank-medal"><span class="rank-num">${myRank}</span></div>
        <div class="rank-name">${me.name} <span class="rank-me-badge">나</span></div>
        <div class="rank-score">${me.score.toLocaleString()}점</div></div>`;
    }
  } catch(e) { list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">랭킹 조회 실패</p>'; }
  _renderMyStats(gameId);
}

async function _renderMyStats(gameId) {
  const area = document.getElementById('myGameStats');
  if (!area || !myProfile) return;
  try {
    const { data } = await sb.from('minigame_plays').select('score, reward, played_at')
      .eq('user_id', myProfile.id).eq('game_id', gameId)
      .order('played_at', { ascending: false }).limit(100);

    if (!data?.length) { area.innerHTML = '<p class="text-sm text-gray-400 text-center py-2">아직 플레이 기록이 없어요</p>'; return; }

    const totalPlays  = data.length;
    const bestScore   = Math.max(...data.map(r => r.score));
    const totalReward = data.reduce((s, r) => s + (r.reward || 0), 0);
    const avgScore    = Math.round(data.reduce((s, r) => s + r.score, 0) / totalPlays);

    area.innerHTML = `<div class="flex gap-3 justify-center flex-wrap">
      <div class="rank-my-stat"><span class="rank-my-num" style="color:#d97706">${totalPlays}</span><span class="rank-my-label">총 플레이</span></div>
      <div class="rank-my-stat"><span class="rank-my-num" style="color:#dc2626">${bestScore}</span><span class="rank-my-label">최고 점수</span></div>
      <div class="rank-my-stat"><span class="rank-my-num" style="color:#059669">${avgScore}</span><span class="rank-my-label">평균 점수</span></div>
      <div class="rank-my-stat"><span class="rank-my-num" style="color:#7c3aed">${totalReward}</span><span class="rank-my-label">총 보상 🌰</span></div>
    </div>`;
  } catch(e) { area.innerHTML = '<p class="text-sm text-gray-400">기록 조회 실패</p>'; }
}

function setAdminRankPeriod(period, btn) {
  _adminRankPeriod = period;
  document.querySelectorAll('#atab-ranking .rank-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAdminRanking();
}

async function renderAdminRanking() {
  const gameId = document.getElementById('adminRankGameFilter')?.value || 'catch';
  const range  = _getPeriodRange(_adminRankPeriod);
  const list   = document.getElementById('adminRankingList');
  list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">로딩 중...</p>';

  try {
    const { data } = await sb.from('minigame_plays').select('user_id, score')
      .eq('game_id', gameId).gte('played_at', range.from).lte('played_at', range.to)
      .order('score', { ascending: false }).limit(200);

    if (!data?.length) { list.innerHTML = `<p class="text-sm text-gray-400 text-center py-6">📊 ${_periodLabel(_adminRankPeriod)} 기록이 없습니다</p>`; renderMinigameLog(); return; }

    const best = {};
    for (const r of data) { if (!best[r.user_id] || r.score > best[r.user_id]) best[r.user_id] = r.score; }
    const userIds = Object.keys(best);
    const { data: users } = await sb.from('users').select('id, display_name').in('id', userIds);
    const nameMap = {};
    (users || []).forEach(u => nameMap[u.id] = u.display_name);

    const sorted = Object.entries(best)
      .map(([uid, score]) => ({ uid, score, name: nameMap[uid] || '알 수 없음' }))
      .sort((a, b) => b.score - a.score);

    list.innerHTML = sorted.slice(0, 30).map((r, i) => {
      const rank = i + 1;
      return `<div class="rank-row ${rank <= 3 ? 'rank-row-top' : ''}">
        <div class="rank-medal">${_medalEmoji(rank)}</div>
        <div class="rank-name">${r.name}</div>
        <div class="rank-score">${r.score.toLocaleString()}점</div>
      </div>`;
    }).join('');
  } catch(e) { list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">랭킹 조회 실패</p>'; }
  _mgLogOffset = 0;
  renderMinigameLog();
}

async function renderMinigameLog() {
  const gameFilter = document.getElementById('adminLogGameFilter')?.value || '';
  const list = document.getElementById('minigameLogList');
  _mgLogOffset = 0;
  try {
    let query = sb.from('minigame_plays').select('user_id, game_id, score, reward, rewarded, played_at')
      .order('played_at', { ascending: false }).range(0, MG_LOG_PAGE - 1);
    if (gameFilter) query = query.eq('game_id', gameFilter);
    const { data } = await query;

    if (!data?.length) {
      list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">로그가 없습니다</p>';
      document.getElementById('mgLogMoreBtn').style.display = 'none';
      return;
    }

    const uids = [...new Set(data.map(r => r.user_id))];
    const { data: users } = await sb.from('users').select('id, display_name').in('id', uids);
    const nameMap = {};
    (users || []).forEach(u => nameMap[u.id] = u.display_name);

    list.innerHTML = _renderLogRows(data, nameMap);
    _mgLogOffset   = data.length;
    document.getElementById('mgLogMoreBtn').style.display = data.length >= MG_LOG_PAGE ? '' : 'none';
  } catch(e) { list.innerHTML = '<p class="text-sm text-gray-400">로그 조회 실패</p>'; }
}

async function loadMoreMinigameLogs() {
  const gameFilter = document.getElementById('adminLogGameFilter')?.value || '';
  const list = document.getElementById('minigameLogList');
  try {
    let query = sb.from('minigame_plays').select('user_id, game_id, score, reward, rewarded, played_at')
      .order('played_at', { ascending: false }).range(_mgLogOffset, _mgLogOffset + MG_LOG_PAGE - 1);
    if (gameFilter) query = query.eq('game_id', gameFilter);
    const { data } = await query;
    if (!data?.length) { document.getElementById('mgLogMoreBtn').style.display = 'none'; return; }

    const uids = [...new Set(data.map(r => r.user_id))];
    const { data: users } = await sb.from('users').select('id, display_name').in('id', uids);
    const nameMap = {};
    (users || []).forEach(u => nameMap[u.id] = u.display_name);
    list.innerHTML += _renderLogRows(data, nameMap);
    _mgLogOffset   += data.length;
    document.getElementById('mgLogMoreBtn').style.display = data.length >= MG_LOG_PAGE ? '' : 'none';
  } catch(e) { console.warn('[mgLog]', e); }
}

function _renderLogRows(data, nameMap) {
  return data.map(r => {
    const t         = new Date(r.played_at);
    const timeStr   = `${t.getMonth()+1}/${t.getDate()} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    const gameName  = MG_DEFAULTS[r.game_id]?.icon || '🎮';
    const rewardStr = r.rewarded
      ? `<span style="color:#059669">+${r.reward}🌰</span>`
      : '<span style="color:#9ca3af">넘김</span>';
    return `<div class="mg-log-row">
      <span class="mg-log-game">${gameName}</span>
      <span class="mg-log-user">${nameMap[r.user_id] || '—'}</span>
      <span class="mg-log-score">${r.score}점</span>
      <span class="mg-log-reward">${rewardStr}</span>
      <span class="mg-log-time">${timeStr}</span>
    </div>`;
  }).join('');
}
