// ──────────────────────────────────────────────
//  미니게임 시스템 (설정 DB 연동)
// ──────────────────────────────────────────────

// 기본 설정값 (DB에 없을 때 사용)
const MG_DEFAULTS = {
  catch: {
    name: '도토리 캐치',
    icon: '🧺',
    dailyLimit: 5,
    entryFee: 0,
    rewardRate: 10,
    maxReward: 20,
    duration: 30
  },
  '2048': {
    name: '2048 도토리',
    icon: '🧩',
    dailyLimit: 5,
    entryFee: 0,
    rewardRate: 50,
    maxReward: 30,
    duration: 0
  },
  roulette: {
    name: '행운의 룰렛',
    icon: '🎡',
    dailyLimit: 10,
    entryFee: 5,
    rewardRate: 1,
    maxReward: 50,
    duration: 0
  }
};

let _mgSettings = {};
let _mgTodayPlays = {};

// ── 설정 로드 (app_settings 테이블) ──
async function loadMinigameSettings() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'minigame_settings').single();
    _mgSettings = data?.value || {};
  } catch(e) { _mgSettings = {}; }
  return _mgSettings;
}

function getMgSetting(gameId, key) {
  return _mgSettings?.[gameId]?.[key] ?? MG_DEFAULTS[gameId]?.[key] ?? 0;
}

// ── 오늘 플레이 횟수 조회 ──
async function loadTodayPlays() {
  if (!myProfile) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await sb
      .from('minigame_plays')
      .select('game_id')
      .eq('user_id', myProfile.id)
      .gte('played_at', today + 'T00:00:00')
      .lte('played_at', today + 'T23:59:59');
    _mgTodayPlays = {};
    (data || []).forEach(r => {
      _mgTodayPlays[r.game_id] = (_mgTodayPlays[r.game_id] || 0) + 1;
    });
  } catch(e) { console.warn('[minigame] 플레이 횟수 조회 실패:', e); }
}

// ── 플레이 기록 저장 ──
async function recordPlay(gameId, score, reward) {
  if (!myProfile) return;
  try {
    await sb.from('minigame_plays').insert({
      user_id: myProfile.id,
      game_id: gameId,
      score: score,
      reward: reward,
      played_at: new Date().toISOString()
    });
    _mgTodayPlays[gameId] = (_mgTodayPlays[gameId] || 0) + 1;
  } catch(e) { console.warn('[minigame] 플레이 기록 실패:', e); }
}

