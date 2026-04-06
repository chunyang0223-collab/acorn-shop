// ──────────────────────────────────────────────
//  미니게임 시스템 v2 (도전/보상 횟수 분리)
// ──────────────────────────────────────────────

// ⚠️ 기본값은 DB 로드 실패 시 폴백이므로 최대한 보수적으로 설정
// 실제 운영 값은 반드시 DB(app_settings)에서 로드됨
// maintenance: true → DB 미로드 시 점검중 표시 (안전장치)
const MG_DEFAULTS = {
  catch: {
    name: '도토리 캐치', icon: '🧺',
    maintenance: true,
    playLimit: 3,
    rewardLimit: 1,
    entryFee: 0,
    rewardRate: 5,
    maxReward: 10,
    duration: 30
  },
  '2048': {
    name: '2048 하드코어', icon: '💀',
    maintenance: true,
    playLimit: 3, rewardLimit: 1, unlimitedPlays: false,
    entryFee: 0, duration: 30,
    dropChance: 10, dropMin: 1, dropMax: 1,
    itemDropChance: 0, itemDropAmount: 1,
    bombStartTurn: 3, bombMaxChance: 60, defuseBonus: 1.2, comboBonus: 0.5
  },
  roulette: {
    name: '행운의 룰렛', icon: '🎡',
    maintenance: true,
    playLimit: 3, rewardLimit: 1,
    entryFee: 5, rewardRate: 1, maxReward: 10, duration: 0
  }
};

let _mgSettings = {};
let _mgSettingsLoaded = false;  // DB 설정 로드 완료 플래그
let _mgTodayPlays = {};
let _mgTodayRewards = {};
let _mgBonusPlays = {};
let _mgBonusRewards = {};

// ── 설정 로드 ──
async function loadMinigameSettings() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'minigame_settings').maybeSingle();
    _mgSettings = _parseValue(data?.value) || {};
    _mgSettingsLoaded = true;
  } catch(e) { _mgSettings = {}; }
  return _mgSettings;
}

