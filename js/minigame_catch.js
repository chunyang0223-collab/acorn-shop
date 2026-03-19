// ══════════════════════════════════════════════
//  도토리 캐치 게임 (minigame.js에서 분리)
// ══════════════════════════════════════════════

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

// 관리자 설정에서 속도 읽기
function getCatchSpeed(key) {
  const s = _mgSettings?.catch || {};
  if (key === 'baseSpeed') return s.baseSpeed ?? CATCH_CONFIG.baseSpeed;
  if (key === 'maxSpeed')  return s.maxSpeed  ?? CATCH_CONFIG.maxSpeed;
  return CATCH_CONFIG[key];
}

let _catch = null;

function startCatchGame() {
  const hub  = document.getElementById('minigame-hub');
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
  _catch.fieldEl  = field;
  _catch.basketEl = document.getElementById('catchBasket');
  _catch.fieldW   = field.offsetWidth;
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
  if (e.key === 'ArrowLeft'  || e.key === 'a') _catch.basketX = Math.max(0, _catch.basketX - 0.06);
  else if (e.key === 'ArrowRight' || e.key === 'd') _catch.basketX = Math.min(1, _catch.basketX + 0.06);
}

function beginCatchGame() {
  document.getElementById('catchOverlay').classList.add('hidden');
  _catch.running = true;
  _catch.score   = 0; _catch.timeLeft = _catch.duration;
  _catch.combo   = 0; _catch.maxCombo = 0;
  _catch.caught  = 0; _catch.missed   = 0;
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
  const fw = _catch.fieldW, x = Math.random() * (fw - CATCH_CONFIG.itemSize);
  const progress = (_catch.duration - _catch.timeLeft) / _catch.duration;
  const speed = getCatchSpeed('baseSpeed') + (getCatchSpeed('maxSpeed') - getCatchSpeed('baseSpeed')) * progress;
  const el = document.createElement('div');
  el.className = 'catch-item'; el.textContent = chosen.emoji;
  el.dataset.x = x; el.dataset.y = -40;
  el.style.left = x + 'px'; el.style.transform = 'translateY(-40px)';
  el.dataset.points = chosen.points; el.dataset.type = chosen.type;
  el.dataset.speed  = speed + (Math.random() * 0.8 - 0.4);
  field.appendChild(el); _catch.items.push(el);
}

function _catchGameLoop() {
  if (!_catch?.running) return;
  const basket = _catch.basketEl, field = _catch.fieldEl;
  if (!field || !basket) return;
  const fw = _catch.fieldW, fh = field.offsetHeight, bw = CATCH_CONFIG.basketWidth;
  _catch.basketXCurrent += (_catch.basketX - _catch.basketXCurrent) * 0.25;
  const bx = _catch.basketXCurrent * (fw - bw);
  basket.style.transform = `translateX(${bx}px)`;
  const basketLeft = bx, basketRight = bx + bw, basketTop = fh - 60;
  const toRemove = [];
  for (const el of _catch.items) {
    const y     = parseFloat(el.dataset.y)     || 0;
    const speed = parseFloat(el.dataset.speed) || getCatchSpeed('baseSpeed');
    const newY  = y + speed;
    el.dataset.y = newY; el.style.transform = `translateY(${newY}px)`;
    const itemX      = parseFloat(el.dataset.x) + CATCH_CONFIG.itemSize / 2;
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
  const field = _catch.fieldEl, x = parseFloat(el.dataset.x), y = parseFloat(el.dataset.y);
  if (points > 0) {
    _catch.combo++;
    if (_catch.combo > _catch.maxCombo) _catch.maxCombo = _catch.combo;
    _catch.caught++;
    const bonus = _catch.combo >= 10 ? 3 : _catch.combo >= 5 ? 1 : 0;
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
  clearInterval(_catch.timerId); clearTimeout(_catch.spawnId);
  cancelAnimationFrame(_catch.frameId);
  document.removeEventListener('keydown', _catchKeyHandler);
  _catch.items.forEach(el => el.remove());
  _catch.items = [];

  const score     = _catch.score, maxCombo = _catch.maxCombo, caught = _catch.caught;
  const rewardRate = getMgSetting('catch', 'rewardRate');
  const maxReward  = getMgSetting('catch', 'maxReward');
  const reward     = Math.min(maxReward, Math.max(score > 0 ? 1 : 0, Math.floor(score / rewardRate)));
  const rLimit     = getRewardLimit('catch');
  const rUsed      = _mgTodayRewards['catch'] || 0;
  const canClaim   = rUsed < rLimit && reward > 0;

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
            <p class="font-black" style="color:#78350f;font-size:18px">${reward} 도토리 획득 가능</p>
            <p class="text-xs" style="color:#b45309;font-weight:700">${rewardRate}점당 1도토리 (최대 ${maxReward})</p>
            ${canClaim ? `<p class="text-xs mt-1" style="color:#7c3aed;font-weight:700">보상 수령 남은 횟수: ${rLimit - rUsed}/${rLimit}회</p>` : ''}
          </div>
        </div>
        ${canClaim ? `
        <div class="flex gap-2 mt-4">
          <button class="btn btn-gray flex-1 py-3" onclick="_finishCatch(${score},false)">넘기기</button>
          <button class="btn btn-primary flex-1 py-3" onclick="_finishCatch(${score},true)">🌰 보상 받기</button>
        </div>
        <p class="text-xs text-gray-400 mt-2">보상을 넘기면 도전 횟수만 차감됩니다</p>
        ` : `
        <div class="mt-4">
          ${reward > 0 ? '<p class="text-sm text-gray-400 mb-2">오늘 보상 수령 횟수를 모두 사용했어요</p>' : ''}
          <button class="btn btn-gray w-full py-3" onclick="_finishCatch(${score},false)">확인</button>
        </div>
        `}
      </div>
    </div>`;
}

async function _finishCatch(score, claimReward) {
  const rewardRate = getMgSetting('catch', 'rewardRate');
  const maxReward  = getMgSetting('catch', 'maxReward');
  const reward     = claimReward ? Math.min(maxReward, Math.max(score > 0 ? 1 : 0, Math.floor(score / rewardRate))) : 0;

  await recordPlay('catch', score, claimReward);

  if (claimReward && reward > 0) {
    await _giveMinigameReward(reward, score, 'catch');
    toast('🌰', `+${reward} 도토리를 받았어요!`);
  } else {
    toast('🎮', '기록이 저장되었습니다');
  }

  document.getElementById('minigame-play').innerHTML = `
    <div class="catch-result-screen">
      <div class="clay-card p-6 text-center" style="max-width:360px;margin:0 auto">
        <div style="font-size:3rem;margin-bottom:8px">${claimReward ? '🌰' : '✅'}</div>
        <h2 class="font-black text-lg mb-2" style="color:#78350f">${claimReward ? `+${reward} 도토리 획득!` : '기록 저장 완료'}</h2>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-gray flex-1 py-3" onclick="exitMinigame()">돌아가기</button>
          <button class="btn btn-primary flex-1 py-3" onclick="startMinigame('catch')">다시하기</button>
        </div>
      </div>
    </div>`;
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
      <p class="text-sm text-gray-500 mb-4">현재 진행 중인 게임이 끝나고<br>결과 화면으로 이동합니다.</p>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">계속하기</button>
        <button class="btn btn-primary flex-1 py-2" onclick="closeModal();endCatchGame()">종료하기</button>
      </div>
    </div>`);
  } else { exitMinigame(); }
}