// 게임 목록
const MINIGAMES = [
  { id: 'catch', name: '🌰 도토리 캐치', desc: '하늘에서 떨어지는 도토리를 바구니로 받아요!', icon: '🧺', color: 'linear-gradient(135deg, #87CEEB, #90EE90)', ready: true },
  { id: '2048', name: '🧩 2048 도토리', desc: '같은 숫자를 합쳐서 큰 수를 만들어요!', icon: '🧩', color: 'linear-gradient(135deg, #fef3c7, #fed7aa)', ready: false },
  { id: 'roulette', name: '🎡 행운의 룰렛', desc: '도토리를 걸고 룰렛을 돌려보세요!', icon: '🎡', color: 'linear-gradient(135deg, #fce4ff, #dbeafe)', ready: false }
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
    const limit = getMgSetting(g.id, 'dailyLimit');
    const played = _mgTodayPlays[g.id] || 0;
    const remaining = Math.max(0, limit - played);
    const fee = getMgSetting(g.id, 'entryFee');
    const maxReward = getMgSetting(g.id, 'maxReward');
    const duration = getMgSetting(g.id, 'duration');
    const exhausted = remaining <= 0 && g.ready;

    return `
    <div class="mg-card clay-card ${g.ready && !exhausted ? 'card-hover' : ''}" 
         ${g.ready && !exhausted ? `onclick="startMinigame('${g.id}')"` : ''}
         style="cursor:${g.ready && !exhausted ? 'pointer' : 'default'}">
      <div class="mg-card-preview" style="background:${g.color}">
        <span class="mg-card-icon">${g.icon}</span>
        ${!g.ready ? '<div class="mg-coming-soon">COMING SOON</div>' : ''}
        ${exhausted ? '<div class="mg-coming-soon">오늘 횟수 소진</div>' : ''}
      </div>
      <div class="p-4">
        <h3 class="font-black text-gray-800 text-base mb-1">${g.name}</h3>
        <p class="text-xs text-gray-400 font-semibold mb-3">${g.desc}</p>
        <div class="flex gap-1 flex-wrap">
          ${duration > 0 ? `<span class="mg-tag">⏱ ${duration}초</span>` : ''}
          ${fee > 0 ? `<span class="mg-tag">🌰 ${fee} 참가비</span>` : '<span class="mg-tag">무료</span>'}
          <span class="mg-tag">🎁 최대 ${maxReward}</span>
          ${g.ready ? `<span class="mg-tag ${exhausted ? 'mg-tag-danger' : ''}">🎮 ${remaining}/${limit}회</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

async function startMinigame(id) {
  await loadMinigameSettings();
  await loadTodayPlays();

  const limit = getMgSetting(id, 'dailyLimit');
  const played = _mgTodayPlays[id] || 0;
  if (played >= limit) {
    toast('⚠️', `오늘 플레이 횟수를 모두 사용했어요! (${limit}/${limit}회)`);
    renderMinigameHub();
    return;
  }

  const fee = getMgSetting(id, 'entryFee');
  if (fee > 0) {
    if ((myProfile?.acorns || 0) < fee) {
      toast('❌', `참가비가 부족해요! (필요: 🌰${fee}, 보유: 🌰${myProfile?.acorns || 0})`);
      return;
    }
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">🎮</div>
      <h2 class="text-lg font-black text-gray-800 mb-2">게임 시작</h2>
      <p class="text-sm text-gray-500 mb-1">참가비 <span class="font-black text-amber-600">🌰 ${fee}</span>이 차감됩니다.</p>
      <p class="text-xs text-gray-400 mb-4">남은 횟수: ${limit - played}/${limit}회</p>
      <div class="flex gap-2">
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
        p_user_id: myProfile.id,
        p_amount: -fee,
        p_reason: `미니게임 [${MG_DEFAULTS[id]?.name || id}] 참가비 -${fee}🌰`
      });
      if (!res.data?.success) { toast('❌', '참가비 차감 실패!'); return; }
      myProfile.acorns = res.data.balance;
      updateAcornDisplay();
    } catch(e) { toast('❌', '참가비 차감 중 오류'); return; }
  }
  if (id === 'catch') startCatchGame();
}

function exitMinigame() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.remove('hidden');
  play.classList.add('hidden');
  play.innerHTML = '';
  renderMinigameHub();
}


// ══════════════════════════════════════════════
//  도토리 캐치 게임
// ══════════════════════════════════════════════

const CATCH_CONFIG = {
  spawnInterval: 600, minSpawnInterval: 280,
  basketWidth: 64, itemSize: 36,
  baseSpeed: 2.2, maxSpeed: 5.5,
  items: [
    { emoji: '🌰', points: 1,  weight: 50, type: 'acorn' },
    { emoji: '🌰', points: 2,  weight: 20, type: 'acorn2' },
    { emoji: '✨', points: 5,  weight: 10, type: 'golden' },
    { emoji: '🍄', points: 10, weight: 4,  type: 'mushroom' },
    { emoji: '💣', points: -8, weight: 12, type: 'bomb' },
    { emoji: '🌧️', points: -3, weight: 4,  type: 'rain' },
  ]
};

let _catch = null;