function getMgSetting(gameId, key) {
  // DB 설정 미로드 시 maintenance 강제 (안전장치)
  if (!_mgSettingsLoaded && key === 'maintenance') return true;

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
async function recordPlay(gameId, score, rewarded, actualReward) {
  if (!myProfile) return;
  const reward = !rewarded ? 0
    : actualReward != null ? actualReward
    : Math.min(getMgSetting(gameId, 'maxReward'), Math.max(score > 0 ? 1 : 0, Math.floor(score / getMgSetting(gameId, 'rewardRate'))));
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

  // SVG illustrations per game
  const _mgSvg = {
    catch: `<svg viewBox="0 0 200 80" style="display:block;width:100%;border-radius:16px 16px 0 0" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="mgsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#90daf4"/><stop offset="100%" stop-color="#c8f0d8"/></linearGradient></defs><rect width="200" height="80" fill="url(#mgsky)"/><ellipse cx="45" cy="18" rx="22" ry="10" fill="#fff" opacity=".6"/><ellipse cx="140" cy="14" rx="18" ry="8" fill="#fff" opacity=".45"/><ellipse cx="170" cy="26" rx="12" ry="6" fill="#fff" opacity=".3"/><circle cx="60" cy="38" r="3.5" fill="#a0724a"/><circle cx="100" cy="30" r="3" fill="#b8845a"/><circle cx="140" cy="44" r="3.5" fill="#a0724a"/><circle cx="80" cy="52" r="2.5" fill="#c8965a"/><path d="M90 68 Q95 56 100 68 Q105 56 110 68Z" fill="#6ab04c" opacity=".5"/><path d="M30 72 Q38 58 46 72 Q54 58 62 72Z" fill="#78c850" opacity=".4"/><path d="M150 74 Q156 62 162 74Z" fill="#6ab04c" opacity=".35"/><rect x="96" y="68" width="8" height="12" rx="2" fill="#8B6F47" opacity=".4"/></svg>`,
    '2048': `<svg viewBox="0 0 200 80" style="display:block;width:100%;border-radius:16px 16px 0 0" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="mgpurp" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3b2070"/><stop offset="100%" stop-color="#5b30a0"/></linearGradient><radialGradient id="mgpglow" cx="50%" cy="50%"><stop offset="0%" stop-color="#a78bfa" stop-opacity=".15"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs><rect width="200" height="80" fill="url(#mgpurp)"/><rect width="200" height="80" fill="url(#mgpglow)"/><line x1="28" y1="5" x2="55" y2="42" stroke="#c4b5fd" stroke-width="1" opacity=".5"/><line x1="55" y1="42" x2="44" y2="60" stroke="#a78bfa" stroke-width=".7" opacity=".4"/><line x1="55" y1="42" x2="72" y2="54" stroke="#c4b5fd" stroke-width=".6" opacity=".35"/><line x1="142" y1="8" x2="160" y2="48" stroke="#c4b5fd" stroke-width=".9" opacity=".45"/><line x1="160" y1="48" x2="150" y2="68" stroke="#a78bfa" stroke-width=".6" opacity=".35"/><line x1="160" y1="48" x2="178" y2="58" stroke="#c4b5fd" stroke-width=".5" opacity=".3"/><circle cx="55" cy="42" r="3" fill="#e9d5ff" opacity=".7"/><circle cx="160" cy="48" r="2.5" fill="#e9d5ff" opacity=".6"/><circle cx="100" cy="18" r="1.5" fill="#e9d5ff" opacity=".4"/><circle cx="80" cy="62" r="1.2" fill="#e9d5ff" opacity=".35"/><circle cx="175" cy="22" r="1" fill="#f5f0ff" opacity=".3"/><circle cx="35" cy="68" r=".8" fill="#f5f0ff" opacity=".25"/><text x="100" y="50" text-anchor="middle" font-family="Outfit,sans-serif" font-size="26" font-weight="900" fill="#e9d5ff" opacity=".08">2048</text></svg>`,
    roulette: `<svg viewBox="0 0 200 80" style="display:block;width:100%;border-radius:16px 16px 0 0" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="mgcasino" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#5c3a12"/><stop offset="100%" stop-color="#7a4e1a"/></linearGradient><radialGradient id="mggglow" cx="50%" cy="50%"><stop offset="0%" stop-color="#ffd780" stop-opacity=".12"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs><rect width="200" height="80" fill="url(#mgcasino)"/><rect width="200" height="80" fill="url(#mggglow)"/><rect x="10" y="8" width="180" height="64" rx="6" fill="none" stroke="#d4a520" stroke-width=".8" opacity=".35"/><rect x="16" y="14" width="168" height="52" rx="4" fill="none" stroke="#d4a520" stroke-width=".4" opacity=".25"/><line x1="10" y1="8" x2="16" y2="14" stroke="#d4a520" stroke-width=".4" opacity=".25"/><line x1="190" y1="8" x2="184" y2="14" stroke="#d4a520" stroke-width=".4" opacity=".25"/><line x1="10" y1="72" x2="16" y2="66" stroke="#d4a520" stroke-width=".4" opacity=".25"/><line x1="190" y1="72" x2="184" y2="66" stroke="#d4a520" stroke-width=".4" opacity=".25"/><circle cx="100" cy="40" r="20" fill="none" stroke="#e8b830" stroke-width="1" opacity=".25"/><circle cx="100" cy="40" r="13" fill="none" stroke="#e8b830" stroke-width=".6" opacity=".2"/><circle cx="100" cy="40" r="4" fill="#e8b830" opacity=".18"/><text x="38" y="38" font-size="16" fill="#e8b830" opacity=".2" font-weight="700" font-family="serif">♠</text><text x="158" y="38" font-size="16" fill="#e8b830" opacity=".2" font-weight="700" font-family="serif">♦</text><text x="38" y="64" font-size="14" fill="#e8b830" opacity=".15" font-weight="700" font-family="serif">♥</text><text x="158" y="64" font-size="14" fill="#e8b830" opacity=".15" font-weight="700" font-family="serif">♣</text><circle cx="30" cy="20" r="2" fill="#e8c840" opacity=".25"/><circle cx="170" cy="20" r="2" fill="#e8c840" opacity=".25"/><circle cx="30" cy="60" r="2" fill="#e8c840" opacity=".2"/><circle cx="170" cy="60" r="2" fill="#e8c840" opacity=".2"/></svg>`
  };

  const _mgStyle = {
    catch:    { card:'background:#e6f9f0;border-top:1.5px solid rgba(255,255,255,.7);border-left:1.5px solid rgba(255,255,255,.5);border-right:1.5px solid rgba(16,185,129,.15);border-bottom:5px solid rgba(4,120,87,.35);box-shadow:0 6px 0 rgba(4,120,87,.18),0 8px 16px rgba(16,185,129,.14)', active:'border-bottom-width:1px;box-shadow:0 0 0 transparent,0 1px 4px rgba(16,185,129,.1)', title:'#065f46', sub:'#047857', tagBg:'rgba(4,120,87,.08)', tagColor:'#065f46' },
    '2048':   { card:'background:#2a1e50;border-top:1.5px solid rgba(200,160,255,.15);border-left:1.5px solid rgba(200,160,255,.1);border-right:1.5px solid rgba(160,100,255,.15);border-bottom:5px solid rgba(60,30,120,.7);box-shadow:0 6px 0 rgba(80,40,160,.3),0 8px 16px rgba(139,92,246,.2)', active:'border-bottom-width:1px;box-shadow:0 0 0 transparent,0 1px 4px rgba(139,92,246,.1)', title:'#e8d8ff', sub:'#c4b0e8', tagBg:'rgba(167,139,250,.15)', tagColor:'#d8c4f8' },
    roulette: { card:'background:#3d2810;border-top:1.5px solid rgba(255,200,80,.18);border-left:1.5px solid rgba(255,200,80,.12);border-right:1.5px solid rgba(220,160,60,.2);border-bottom:5px solid rgba(140,80,15,.6);box-shadow:0 6px 0 rgba(120,65,10,.3),0 8px 16px rgba(220,160,50,.15)', active:'border-bottom-width:1px;box-shadow:0 0 0 transparent,0 1px 4px rgba(220,160,50,.08)', title:'#fad080', sub:'#d8b060', tagBg:'rgba(232,184,48,.12)', tagColor:'#f0c868' }
  };

  grid.innerHTML = MINIGAMES.map(g => {
    const pLimit    = getPlayLimit(g.id);
    const rLimit    = getRewardLimit(g.id);
    const played    = _mgTodayPlays[g.id]   || 0;
    const rewarded  = _mgTodayRewards[g.id] || 0;
    const pRemain   = Math.max(0, pLimit - played);
    const rRemain   = Math.max(0, rLimit - rewarded);
    let fee         = getMgSetting(g.id, 'entryFee');
    const _mgEvtDisc = (typeof getMinigameDiscount === 'function') ? getMinigameDiscount() : 0;
    const origFee   = fee;
    if (_mgEvtDisc > 0 && fee > 0) fee = Math.max(0, fee - _mgEvtDisc);
    const maxReward = getMgSetting(g.id, 'maxReward');
    const duration  = getMgSetting(g.id, 'duration');
    const maint     = getMgSetting(g.id, 'maintenance');
    const unlimited = getMgSetting(g.id, 'unlimitedPlays');
    const exhausted = !unlimited && pRemain <= 0 && g.ready;
    const blocked   = !g.ready || maint || exhausted;
    const s = _mgStyle[g.id] || _mgStyle.catch;
    const svg = _mgSvg[g.id] || '';

    // overlay for blocked states
    let overlayHtml = '';
    if (!g.ready) overlayHtml = '<div style="position:absolute;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:16px;display:flex;align-items:center;justify-content:center;z-index:2"><span style="font-size:13px;font-weight:800;color:#fff;background:rgba(0,0,0,.5);padding:6px 16px;border-radius:10px;letter-spacing:1px">COMING SOON</span></div>';
    else if (maint) overlayHtml = '<div style="position:absolute;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:16px;display:flex;align-items:center;justify-content:center;z-index:2"><span style="font-size:14px;font-weight:800;color:#fff;background:rgba(0,0,0,.5);padding:8px 18px;border-radius:10px">🔧 점검중</span></div>';
    else if (exhausted) overlayHtml = '<div style="position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border-radius:16px;display:flex;align-items:center;justify-content:center;z-index:2"><span style="font-size:12px;font-weight:700;color:#fff;background:rgba(0,0,0,.5);padding:6px 14px;border-radius:10px">오늘 도전 횟수 소진</span></div>';

    // tags — 상단: 게임 정보, 하단: 횟수
    let infoTags = [];
    let countTags = [];
    if (duration > 0) infoTags.push(`⏱ ${duration}초`);
    if (fee > 0) {
      if (_mgEvtDisc > 0 && origFee > fee) infoTags.push(`🌰 <s>${origFee}</s> ${fee} 참가비`);
      else infoTags.push(`🌰 ${fee} 참가비`);
    } else infoTags.push(origFee > 0 && _mgEvtDisc > 0 ? '🎉 무료!' : '무료');
    if (g.id === '2048') infoTags.push('🌰 드롭');
    else if (maxReward) infoTags.push(`🎁 최대 ${maxReward}`);
    if (g.ready && !maint && !unlimited) {
      countTags.push(`🎮 ${pRemain}/${pLimit}`);
      if (g.id !== '2048') countTags.push(`🌰 ${rRemain}/${rLimit}`);
    }
    const _tagSpan = t => `<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:${s.tagBg};color:${s.tagColor};font-weight:600">${t}</span>`;
    const tagsHtml = `<div style="display:flex;gap:4px;flex-wrap:wrap">${infoTags.map(_tagSpan).join('')}</div>`
      + (countTags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${countTags.map(_tagSpan).join('')}</div>` : '');

    return `
    <div style="position:relative;border-radius:16px;overflow:hidden;cursor:${blocked?'default':'pointer'};${s.card};transition:transform .1s,box-shadow .1s;-webkit-tap-highlight-color:transparent"
         class="mg-hub-card ${blocked ? 'mg-hub-blocked' : 'mg-hub-active'}"
         ${!blocked ? `onclick="startMinigame('${g.id}')"` : ''}>
      ${overlayHtml}
      ${svg}
      <div style="padding:12px 14px 11px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
          <span style="font-size:13.5px;font-weight:700;color:${s.title}">${g.name}</span>
        </div>
        <p style="font-size:11px;color:${s.sub};margin:0 0 7px;line-height:1.3">${g.desc}</p>
        ${tagsHtml}
      </div>
    </div>`;
  }).join('');

  // 최근 플레이 기록 렌더링
  _renderRecentPlays();
}

async function _renderRecentPlays() {
  const wrap = document.getElementById('mgRecentPlays');
  const list = document.getElementById('mgRecentList');
  if (!wrap || !list || !myProfile) return;

  try {
    const { data } = await sb.from('minigame_plays')
      .select('game_id, score, reward, rewarded, played_at')
      .eq('user_id', myProfile.id)
      .order('played_at', { ascending: false })
      .limit(5);

    if (!data?.length) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = '';
    list.innerHTML = data.map(r => {
      const t = new Date(r.played_at);
      const now = new Date();
      const diffMs = now - t;
      const diffMin = Math.floor(diffMs / 60000);
      const diffHr = Math.floor(diffMs / 3600000);
      let timeStr;
      if (diffMin < 1) timeStr = '방금';
      else if (diffMin < 60) timeStr = `${diffMin}분 전`;
      else if (diffHr < 24) timeStr = `${diffHr}시간 전`;
      else {
        const days = Math.floor(diffHr / 24);
        timeStr = days === 1 ? '어제' : `${days}일 전`;
      }

      const gameIcon = MG_DEFAULTS[r.game_id]?.icon || '🎮';
      const gameName = MG_DEFAULTS[r.game_id]?.name || r.game_id;
      const rewardStr = r.rewarded
        ? `<span style="color:#059669;font-weight:800">+${r.reward}🌰</span>`
        : '<span style="color:#9ca3af">—</span>';

      return `<div class="mg-recent-row">
        <span class="mg-recent-game">${gameIcon}</span>
        <span class="mg-recent-name">${gameName}</span>
        <span class="mg-recent-score">${r.score.toLocaleString()}점</span>
        <span class="mg-recent-reward">${rewardStr}</span>
        <span class="mg-recent-time">${timeStr}</span>
      </div>`;
    }).join('');
  } catch(e) {
    wrap.style.display = 'none';
  }
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

  let fee = getMgSetting(id, 'entryFee');
  // 미니게임 참가비 이벤트 할인 적용
  const mgDiscount = (typeof getMinigameDiscount === 'function') ? getMinigameDiscount() : 0;
  if (mgDiscount > 0 && fee > 0) fee = Math.max(0, fee - mgDiscount);

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
    const discountNote = mgDiscount > 0 ? `<p class="text-xs text-green-600 font-bold mb-1">🎉 이벤트 할인 -${mgDiscount}🌰 적용!</p>` : '';
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">🎮</div>
      <h2 class="text-lg font-black text-gray-800 mb-2">게임 시작</h2>
      ${discountNote}
      <p class="text-sm text-gray-500 mb-1">참가비 <span class="font-black text-amber-600">🌰 ${fee}</span>이 차감됩니다.</p>
      ${!unlimited && id !== '2048' ? `<p class="text-xs text-gray-400 mb-1">도전: ${pLimit - played}/${pLimit}회 · 보상: ${rLimit - rewarded}/${rLimit}회</p>` : ''}
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
  // 2048 BGM 정지 (안전장치)
  if (typeof stop2048Bgm === 'function') stop2048Bgm();
  document.getElementById('minigame-hub').classList.remove('hidden');
  document.getElementById('minigame-play').classList.add('hidden');
  document.getElementById('minigame-play').innerHTML = '';
  renderMinigameHub();
}



// ══════════════════════════════════════════════
//  관리자: 미니게임 설정 UI
// ══════════════════════════════════════════════

var _mgActiveTab = 'catch';

function _mgSwitchTab(gameId) {
  _mgActiveTab = gameId;
  var games = ['catch', '2048', 'roulette'];
  games.forEach(function(id) {
    var pane = document.getElementById('mgPane-' + id);
    var btn  = document.getElementById('mgTabBtn-' + id);
    if (!pane || !btn) return;
    if (id === gameId) {
      pane.classList.remove('hidden');
      btn.classList.add('mg-tab-active');
    } else {
      pane.classList.add('hidden');
      btn.classList.remove('mg-tab-active');
    }
  });
}

async function renderMinigameAdmin() {
  await loadMinigameSettings();
  const list  = document.getElementById('mgSettingsList');
  const games = ['catch', '2048', 'roulette'];

  /* ── 탭 버튼 ── */
  var tabBar = '<div class="mg-tab-bar">' +
    games.map(function(id) {
      var def = MG_DEFAULTS[id];
      var s   = _mgSettings[id] || {};
      var isMaint = (s.maintenance ?? def.maintenance);
      return '<button id="mgTabBtn-' + id + '" class="mg-tab-btn' + (id === _mgActiveTab ? ' mg-tab-active' : '') + '" onclick="_mgSwitchTab(\'' + id + '\')">' +
        '<span class="mg-tab-icon">' + def.icon + '</span>' +
        '<span class="mg-tab-name">' + def.name + '</span>' +
        (isMaint ? '<span class="mg-tab-badge-maint">점검</span>' : '') +
      '</button>';
    }).join('') +
  '</div>';

  /* ── 각 게임 패널 ── */
  var panes = games.map(function(id) {
    var def = MG_DEFAULTS[id];
    var s   = _mgSettings[id] || {};
    var val = function(key) { return s[key] ?? def[key]; };
    var hidden = id === _mgActiveTab ? '' : ' hidden';

    var inner = '';

    /* 공통 헤더: 점검 토글 */
    inner += '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-black text-gray-800 text-base">' + def.icon + ' ' + def.name + '</h3>' +
      '<label class="flex items-center gap-2 cursor-pointer">' +
        '<span class="text-xs font-bold ' + (val('maintenance') ? 'text-red-500' : 'text-gray-400') + '">🔧 점검</span>' +
        '<input type="checkbox" id="mg-' + id + '-maintenance" ' + (val('maintenance') ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:#ef4444">' +
      '</label>' +
    '</div>';

    inner += '<div class="space-y-2">';

    if (id === 'roulette') {
      /* ── 룰렛 전용 ── */
      var rProb = s.probs || { miss: 38, x1: 30, x15: 20, x3: 10, x10: 2 };
      var rWidth = s.widths || { miss: 38, x1: 30, x15: 20, x3: 10, x10: 2 };

      inner += _mgRow('🎮 1일 도전 횟수', '<input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-roulette-playLimit" value="' + val('playLimit') + '">');
      inner += _mgRow('🌰 1일 보상 횟수', '<input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-roulette-rewardLimit" value="' + val('rewardLimit') + '">');
      inner += _mgRow('🌰 참가비 (기본)', '<input class="field text-center" type="number" min="1" max="1000" style="width:80px" id="mg-roulette-entryFee" value="' + val('entryFee') + '">');
      inner += _mgSep();
      inner += '<div class="text-xs font-black text-gray-600 mb-1">🎯 당첨 확률 (합계 100%)</div>';
      var probKeys = [['miss','꽝 (0배)'],['x1','×1 (본전)'],['x15','×1.5 (소당첨)'],['x3','×3 (당첨)'],['x10','×10 (대박)']];
      probKeys.forEach(function(pk) {
        var step = pk[0] === 'x10' ? ' step="0.1"' : '';
        inner += _mgRow(pk[1], '<div class="flex items-center gap-1"><input class="field text-center" type="number" min="0" max="100"' + step + ' style="width:60px" id="mg-roulette-prob-' + pk[0] + '" value="' + rProb[pk[0]] + '"><span class="text-xs text-gray-400">%</span></div>', true);
      });
      inner += _mgSep();
      inner += '<div class="text-xs font-black text-gray-600 mb-1">🎡 룰렛 칸 너비 (보이는 비율, 합계 100)</div>';
      [['miss','꽝'],['x1','×1'],['x15','×1.5'],['x3','×3'],['x10','×10']].forEach(function(wk) {
        inner += _mgRow(wk[1], '<input class="field text-center" type="number" min="1" max="100" style="width:60px" id="mg-roulette-width-' + wk[0] + '" value="' + rWidth[wk[0]] + '">', true);
      });
    } else {
      /* ── 캐치 / 2048 공통 ── */
      inner += '<div class="flex items-center justify-between gap-3">' +
        '<label class="text-xs font-bold text-gray-500 whitespace-nowrap">🎮 1일 도전 횟수</label>' +
        '<div class="flex items-center gap-2">' +
          '<input class="field text-center" type="number" min="0" max="100" style="width:70px" id="mg-' + id + '-playLimit" value="' + val('playLimit') + '"' + (val('unlimitedPlays') ? ' disabled style="width:70px;opacity:0.4"' : '') + '>' +
          '<label class="flex items-center gap-1 cursor-pointer">' +
            '<input type="checkbox" id="mg-' + id + '-unlimitedPlays" ' + (val('unlimitedPlays') ? 'checked' : '') + ' onchange="document.getElementById(\'mg-' + id + '-playLimit\').disabled=this.checked;document.getElementById(\'mg-' + id + '-playLimit\').style.opacity=this.checked?\'0.4\':\'1\'" style="width:16px;height:16px">' +
            '<span class="text-xs font-bold text-gray-400">무제한</span>' +
          '</label>' +
        '</div>' +
      '</div>';

      if (id !== '2048') {
        inner += _mgRow('🌰 1일 보상 횟수', '<input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-' + id + '-rewardLimit" value="' + val('rewardLimit') + '">');
      }
      inner += _mgRow('🌰 참가비', '<input class="field text-center" type="number" min="0" max="1000" style="width:80px" id="mg-' + id + '-entryFee" value="' + val('entryFee') + '">');

      if (id !== '2048') {
        inner += _mgRow('📊 N점당 1도토리', '<input class="field text-center" type="number" min="1" max="1000" style="width:80px" id="mg-' + id + '-rewardRate" value="' + val('rewardRate') + '">');
        inner += _mgRow('🎁 최대 보상', '<input class="field text-center" type="number" min="0" max="1000" style="width:80px" id="mg-' + id + '-maxReward" value="' + val('maxReward') + '">');
      }

      if (id === '2048') {
        inner += _mgSep();
        inner += '<div class="text-xs font-black text-gray-600 mb-1">🌰 도토리 드롭</div>';
        inner += _mgRow('합칠 때 드롭 확률(%)', '<input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-2048-dropChance" value="' + (val('dropChance') ?? 20) + '">', true);
        inner += _mgRow('최소 드롭 개수', '<input class="field text-center" type="number" min="1" max="100" style="width:80px" id="mg-2048-dropMin" value="' + (val('dropMin') ?? 1) + '">', true);
        inner += _mgRow('최대 드롭 개수', '<input class="field text-center" type="number" min="1" max="100" style="width:80px" id="mg-2048-dropMax" value="' + (val('dropMax') ?? 1) + '">', true);
        inner += _mgSep();
        inner += '<div class="text-xs font-black text-gray-600 mb-1">🎫 아이템 드롭 (뽑기 티켓)</div>';
        inner += _mgRow('합칠 때 드롭 확률(%)', '<input class="field text-center" type="number" min="0" max="100" step="0.1" style="width:80px" id="mg-2048-itemDropChance" value="' + (val('itemDropChance') ?? 0) + '">', true);
        inner += _mgRow('드롭 개수', '<input class="field text-center" type="number" min="1" max="10" style="width:80px" id="mg-2048-itemDropAmount" value="' + (val('itemDropAmount') ?? 1) + '">', true);
        inner += '<p class="text-xs text-gray-400 mt-1">0%로 두면 아이템 꺼짐. 도토리와 독립 확률.</p>';
      }

      if (def.duration > 0 || id === 'catch' || id === '2048') {
        inner += _mgRow('⏱ 게임 시간(초)', '<input class="field text-center" type="number" min="10" max="300" style="width:80px" id="mg-' + id + '-duration" value="' + val('duration') + '">');
      }
      if (id === 'catch') {
        inner += _mgRow('🐌 시작 속도', '<input class="field text-center" type="number" min="0.5" max="10" step="0.1" style="width:80px" id="mg-' + id + '-baseSpeed" value="' + (val('baseSpeed') ?? 2.2) + '">');
        inner += _mgRow('🚀 최대 속도', '<input class="field text-center" type="number" min="1" max="20" step="0.1" style="width:80px" id="mg-' + id + '-maxSpeed" value="' + (val('maxSpeed') ?? 5.5) + '">');
      }
      if (id === '2048') {
        inner += _mgSep();
        inner += '<div class="text-xs font-black text-gray-600 mb-1">💀 폭탄 설정</div>';
        inner += _mgRow('폭탄 시작 턴', '<input class="field text-center" type="number" min="1" max="20" style="width:80px" id="mg-2048-bombStartTurn" value="' + (val('bombStartTurn') ?? 3) + '">', true);
        inner += _mgRow('최대 등장 확률(%)', '<input class="field text-center" type="number" min="5" max="100" style="width:80px" id="mg-2048-bombMaxChance" value="' + (val('bombMaxChance') ?? 60) + '">', true);
        inner += _mgSep();
        inner += '<div class="text-xs font-black text-gray-600 mb-1">🔥 보너스 설정</div>';
        inner += _mgRow('💥 상쇄 보너스(초)', '<input class="field text-center" type="number" min="0" max="10" step="0.1" style="width:80px" id="mg-2048-defuseBonus" value="' + (val('defuseBonus') ?? 1.2) + '">', true);
        inner += _mgRow('🔥 콤보당 보너스(초)', '<input class="field text-center" type="number" min="0" max="5" step="0.1" style="width:80px" id="mg-2048-comboBonus" value="' + (val('comboBonus') ?? 0.5) + '">', true);
      }
    }

    inner += '</div>'; // space-y-2
    inner += '<button class="btn btn-primary w-full py-2 mt-3 text-sm" onclick="saveMinigameSetting(\'' + id + '\')">💾 저장</button>';

    return '<div id="mgPane-' + id + '" class="' + hidden + '">' + inner + '</div>';
  }).join('');

  list.innerHTML = tabBar + panes;
  _renderMinigameStats();
}

/* ── 헬퍼 ── */
function _mgRow(label, input, sub) {
  var cls = sub ? 'text-gray-400' : 'text-gray-500';
  return '<div class="flex items-center justify-between gap-3">' +
    '<label class="text-xs font-bold ' + cls + ' whitespace-nowrap">' + label + '</label>' +
    input +
  '</div>';
}
function _mgSep() {
  return '<hr style="border-color:rgba(0,0,0,.08);margin:8px 0">';
}

async function saveMinigameSetting(gameId) {
  const intKeys = ['playLimit', 'rewardLimit', 'entryFee', 'rewardRate', 'maxReward', 'duration', 'bombStartTurn', 'bombMaxChance', 'dropChance', 'dropMin', 'dropMax', 'itemDropAmount'];
  const floatKeys = ['baseSpeed', 'maxSpeed', 'defuseBonus', 'comboBonus', 'itemDropChance'];
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
  if (period === 'prevweek') {
    const prevMon = _getPrevWeekMonday();
    const range = _getWeekRange(prevMon);
    return range;
  }
  return { from: '2020-01-01T00:00:00+09:00', to: '2099-12-31T23:59:59+09:00' };
}

function _medalEmoji(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `<span class="rank-num">${rank}</span>`;
}

function _periodLabel(p) { return p === 'daily' ? '오늘' : p === 'weekly' ? '이번 주' : p === 'prevweek' ? '지난주' : '전체'; }

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

  // 지난주 탭: 보상 활성화 여부 + 기존 수령 상태 조회
  let rewardEnabled = false;
  let claimedRanks = {}; // { rank: true } — 이미 수령한 순위
  const isPrevWeek = _rankPeriod === 'prevweek';
  const prevMonday = isPrevWeek ? _getPrevWeekMonday() : null;

  if (isPrevWeek) {
    const { data: enabledRow } = await sb.from('app_settings').select('value')
      .eq('key', 'weekly_reward_enabled').maybeSingle();
    rewardEnabled = enabledRow?.value === true || enabledRow?.value === 'true';

    if (rewardEnabled) {
      const { data: claimed } = await sb.from('weekly_ranking_rewards')
        .select('rank, user_id, paid')
        .eq('week_id', prevMonday).eq('game_id', gameId);
      (claimed || []).forEach(c => { claimedRanks[c.rank] = c; });
    }
  }

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
      // 지난주 1~3위 보상 버튼
      let rewardBtnHtml = '';
      if (isPrevWeek && rewardEnabled && rank <= 3 && isMe) {
        const existing = claimedRanks[rank];
        if (existing?.paid) {
          rewardBtnHtml = '<span class="wr-claimed-badge">수령완료</span>';
        } else {
          rewardBtnHtml = `<button class="wr-claim-btn" onclick="claimWeeklyReward('${gameId}','${prevMonday}',${rank},${r.score})">🎁 보상받기</button>`;
        }
      }
      return `<div class="rank-row ${isMe ? 'rank-row-me' : ''} ${rank <= 3 ? 'rank-row-top' : ''}">
        <div class="rank-medal">${_medalEmoji(rank)}</div>
        <div class="rank-name">${r.name}${isMe ? ' <span class="rank-me-badge">나</span>' : ''}</div>
        <div class="rank-score">${r.score.toLocaleString()}점</div>
        ${rewardBtnHtml}
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

    if (!data?.length) {
      list.innerHTML = `<p class="text-sm text-gray-400 text-center py-6">📊 ${_periodLabel(_adminRankPeriod)} 기록이 없습니다</p>`;
      if (_mgLogOpen) renderMinigameLog();
      renderWeeklyRewardSettings();
      renderWeeklyRewardHistory();
      return;
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
  // 로그는 접혀있을 때 렌더 안 함
  if (_mgLogOpen) renderMinigameLog();
  // 주간 보상 설정 + 내역 렌더
  renderWeeklyRewardSettings();
  renderWeeklyRewardHistory();
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

// ──────────────────────────────────────────────
//  미니게임 이용 로그 접기/펼치기
// ──────────────────────────────────────────────
let _mgLogOpen = false;
function toggleMgLogSection() {
  _mgLogOpen = !_mgLogOpen;
  const body = document.getElementById('mgLogCollapsible');
  const icon = document.getElementById('mgLogToggleIcon');
  if (_mgLogOpen) {
    body.classList.remove('hidden');
    icon.textContent = '▲';
    renderMinigameLog();
  } else {
    body.classList.add('hidden');
    icon.textContent = '▼';
  }
}

// ──────────────────────────────────────────────
//  주간 랭킹 보상 시스템 (선물상자 방식)
// ──────────────────────────────────────────────

// 설정 구조: { [gameId]: { [rank]: { acorns, items: [{ name, icon, qty }, ...] } } }
const WEEKLY_REWARD_DEFAULTS = {
  catch:  { 1: { acorns: 50, items: [] }, 2: { acorns: 30, items: [] }, 3: { acorns: 10, items: [] } },
  '2048': { 1: { acorns: 50, items: [] }, 2: { acorns: 30, items: [] }, 3: { acorns: 10, items: [] } }
};

let _weeklyRewardSettings = null;
let _wrItemPickerTarget = null;  // 현재 아이템 선택 중인 슬롯 식별자

// ── 이전 주 월요일 날짜 계산 (KST 기준) ──
function _getPrevWeekMonday() {
  const kst = _kstNow();
  const day = kst.getUTCDay() || 7;
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - (day - 1) - 7);
  return monday.toISOString().slice(0, 10);
}

// ── 현재 주 월요일 날짜 계산 (KST 기준) ──
function _getCurrentWeekMonday() {
  const kst = _kstNow();
  const day = kst.getUTCDay() || 7;
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

// ── 특정 주의 월~일 범위 반환 ──
function _getWeekRange(mondayStr) {
  const sunday = new Date(mondayStr + 'T00:00:00+09:00');
  sunday.setDate(sunday.getDate() + 6);
  const sunStr = sunday.toISOString().slice(0, 10);
  return {
    from: mondayStr + 'T00:00:00+09:00',
    to:   sunStr + 'T23:59:59+09:00'
  };
}

// ── 보상 설정 로드 ──
async function loadWeeklyRewardSettings() {
  try {
    const { data } = await sb.from('app_settings').select('value')
      .eq('key', 'weekly_reward_settings').maybeSingle();
    const raw = _parseValue(data?.value);
    // 이전 형식(단순 숫자) 호환: { catch: { 1: 50 } } → { catch: { 1: { acorns: 50, items: [] } } }
    if (raw) {
      for (const gid of Object.keys(raw)) {
        for (const rank of Object.keys(raw[gid])) {
          if (typeof raw[gid][rank] === 'number') {
            raw[gid][rank] = { acorns: raw[gid][rank], items: [] };
          }
        }
      }
    }
    _weeklyRewardSettings = raw || WEEKLY_REWARD_DEFAULTS;
  } catch(e) {
    console.warn('[weeklyReward] 설정 로드 실패', e);
    _weeklyRewardSettings = WEEKLY_REWARD_DEFAULTS;
  }
  return _weeklyRewardSettings;
}

// ── 보상 설정 저장 (관리자) ──
async function saveWeeklyRewardSettings() {
  const settings = {};
  for (const gameId of Object.keys(MG_DEFAULTS)) {
    if (gameId === 'roulette') continue;
    settings[gameId] = {};
    for (let rank = 1; rank <= 3; rank++) {
      const acornsInput = document.getElementById(`wr_${gameId}_${rank}_acorns`);
      const acorns = parseInt(acornsInput?.value) || 0;
      const items = [];
      for (let s = 0; s < 3; s++) {
        const nameEl = document.getElementById(`wr_${gameId}_${rank}_item${s}_name`);
        const iconEl = document.getElementById(`wr_${gameId}_${rank}_item${s}_icon`);
        const qtyEl  = document.getElementById(`wr_${gameId}_${rank}_item${s}_qty`);
        const rTypeEl = document.getElementById(`wr_${gameId}_${rank}_item${s}_rtype`);
        if (nameEl?.value) {
          items.push({
            name: nameEl.value,
            icon: iconEl?.value || '🎁',
            qty: parseInt(qtyEl?.value) || 1,
            reward_type: rTypeEl?.value || ''
          });
        }
      }
      settings[gameId][rank] = { acorns, items };
    }
  }
  try {
    await sb.from('app_settings').upsert({ key: 'weekly_reward_settings', value: settings });
    _weeklyRewardSettings = settings;
    toast('✅', '주간 보상 설정이 저장되었습니다');
  } catch(e) {
    console.warn('[weeklyReward] 설정 저장 실패', e);
    toast('❌', '저장 실패');
  }
}

// ── 아이템 선택 모달 (관리자 보상 설정용) ──
async function openWrItemPicker(gameId, rank, slotIdx) {
  _wrItemPickerTarget = { gameId, rank, slotIdx };
  // products 테이블에서 활성 아이템 로드
  const { data: products } = await sb.from('products').select('id, name, icon, reward_type, item_type')
    .eq('active', true).order('sort_order');

  let html = `<div style="max-height:60vh;overflow-y:auto">
    <h3 class="text-base font-black text-gray-800 mb-3">아이템 선택</h3>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">`;

  // 직접 입력 옵션
  html += `<div class="wr-item-pick-card" onclick="_wrPickCustomItem()" style="border:1.5px dashed rgba(156,163,175,0.4)">
    <div style="font-size:1.5rem">✏️</div>
    <div class="text-xs font-bold text-gray-500">직접 입력</div>
  </div>`;

  // AUTO_ACORN은 뽑기 즉시 도토리 합산 전용 — 선물상자 구성품으로 사용 불가
  const filtered = (products || []).filter(p => p.reward_type !== 'AUTO_ACORN');
  for (const p of filtered) {
    const escaped = (p.name || '').replace(/'/g, "\\'");
    const rtype = (p.reward_type || '').replace(/'/g, "\\'");
    html += `<div class="wr-item-pick-card" onclick="_wrPickItem('${escaped}','${p.icon || '🎁'}','${rtype}')">
      <div style="font-size:1.5rem">${p.icon || '🎁'}</div>
      <div class="text-xs font-bold text-gray-600" style="line-height:1.2;word-break:keep-all">${p.name}</div>
    </div>`;
  }

  html += `</div>
    <button class="btn btn-gray w-full py-2 text-sm mt-3" onclick="closeModal()">취소</button>
  </div>`;
  showModal(html);
}

function _wrPickItem(name, icon, rewardType) {
  if (!_wrItemPickerTarget) return;
  const { gameId, rank, slotIdx } = _wrItemPickerTarget;
  const nameEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_name`);
  const iconEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_icon`);
  const rTypeEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_rtype`);
  const qtyEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_qty`);
  const labelEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_label`);
  if (nameEl) nameEl.value = name;
  if (iconEl) iconEl.value = icon;
  if (rTypeEl) rTypeEl.value = rewardType;
  if (labelEl) { labelEl.textContent = icon + ' ' + name; labelEl.style.color = ''; }
  if (qtyEl) { qtyEl.disabled = false; if (!qtyEl.value || qtyEl.value === '0') qtyEl.value = '1'; }
  closeModal();
}

function _wrPickCustomItem() {
  if (!_wrItemPickerTarget) return;
  const { gameId, rank, slotIdx } = _wrItemPickerTarget;
  showModal(`<div>
    <h3 class="text-base font-black text-gray-800 mb-3">직접 입력</h3>
    <label class="text-xs text-gray-500 block mb-1">아이콘 (이모지)</label>
    <input type="text" id="_wrCustomIcon" class="field text-sm mb-2" value="🎁" maxlength="4">
    <label class="text-xs text-gray-500 block mb-1">아이템 이름</label>
    <input type="text" id="_wrCustomName" class="field text-sm mb-3" placeholder="예: 특별 칭호">
    <div class="flex gap-2">
      <button class="btn btn-gray flex-1 py-2 text-sm" onclick="closeModal()">취소</button>
      <button class="btn btn-primary flex-1 py-2 text-sm" onclick="_wrApplyCustomItem('${gameId}',${rank},${slotIdx})">확인</button>
    </div>
  </div>`);
}

function _wrApplyCustomItem(gameId, rank, slotIdx) {
  const icon = document.getElementById('_wrCustomIcon')?.value || '🎁';
  const name = document.getElementById('_wrCustomName')?.value || '';
  if (!name) { toast('⚠️', '아이템 이름을 입력하세요'); return; }
  _wrPickItem(name, icon, '');
}

function _wrClearItemSlot(gameId, rank, slotIdx) {
  const nameEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_name`);
  const iconEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_icon`);
  const rTypeEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_rtype`);
  const qtyEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_qty`);
  const labelEl = document.getElementById(`wr_${gameId}_${rank}_item${slotIdx}_label`);
  if (nameEl) nameEl.value = '';
  if (iconEl) iconEl.value = '';
  if (rTypeEl) rTypeEl.value = '';
  if (qtyEl) { qtyEl.value = '1'; qtyEl.disabled = true; }
  if (labelEl) { labelEl.textContent = '비어 있음'; labelEl.style.color = '#9ca3af'; }
}

// ── 주간 보상 보상받기 버튼 토글 (관리자) ──
let _weeklyRewardEnabled = false;

async function loadWeeklyRewardToggle() {
  const { data } = await sb.from('app_settings').select('value')
    .eq('key', 'weekly_reward_enabled').maybeSingle();
  _weeklyRewardEnabled = data?.value === true || data?.value === 'true';
  _updateWrToggleUI();
}

function _updateWrToggleUI() {
  const btn = document.getElementById('wrToggleBtn');
  const label = document.getElementById('wrToggleLabel');
  if (!btn || !label) return;
  if (_weeklyRewardEnabled) {
    btn.classList.add('active');
    label.textContent = 'ON';
  } else {
    btn.classList.remove('active');
    label.textContent = 'OFF';
  }
}

async function toggleWeeklyRewardEnabled() {
  const newVal = !_weeklyRewardEnabled;
  try {
    await sb.from('app_settings').upsert({ key: 'weekly_reward_enabled', value: newVal });
    _weeklyRewardEnabled = newVal;
    _updateWrToggleUI();
    toast('✅', newVal ? '보상받기 버튼 활성화' : '보상받기 버튼 비활성화');
  } catch(e) {
    console.warn('[weeklyReward] 토글 실패', e);
    toast('❌', '변경 실패');
  }
}

// ── 관리자 보상 설정 UI 렌더 ──
async function renderWeeklyRewardSettings() {
  console.log('[weeklyReward] renderWeeklyRewardSettings 호출');
  const area = document.getElementById('weeklyRewardSettings');
  if (!area) { console.warn('[weeklyReward] #weeklyRewardSettings 엘리먼트 없음'); return; }
  if (!_weeklyRewardSettings) await loadWeeklyRewardSettings();
  await loadWeeklyRewardToggle();
  const s = _weeklyRewardSettings;

  const gameIds = Object.keys(MG_DEFAULTS).filter(g => g !== 'roulette');
  const medals = ['🥇', '🥈', '🥉'];

  let html = '';

  for (const gameId of gameIds) {
    const gIcon = MG_DEFAULTS[gameId]?.icon || '🎮';
    const gName = MG_DEFAULTS[gameId]?.name || gameId;
    // 요약: 각 순위의 도토리 수
    const cfg1 = s[gameId]?.[1] || { acorns: 0 };
    const cfg2 = s[gameId]?.[2] || { acorns: 0 };
    const cfg3 = s[gameId]?.[3] || { acorns: 0 };
    const summary = `🌰 ${cfg1.acorns||0} / ${cfg2.acorns||0} / ${cfg3.acorns||0}`;

    html += `<div class="wr-game-section mb-3">
      <div class="wr-game-header" onclick="_wrToggleGame('${gameId}')">
        <span class="wr-game-title">${gIcon} ${gName}</span>
        <span class="wr-game-summary">${summary}</span>
        <span class="wr-game-chevron" id="wrChevron_${gameId}">▼</span>
      </div>
      <div class="wr-game-body hidden" id="wrBody_${gameId}">`;

    for (let rank = 1; rank <= 3; rank++) {
      const cfg = s[gameId]?.[rank] || { acorns: 0, items: [] };
      html += `<div class="wr-box-card mb-3">
        <div class="wr-box-header">${medals[rank - 1]} ${rank}위 선물상자</div>
        <div class="wr-box-body">
          <div class="wr-box-row">
            <span class="wr-box-row-label">🌰 도토리</span>
            <input type="number" id="wr_${gameId}_${rank}_acorns" class="field text-sm text-center" value="${cfg.acorns || 0}" min="0" style="width:72px">
          </div>`;

      for (let si = 0; si < 3; si++) {
        const item = cfg.items?.[si] || {};
        const hasItem = !!item.name;
        const label = hasItem ? (item.icon || '🎁') + ' ' + item.name : '비어 있음';
        html += `<div class="wr-box-row">
            <span class="wr-box-row-label" id="wr_${gameId}_${rank}_item${si}_label" style="cursor:pointer;${hasItem ? '' : 'color:#9ca3af'}" onclick="openWrItemPicker('${gameId}',${rank},${si})">${label}</span>
            <input type="hidden" id="wr_${gameId}_${rank}_item${si}_name" value="${(item.name || '').replace(/"/g, '&quot;')}">
            <input type="hidden" id="wr_${gameId}_${rank}_item${si}_icon" value="${(item.icon || '').replace(/"/g, '&quot;')}">
            <input type="hidden" id="wr_${gameId}_${rank}_item${si}_rtype" value="${(item.reward_type || '').replace(/"/g, '&quot;')}">
            <div class="flex items-center gap-1">
              <input type="number" id="wr_${gameId}_${rank}_item${si}_qty" class="field text-sm text-center" value="${item.qty || 1}" min="1" style="width:64px" ${hasItem ? '' : 'disabled'}>
              <button class="text-xs text-gray-400 hover:text-red-400" onclick="_wrClearItemSlot('${gameId}',${rank},${si})" title="비우기">✕</button>
            </div>
          </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div></div>`; // close wr-game-body, wr-game-section
  }

  area.innerHTML = html;
}

function _wrToggleGame(gameId) {
  const body = document.getElementById('wrBody_' + gameId);
  const chevron = document.getElementById('wrChevron_' + gameId);
  if (!body) return;
  const isOpen = !body.classList.contains('hidden');
  body.classList.toggle('hidden');
  if (chevron) chevron.textContent = isOpen ? '▼' : '▲';
}

// ── 주간 보상 지급 내역 렌더 (관리자) ──
async function renderWeeklyRewardHistory() {
  console.log('[weeklyReward] renderWeeklyRewardHistory 호출');
  const area = document.getElementById('weeklyRewardHistory');
  if (!area) { console.warn('[weeklyReward] #weeklyRewardHistory 엘리먼트 없음'); return; }

  try {
    const { data } = await sb.from('weekly_ranking_rewards')
      .select('week_id, game_id, rank, user_id, score, reward_amount, paid, paid_at, created_at')
      .order('week_id', { ascending: false })
      .order('game_id').order('rank')
      .limit(30);

    if (!data?.length) {
      area.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">지급 내역이 없습니다</p>';
      return;
    }

    const uids = [...new Set(data.map(r => r.user_id))];
    const { data: users } = await sb.from('users').select('id, display_name').in('id', uids);
    const nameMap = {};
    (users || []).forEach(u => nameMap[u.id] = u.display_name);

    const medals = ['', '🥇', '🥈', '🥉'];
    let currentWeek = '';
    let html = '';
    for (const r of data) {
      const weekLabel = r.week_id;
      if (weekLabel !== currentWeek) {
        if (currentWeek) html += '</div>';
        currentWeek = weekLabel;
        html += `<div class="mb-3"><p class="text-xs font-bold text-gray-500 mb-2">📅 ${weekLabel} 주차</p>`;
      }
      const gameIcon = MG_DEFAULTS[r.game_id]?.icon || '🎮';
      const paidBadge = r.paid
        ? '<span class="text-xs text-green-600 font-bold">지급완료</span>'
        : '<span class="text-xs text-amber-500 font-bold">미지급</span>';
      html += `<div class="flex items-center gap-2 text-sm py-1">
        <span>${medals[r.rank]}</span>
        <span>${gameIcon}</span>
        <span class="flex-1 font-semibold text-gray-700">${nameMap[r.user_id] || '알 수 없음'}</span>
        <span class="text-gray-500">${r.score.toLocaleString()}점</span>
        ${paidBadge}
      </div>`;
    }
    if (currentWeek) html += '</div>';
    area.innerHTML = html;
  } catch(e) {
    console.warn('[weeklyReward] 내역 조회 실패', e);
    area.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">조회 실패</p>';
  }
}

// ── 유저 직접 보상 수령 (지난주 랭킹에서 클릭) ──
async function claimWeeklyReward(gameId, weekId, rank, score) {
  if (!myProfile) return;
  if (!_weeklyRewardSettings) await loadWeeklyRewardSettings();

  const cfg = _weeklyRewardSettings[gameId]?.[rank] || { acorns: 0, items: [] };
  const gameName = MG_DEFAULTS[gameId]?.name || gameId;
  const gameIcon = MG_DEFAULTS[gameId]?.icon || '🎮';
  const medals = ['', '🥇', '🥈', '🥉'];

  // 보상 내용이 전부 비어있으면
  if ((cfg.acorns || 0) <= 0 && (!cfg.items || cfg.items.length === 0)) {
    toast('ℹ️', '이 순위에 설정된 보상이 없습니다');
    return;
  }

  try {
    // 1. 스냅샷 레코드 생성 (이미 있으면 건드리지 않음)
    const { error: snapErr } = await sb.from('weekly_ranking_rewards').upsert({
      week_id: weekId,
      game_id: gameId,
      rank: rank,
      user_id: myProfile.id,
      score: score,
      reward_amount: cfg.acorns || 0,
      paid: false
    }, { onConflict: 'week_id,game_id,rank', ignoreDuplicates: true });
    if (snapErr) throw snapErr;

    // 2. 이미 수령했는지 다시 확인 (다른 탭에서 수령했을 수 있음)
    const { data: check } = await sb.from('weekly_ranking_rewards')
      .select('id, paid')
      .eq('week_id', weekId).eq('game_id', gameId).eq('rank', rank)
      .single();

    if (check?.paid) {
      toast('ℹ️', '이미 수령한 보상입니다');
      renderUserRanking();
      return;
    }

    // 3. paid=true 선점 (race condition 방지)
    const { data: claimed, error: claimErr } = await sb.from('weekly_ranking_rewards')
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq('id', check.id).eq('paid', false)
      .select('id');

    if (claimErr || !claimed?.length) {
      toast('ℹ️', '이미 수령한 보상입니다');
      renderUserRanking();
      return;
    }

    // 4. 인벤토리에 선물상자 삽입
    const boxSnapshot = {
      name: `${gameName} 주간 ${rank}위 보상`,
      icon: '🎁',
      reward_type: 'REWARD_BOX',
      description: `${medals[rank]} ${weekId} 주차 ${gameName} ${rank}위 (${score.toLocaleString()}점)`,
      box_contents: {
        acorns: cfg.acorns || 0,
        items: (cfg.items || []).filter(it => it.name)
      },
      _meta: {
        week_id: weekId,
        game_id: gameId,
        game_icon: gameIcon,
        rank: rank,
        score: score
      }
    };

    const { error: invErr } = await sb.from('inventory').insert({
      user_id: myProfile.id,
      product_id: null,
      product_snapshot: boxSnapshot,
      quantity: 1,
      status: 'held',
      from_gacha: false
    });

    if (invErr) {
      // 인벤토리 삽입 실패 → paid 롤백
      await sb.from('weekly_ranking_rewards')
        .update({ paid: false, paid_at: null })
        .eq('id', check.id);
      throw invErr;
    }

    toast('🎁', `${gameName} 주간 ${rank}위 보상이 인벤토리에 도착했습니다!`);
    console.log(`[weeklyReward] 수동 수령: ${gameId} ${rank}위 (${weekId})`);
    renderUserRanking();
  } catch(e) {
    console.warn('[weeklyReward] 보상 수령 실패', e);
    toast('❌', '보상 수령에 실패했습니다');
  }
}

