// ──────────────────────────────────────────────
//  미니게임 시스템
// ──────────────────────────────────────────────

// 게임 목록 정의
const MINIGAMES = [
  {
    id: 'catch',
    name: '🌰 도토리 캐치',
    desc: '하늘에서 떨어지는 도토리를 바구니로 받아요!',
    icon: '🧺',
    tags: ['30초', '랭킹'],
    color: 'linear-gradient(135deg, #87CEEB, #90EE90)',
    ready: true
  },
  {
    id: '2048',
    name: '🧩 2048 도토리',
    desc: '같은 숫자를 합쳐서 큰 수를 만들어요!',
    icon: '🧩',
    tags: ['퍼즐', '랭킹'],
    color: 'linear-gradient(135deg, #fef3c7, #fed7aa)',
    ready: false
  },
  {
    id: 'roulette',
    name: '🎡 행운의 룰렛',
    desc: '도토리를 걸고 룰렛을 돌려보세요!',
    icon: '🎡',
    tags: ['즉시', '행운'],
    color: 'linear-gradient(135deg, #fce4ff, #dbeafe)',
    ready: false
  }
];

// ──────────────────────────────────────────────
//  게임 허브 (게임 선택 화면)
// ──────────────────────────────────────────────
function renderMinigameHub() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.remove('hidden');
  play.classList.add('hidden');
  play.innerHTML = '';

  const grid = document.getElementById('minigameGrid');
  grid.innerHTML = MINIGAMES.map(g => `
    <div class="mg-card clay-card ${g.ready ? 'card-hover' : ''}" 
         ${g.ready ? `onclick="startMinigame('${g.id}')"` : ''}
         style="cursor:${g.ready ? 'pointer' : 'default'}">
      <div class="mg-card-preview" style="background:${g.color}">
        <span class="mg-card-icon">${g.icon}</span>
        ${!g.ready ? '<div class="mg-coming-soon">COMING SOON</div>' : ''}
      </div>
      <div class="p-4">
        <h3 class="font-black text-gray-800 text-base mb-1">${g.name}</h3>
        <p class="text-xs text-gray-400 font-semibold mb-3">${g.desc}</p>
        <div class="flex gap-1 flex-wrap">
          ${g.tags.map(t => `<span class="mg-tag">${t}</span>`).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

function startMinigame(id) {
  if (id === 'catch') startCatchGame();
}

function exitMinigame() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.remove('hidden');
  play.classList.add('hidden');
  play.innerHTML = '';
}


// ══════════════════════════════════════════════
//  도토리 캐치 게임
// ══════════════════════════════════════════════

const CATCH_CONFIG = {
  duration: 30,          // 게임 시간(초)
  spawnInterval: 600,    // 아이템 생성 간격(ms) — 시간 따라 빨라짐
  minSpawnInterval: 280, // 최소 생성 간격
  basketWidth: 64,       // 바구니 너비(px)
  itemSize: 36,          // 아이템 크기(px)
  baseSpeed: 2.2,        // 기본 낙하 속도
  maxSpeed: 5.5,         // 최대 낙하 속도
  items: [
    { emoji: '🌰', points: 1,  weight: 50, type: 'acorn' },
    { emoji: '🌰', points: 2,  weight: 20, type: 'acorn2' },
    { emoji: '✨', points: 5,  weight: 10, type: 'golden' },
    { emoji: '🍄', points: 10, weight: 4,  type: 'mushroom' },
    { emoji: '💣', points: -8, weight: 12, type: 'bomb' },
    { emoji: '🌧️', points: -3, weight: 4,  type: 'rain' },
  ]
};

let _catch = null; // 게임 상태

function startCatchGame() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.add('hidden');
  play.classList.remove('hidden');

  play.innerHTML = `
    <div class="catch-container" id="catchContainer">
      <!-- 상단 HUD -->
      <div class="catch-hud">
        <div class="catch-hud-item">
          <span class="catch-hud-label">점수</span>
          <span class="catch-hud-value" id="catchScore">0</span>
        </div>
        <div class="catch-hud-item catch-hud-timer">
          <span class="catch-hud-label">남은 시간</span>
          <span class="catch-hud-value" id="catchTimer">${CATCH_CONFIG.duration}</span>
        </div>
        <button class="catch-exit-btn" onclick="confirmExitCatch()">✕</button>
      </div>

      <!-- 게임 영역 -->
      <div class="catch-field" id="catchField">
        <!-- 배경 장식 -->
        <div class="catch-bg-cloud" style="top:15%;left:8%;animation-delay:0s">☁️</div>
        <div class="catch-bg-cloud" style="top:25%;left:65%;animation-delay:2s;font-size:28px">☁️</div>
        <div class="catch-bg-cloud" style="top:8%;left:40%;animation-delay:4s;font-size:20px">☁️</div>

        <!-- 바구니 -->
        <div class="catch-basket" id="catchBasket">🧺</div>
      </div>

      <!-- 시작 오버레이 -->
      <div class="catch-overlay" id="catchOverlay">
        <div class="catch-overlay-content">
          <div style="font-size:4rem;margin-bottom:12px">🌰</div>
          <h2 class="font-black text-xl mb-2" style="color:#78350f">도토리 캐치</h2>
          <p class="text-sm mb-1" style="color:#92400e;font-weight:700">바구니를 움직여 도토리를 받으세요!</p>
          <div class="catch-legend">
            <span>🌰 +1~2점</span>
            <span>✨ +5점</span>
            <span>🍄 +10점</span>
            <span>💣 -8점</span>
          </div>
          <button class="btn btn-primary px-8 py-3 text-base mt-3" onclick="beginCatchGame()">🎮 시작!</button>
        </div>
      </div>
    </div>
  `;

  // 바구니 초기 위치
  _catch = {
    score: 0,
    timeLeft: CATCH_CONFIG.duration,
    basketX: 0.5, // 0~1 비율
    items: [],
    running: false,
    timerId: null,
    spawnId: null,
    frameId: null,
    combo: 0,
    maxCombo: 0,
    caught: 0,
    missed: 0
  };

  _initCatchControls();
}

function _initCatchControls() {
  const field = document.getElementById('catchField');
  if (!field) return;

  // 터치 조작
  field.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!_catch?.running) return;
    const touch = e.touches[0];
    const rect = field.getBoundingClientRect();
    _catch.basketX = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    _updateBasketPos();
  }, { passive: false });

  field.addEventListener('touchstart', e => {
    if (!_catch?.running) return;
    const touch = e.touches[0];
    const rect = field.getBoundingClientRect();
    _catch.basketX = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    _updateBasketPos();
  }, { passive: true });

  // 마우스 조작
  field.addEventListener('mousemove', e => {
    if (!_catch?.running) return;
    const rect = field.getBoundingClientRect();
    _catch.basketX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    _updateBasketPos();
  });

  // 키보드 조작
  document.addEventListener('keydown', _catchKeyHandler);
}

function _catchKeyHandler(e) {
  if (!_catch?.running) return;
  const step = 0.06;
  if (e.key === 'ArrowLeft' || e.key === 'a') {
    _catch.basketX = Math.max(0, _catch.basketX - step);
    _updateBasketPos();
  } else if (e.key === 'ArrowRight' || e.key === 'd') {
    _catch.basketX = Math.min(1, _catch.basketX + step);
    _updateBasketPos();
  }
}

function _updateBasketPos() {
  const basket = document.getElementById('catchBasket');
  if (!basket) return;
  const field = document.getElementById('catchField');
  const fw = field.offsetWidth;
  const bw = CATCH_CONFIG.basketWidth;
  const x = _catch.basketX * (fw - bw);
  basket.style.left = x + 'px';
}

function beginCatchGame() {
  const overlay = document.getElementById('catchOverlay');
  overlay.classList.add('hidden');
  _catch.running = true;
  _catch.score = 0;
  _catch.timeLeft = CATCH_CONFIG.duration;
  _catch.combo = 0;
  _catch.maxCombo = 0;
  _catch.caught = 0;
  _catch.missed = 0;

  playSound('gacha');

  // 카운트다운 타이머
  _catch.timerId = setInterval(() => {
    _catch.timeLeft--;
    document.getElementById('catchTimer').textContent = _catch.timeLeft;

    // 마지막 5초 빨간색 깜빡임
    const timerEl = document.getElementById('catchTimer');
    if (_catch.timeLeft <= 5) {
      timerEl.parentElement.classList.add('catch-hud-danger');
    }

    if (_catch.timeLeft <= 0) {
      endCatchGame();
    }
  }, 1000);

  // 아이템 생성
  _scheduleSpawn();

  // 게임 루프
  _catch.frameId = requestAnimationFrame(_catchGameLoop);
}

function _scheduleSpawn() {
  if (!_catch?.running) return;
  const elapsed = CATCH_CONFIG.duration - _catch.timeLeft;
  const progress = elapsed / CATCH_CONFIG.duration;
  const interval = CATCH_CONFIG.spawnInterval - (CATCH_CONFIG.spawnInterval - CATCH_CONFIG.minSpawnInterval) * progress;

  _catch.spawnId = setTimeout(() => {
    _spawnItem();
    _scheduleSpawn();
  }, interval);
}

function _spawnItem() {
  if (!_catch?.running) return;
  const field = document.getElementById('catchField');
  if (!field) return;

  // 가중 랜덤 선택
  const totalWeight = CATCH_CONFIG.items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * totalWeight;
  let chosen = CATCH_CONFIG.items[0];
  for (const item of CATCH_CONFIG.items) {
    r -= item.weight;
    if (r <= 0) { chosen = item; break; }
  }

  const fw = field.offsetWidth;
  const x = Math.random() * (fw - CATCH_CONFIG.itemSize);

  // 시간에 따라 속도 증가
  const elapsed = CATCH_CONFIG.duration - _catch.timeLeft;
  const progress = elapsed / CATCH_CONFIG.duration;
  const speed = CATCH_CONFIG.baseSpeed + (CATCH_CONFIG.maxSpeed - CATCH_CONFIG.baseSpeed) * progress;

  const el = document.createElement('div');
  el.className = 'catch-item';
  el.textContent = chosen.emoji;
  el.style.left = x + 'px';
  el.style.top = '-40px';
  el.dataset.points = chosen.points;
  el.dataset.type = chosen.type;
  el.dataset.speed = speed + (Math.random() * 0.8 - 0.4); // 약간의 랜덤 속도차

  field.appendChild(el);
  _catch.items.push(el);
}

function _catchGameLoop() {
  if (!_catch?.running) return;

  const field = document.getElementById('catchField');
  const basket = document.getElementById('catchBasket');
  if (!field || !basket) return;

  const fh = field.offsetHeight;
  const fw = field.offsetWidth;
  const bRect = basket.getBoundingClientRect();
  const fRect = field.getBoundingClientRect();
  const basketLeft = bRect.left - fRect.left;
  const basketRight = basketLeft + bRect.width;
  const basketTop = bRect.top - fRect.top;

  const toRemove = [];

  for (const el of _catch.items) {
    const y = parseFloat(el.style.top) || 0;
    const speed = parseFloat(el.dataset.speed) || CATCH_CONFIG.baseSpeed;
    const newY = y + speed;
    el.style.top = newY + 'px';

    const itemX = parseFloat(el.style.left) + CATCH_CONFIG.itemSize / 2;
    const itemY = newY + CATCH_CONFIG.itemSize;

    // 바구니와 충돌 체크
    if (itemY >= basketTop && itemY <= basketTop + 30 &&
        itemX >= basketLeft - 10 && itemX <= basketRight + 10) {
      const points = parseInt(el.dataset.points);
      const type = el.dataset.type;
      _catchCollect(points, type, el);
      toRemove.push(el);
      continue;
    }

    // 화면 밖으로 나감
    if (newY > fh + 10) {
      const points = parseInt(el.dataset.points);
      if (points > 0) {
        _catch.missed++;
        _catch.combo = 0;
      }
      toRemove.push(el);
    }
  }

  // 제거
  for (const el of toRemove) {
    el.remove();
    _catch.items = _catch.items.filter(i => i !== el);
  }

  _catch.frameId = requestAnimationFrame(_catchGameLoop);
}

function _catchCollect(points, type, el) {
  const field = document.getElementById('catchField');
  const x = parseFloat(el.style.left);
  const y = parseFloat(el.style.top);

  if (points > 0) {
    _catch.combo++;
    if (_catch.combo > _catch.maxCombo) _catch.maxCombo = _catch.combo;
    _catch.caught++;

    // 콤보 보너스
    let bonus = 0;
    if (_catch.combo >= 10) bonus = 3;
    else if (_catch.combo >= 5) bonus = 1;

    const totalPoints = points + bonus;
    _catch.score += totalPoints;

    // +점수 이펙트
    _showCatchEffect(field, x, y, `+${totalPoints}`, type === 'golden' ? '#d97706' : type === 'mushroom' ? '#7c3aed' : '#059669');

    // 콤보 표시
    if (_catch.combo >= 5 && _catch.combo % 5 === 0) {
      _showCatchEffect(field, x - 10, y - 20, `🔥 ${_catch.combo}콤보!`, '#dc2626');
    }

    playSound('click');
  } else {
    // 폭탄/비
    _catch.score = Math.max(0, _catch.score + points);
    _catch.combo = 0;
    _showCatchEffect(field, x, y, `${points}`, '#dc2626');

    // 바구니 흔들림
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
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.color = color;
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

  // 남은 아이템 제거
  _catch.items.forEach(el => el.remove());
  _catch.items = [];

  const score = _catch.score;
  const maxCombo = _catch.maxCombo;
  const caught = _catch.caught;
  const missed = _catch.missed;

  // 보상 계산 (10점당 1도토리, 최소 1, 최대 20)
  const reward = Math.min(20, Math.max(1, Math.floor(score / 10)));

  playSound('gachaResult');

  // 결과 화면
  const play = document.getElementById('minigame-play');
  play.innerHTML = `
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
            <p class="text-xs" style="color:#b45309;font-weight:700">10점당 1도토리 (최대 20)</p>
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button class="btn btn-gray flex-1 py-3" onclick="exitMinigame()">돌아가기</button>
          <button class="btn btn-primary flex-1 py-3" onclick="startCatchGame()">다시하기</button>
        </div>
      </div>
    </div>
  `;

  // 도토리 지급
  _giveMinigameReward(reward, score, 'catch');
}

async function _giveMinigameReward(reward, score, gameId) {
  if (!myProfile || reward <= 0) return;
  try {
    const res = await sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id,
      p_amount: reward,
      p_reason: `미니게임 [도토리 캐치] 점수 ${score} — 보상 ${reward}🌰`
    });
    if (res.data?.success) {
      myProfile.acorns = res.data.balance;
      updateAcornDisplay();
    }
  } catch(e) {
    console.warn('[minigame] 보상 지급 실패:', e);
  }
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
  } else {
    exitMinigame();
  }
}