function startCatchGame() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.add('hidden');
  play.classList.remove('hidden');

  const gameDuration = getMgSetting('catch', 'duration');

  play.innerHTML = `
    <div class="catch-container" id="catchContainer">
      <div class="catch-hud">
        <div class="catch-hud-item">
          <span class="catch-hud-label">점수</span>
          <span class="catch-hud-value" id="catchScore">0</span>
        </div>
        <div class="catch-hud-item catch-hud-timer">
          <span class="catch-hud-label">남은 시간</span>
          <span class="catch-hud-value" id="catchTimer">${gameDuration}</span>
        </div>
        <button class="catch-exit-btn" onclick="confirmExitCatch()">✕</button>
      </div>
      <div class="catch-field" id="catchField">
        <div class="catch-bg-cloud" style="top:15%;left:8%">☁️</div>
        <div class="catch-bg-cloud" style="top:25%;left:65%;animation-delay:2s;font-size:28px">☁️</div>
        <div class="catch-bg-cloud" style="top:8%;left:40%;animation-delay:4s;font-size:20px">☁️</div>
        <div class="catch-basket" id="catchBasket">🧺</div>
      </div>
      <div class="catch-overlay" id="catchOverlay">
        <div class="catch-overlay-content">
          <div style="font-size:4rem;margin-bottom:12px">🌰</div>
          <h2 class="font-black text-xl mb-2" style="color:#78350f">도토리 캐치</h2>
          <p class="text-sm mb-1" style="color:#92400e;font-weight:700">바구니를 움직여 도토리를 받으세요!</p>
          <div class="catch-legend">
            <span>🌰 +1~2점</span><span>✨ +5점</span><span>🍄 +10점</span><span>💣 -8점</span>
          </div>
          <button class="btn btn-primary px-8 py-3 text-base mt-3" onclick="beginCatchGame()">🎮 시작!</button>
        </div>
      </div>
    </div>`;

  _catch = {
    score: 0, timeLeft: gameDuration, duration: gameDuration,
    basketX: 0.5, basketXCurrent: 0.5,
    items: [], running: false,
    timerId: null, spawnId: null, frameId: null,
    combo: 0, maxCombo: 0, caught: 0, missed: 0,
    fieldEl: null, basketEl: null, fieldW: 0
  };
  _initCatchControls();
}

function _initCatchControls() {
  const field = document.getElementById('catchField');
  if (!field) return;
  _catch.fieldEl = field;
  _catch.basketEl = document.getElementById('catchBasket');
  _catch.fieldW = field.offsetWidth;

  const ro = new ResizeObserver(() => { if (_catch.fieldEl) _catch.fieldW = _catch.fieldEl.offsetWidth; });
  ro.observe(field);

  field.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!_catch?.running) return;
    const t = e.touches[0], r = field.getBoundingClientRect();
    _catch.basketX = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
  }, { passive: false });

  field.addEventListener('touchstart', e => {
    if (!_catch?.running) return;
    const t = e.touches[0], r = field.getBoundingClientRect();
    _catch.basketX = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
  }, { passive: true });

  field.addEventListener('mousemove', e => {
    if (!_catch?.running) return;
    const r = field.getBoundingClientRect();
    _catch.basketX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  });

  document.addEventListener('keydown', _catchKeyHandler);
}

function _catchKeyHandler(e) {
  if (!_catch?.running) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') _catch.basketX = Math.max(0, _catch.basketX - 0.06);
  else if (e.key === 'ArrowRight' || e.key === 'd') _catch.basketX = Math.min(1, _catch.basketX + 0.06);
}

function beginCatchGame() {
  document.getElementById('catchOverlay').classList.add('hidden');
  _catch.running = true;
  _catch.score = 0;
  _catch.timeLeft = _catch.duration;
  _catch.combo = 0; _catch.maxCombo = 0;
  _catch.caught = 0; _catch.missed = 0;
  _catch.basketXCurrent = _catch.basketX;
  playSound('gacha');

  _catch.timerId = setInterval(() => {
    _catch.timeLeft--;
    document.getElementById('catchTimer').textContent = _catch.timeLeft;
    if (_catch.timeLeft <= 5) document.getElementById('catchTimer').parentElement.classList.add('catch-hud-danger');
    if (_catch.timeLeft <= 0) endCatchGame();
  }, 1000);

  _scheduleSpawn();
  _catch.frameId = requestAnimationFrame(_catchGameLoop);
}

function _scheduleSpawn() {
  if (!_catch?.running) return;
  const progress = (_catch.duration - _catch.timeLeft) / _catch.duration;
  const interval = CATCH_CONFIG.spawnInterval - (CATCH_CONFIG.spawnInterval - CATCH_CONFIG.minSpawnInterval) * progress;
  _catch.spawnId = setTimeout(() => { _spawnItem(); _scheduleSpawn(); }, interval);
}

function _spawnItem() {
  if (!_catch?.running) return;
  const field = _catch.fieldEl;
  if (!field) return;

  const totalW = CATCH_CONFIG.items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * totalW, chosen = CATCH_CONFIG.items[0];
  for (const item of CATCH_CONFIG.items) { r -= item.weight; if (r <= 0) { chosen = item; break; } }

  const fw = _catch.fieldW;
  const x = Math.random() * (fw - CATCH_CONFIG.itemSize);
  const progress = (_catch.duration - _catch.timeLeft) / _catch.duration;
  const speed = CATCH_CONFIG.baseSpeed + (CATCH_CONFIG.maxSpeed - CATCH_CONFIG.baseSpeed) * progress;

  const el = document.createElement('div');
  el.className = 'catch-item';
  el.textContent = chosen.emoji;
  el.dataset.x = x; el.dataset.y = -40;
  el.style.left = x + 'px';
  el.style.transform = 'translateY(-40px)';
  el.dataset.points = chosen.points;
  el.dataset.type = chosen.type;
  el.dataset.speed = speed + (Math.random() * 0.8 - 0.4);
  field.appendChild(el);
  _catch.items.push(el);
}

function _catchGameLoop() {
  if (!_catch?.running) return;
  const basket = _catch.basketEl, field = _catch.fieldEl;
  if (!field || !basket) return;

  const fw = _catch.fieldW, fh = field.offsetHeight, bw = CATCH_CONFIG.basketWidth;

  // 바구니 lerp
  _catch.basketXCurrent += (_catch.basketX - _catch.basketXCurrent) * 0.25;
  const bx = _catch.basketXCurrent * (fw - bw);
  basket.style.transform = `translateX(${bx}px)`;

  const basketLeft = bx, basketRight = bx + bw, basketTop = fh - 60;
  const toRemove = [];

  for (const el of _catch.items) {
    const y = parseFloat(el.dataset.y) || 0;
    const speed = parseFloat(el.dataset.speed) || CATCH_CONFIG.baseSpeed;
    const newY = y + speed;
    el.dataset.y = newY;
    el.style.transform = `translateY(${newY}px)`;

    const itemX = parseFloat(el.dataset.x) + CATCH_CONFIG.itemSize / 2;
    const itemBottom = newY + CATCH_CONFIG.itemSize;

    if (itemBottom >= basketTop && itemBottom <= basketTop + 30 && itemX >= basketLeft - 10 && itemX <= basketRight + 10) {
      _catchCollect(parseInt(el.dataset.points), el.dataset.type, el);
      toRemove.push(el); continue;
    }
    if (newY > fh + 10) {
      if (parseInt(el.dataset.points) > 0) { _catch.missed++; _catch.combo = 0; }
      toRemove.push(el);
    }
  }
  for (const el of toRemove) { el.remove(); _catch.items = _catch.items.filter(i => i !== el); }
  _catch.frameId = requestAnimationFrame(_catchGameLoop);
}

function _catchCollect(points, type, el) {
  const field = _catch.fieldEl;
  const x = parseFloat(el.dataset.x), y = parseFloat(el.dataset.y);

  if (points > 0) {
    _catch.combo++;
    if (_catch.combo > _catch.maxCombo) _catch.maxCombo = _catch.combo;
    _catch.caught++;
    let bonus = _catch.combo >= 10 ? 3 : _catch.combo >= 5 ? 1 : 0;
    const total = points + bonus;
    _catch.score += total;
    _showCatchEffect(field, x, y, `+${total}`, type === 'golden' ? '#d97706' : type === 'mushroom' ? '#7c3aed' : '#059669');
    if (_catch.combo >= 5 && _catch.combo % 5 === 0) _showCatchEffect(field, x - 10, y - 20, `🔥 ${_catch.combo}콤보!`, '#dc2626');
    playSound('click');
  } else {
    _catch.score = Math.max(0, _catch.score + points);
    _catch.combo = 0;
    _showCatchEffect(field, x, y, `${points}`, '#dc2626');
    const basket = document.getElementById('catchBasket');
    basket.classList.add('shake-anim');
    setTimeout(() => basket.classList.remove('shake-anim'), 400);
    playSound('reject');
  }
  document.getElementById('catchScore').textContent = _catch.score;
}

function _showCatchEffect(parent, x, y, text, color) {
  const el = document.createElement('div');
  el.className = 'catch-float-text';
  el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.color = color;
  parent.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function endCatchGame() {
  if (!_catch) return;
  _catch.running = false;
  clearInterval(_catch.timerId);
  clearTimeout(_catch.spawnId);
  cancelAnimationFrame(_catch.frameId);
  document.removeEventListener('keydown', _catchKeyHandler);
  _catch.items.forEach(el => el.remove());
  _catch.items = [];

  const score = _catch.score, maxCombo = _catch.maxCombo, caught = _catch.caught;

  const rewardRate = getMgSetting('catch', 'rewardRate');
  const maxReward = getMgSetting('catch', 'maxReward');
  const reward = Math.min(maxReward, Math.max(score > 0 ? 1 : 0, Math.floor(score / rewardRate)));

  playSound('gachaResult');

  document.getElementById('minigame-play').innerHTML = `
    <div class="catch-result-screen">
      <div class="clay-card p-6 text-center" style="max-width:360px;margin:0 auto">
        <div style="font-size:4rem;margin-bottom:8px">🎉</div>
        <h2 class="font-black text-xl mb-4" style="color:#78350f">게임 종료!</h2>
        <div class="catch-result-stats">
          <div class="catch-result-stat">
            <span class="catch-result-num" style="color:#d97706">${score}</span>
            <span class="catch-result-label">최종 점수</span>
          </div>
          <div class="catch-result-stat">
            <span class="catch-result-num" style="color:#dc2626">${maxCombo}</span>
            <span class="catch-result-label">최대 콤보</span>
          </div>
          <div class="catch-result-stat">
            <span class="catch-result-num" style="color:#059669">${caught}</span>
            <span class="catch-result-label">캐치 성공</span>
          </div>
        </div>
        <div class="catch-reward-box">
          <span style="font-size:1.8rem">🌰</span>
          <div>
            <p class="font-black" style="color:#78350f;font-size:18px">+${reward} 도토리 획득!</p>
            <p class="text-xs" style="color:#b45309;font-weight:700">${rewardRate}점당 1도토리 (최대 ${maxReward})</p>
          </div>
        </div>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-gray flex-1 py-3" onclick="exitMinigame()">돌아가기</button>
          <button class="btn btn-primary flex-1 py-3" onclick="startMinigame('catch')">다시하기</button>
        </div>
      </div>
    </div>`;

  recordPlay('catch', score, reward);
  _giveMinigameReward(reward, score, 'catch');
}

async function _giveMinigameReward(reward, score, gameId) {
  if (!myProfile || reward <= 0) return;
  try {
    const res = await sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id, p_amount: reward,
      p_reason: `미니게임 [${MG_DEFAULTS[gameId]?.name || gameId}] 점수 ${score} — 보상 ${reward}🌰`
    });
    if (res.data?.success) { myProfile.acorns = res.data.balance; updateAcornDisplay(); }
  } catch(e) { console.warn('[minigame] 보상 지급 실패:', e); }
}

function confirmExitCatch() {
  if (_catch?.running) {
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">⚠️</div>
      <h2 class="text-lg font-black text-gray-800 mb-2">게임을 종료할까요?</h2>
      <p class="text-sm text-gray-500 mb-4">현재 진행 중인 게임이 끝나고<br>점수에 따른 보상을 받게 됩니다.</p>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">계속하기</button>
        <button class="btn btn-primary flex-1 py-2" onclick="closeModal();endCatchGame()">종료하기</button>
      </div>
    </div>`);
  } else { exitMinigame(); }
}


// ══════════════════════════════════════════════
//  관리자: 미니게임 설정 UI
// ══════════════════════════════════════════════

async function renderMinigameAdmin() {
  await loadMinigameSettings();

  const list = document.getElementById('mgSettingsList');
  const games = ['catch', '2048', 'roulette'];

  list.innerHTML = games.map(id => {
    const def = MG_DEFAULTS[id];
    const s = _mgSettings[id] || {};
    const val = (key) => s[key] ?? def[key];
    return `
    <div class="clay-card p-4">
      <h3 class="font-black text-gray-800 text-base mb-3">${def.icon} ${def.name}</h3>
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🎮 1일 횟수</label>
          <input class="field text-center" type="number" min="0" max="100" style="width:80px" id="mg-${id}-dailyLimit" value="${val('dailyLimit')}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🌰 참가비</label>
          <input class="field text-center" type="number" min="0" max="1000" style="width:80px" id="mg-${id}-entryFee" value="${val('entryFee')}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">📊 N점당 1도토리</label>
          <input class="field text-center" type="number" min="1" max="1000" style="width:80px" id="mg-${id}-rewardRate" value="${val('rewardRate')}">
        </div>
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">🎁 최대 보상</label>
          <input class="field text-center" type="number" min="0" max="1000" style="width:80px" id="mg-${id}-maxReward" value="${val('maxReward')}">
        </div>
        ${def.duration > 0 || id === 'catch' || id === '2048' ? `
        <div class="flex items-center justify-between gap-3">
          <label class="text-xs font-bold text-gray-500 whitespace-nowrap">⏱ 게임 시간(초)</label>
          <input class="field text-center" type="number" min="10" max="300" style="width:80px" id="mg-${id}-duration" value="${val('duration')}">
        </div>` : ''}
      </div>
      <button class="btn btn-primary w-full py-2 mt-3 text-sm" onclick="saveMinigameSetting('${id}')">💾 저장</button>
    </div>`;
  }).join('');

  _renderMinigameStats();
}

async function saveMinigameSetting(gameId) {
  const keys = ['dailyLimit', 'entryFee', 'rewardRate', 'maxReward', 'duration'];
  const updated = {};
  for (const key of keys) {
    const el = document.getElementById(`mg-${gameId}-${key}`);
    if (el) updated[key] = parseInt(el.value) || 0;
  }
  _mgSettings[gameId] = { ...(_mgSettings[gameId] || {}), ...updated };

  try {
    const { data: existing } = await sb.from('app_settings').select('key').eq('key', 'minigame_settings').single();
    if (existing) {
      await sb.from('app_settings').update({ value: _mgSettings, updated_at: new Date().toISOString() }).eq('key', 'minigame_settings');
    } else {
      await sb.from('app_settings').insert({ key: 'minigame_settings', value: _mgSettings, updated_at: new Date().toISOString() });
    }
    toast('✅', `${MG_DEFAULTS[gameId]?.name || gameId} 설정이 저장되었습니다!`);
  } catch(e) { toast('❌', '설정 저장 실패: ' + (e.message || e)); }
}

async function _renderMinigameStats() {
  const area = document.getElementById('mgStatsArea');
  if (!area) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await sb.from('minigame_plays')
      .select('game_id, score, reward, user_id')
      .gte('played_at', today + 'T00:00:00')
      .lte('played_at', today + 'T23:59:59');

    if (!data?.length) { area.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">오늘 플레이 기록이 없습니다</p>'; return; }

    const stats = {}, players = new Set();
    for (const r of data) {
      if (!stats[r.game_id]) stats[r.game_id] = { plays: 0, totalReward: 0, bestScore: 0 };
      stats[r.game_id].plays++;
      stats[r.game_id].totalReward += r.reward || 0;
      stats[r.game_id].bestScore = Math.max(stats[r.game_id].bestScore, r.score || 0);
      players.add(r.user_id);
    }

    area.innerHTML = `
      <div class="text-xs text-gray-400 mb-3 text-left">총 ${players.size}명 · ${data.length}회 플레이</div>
      ${Object.entries(stats).map(([gid, s]) => `
        <div class="clay-card p-3 mb-2 text-left">
          <span class="font-black text-sm text-gray-700">${MG_DEFAULTS[gid]?.icon || '🎮'} ${MG_DEFAULTS[gid]?.name || gid}</span>
          <div class="flex gap-4 mt-1 text-xs text-gray-500 font-semibold">
            <span>🎮 ${s.plays}회</span>
            <span>🏆 최고 ${s.bestScore}점</span>
            <span>🌰 총 ${s.totalReward} 지급</span>
          </div>
        </div>`).join('')}`;
  } catch(e) { area.innerHTML = '<p class="text-sm text-gray-400">통계 조회 실패</p>'; }
}
