// ══════════════════════════════════════════════
//  2048 하드코어 미니게임
//  - 타이머 생존 모드 (관리자 설정: duration)
//  - 💀 폭탄 타일 (bombStartTurn, bombMaxChance)
//  - 💥 폭탄 상쇄 (defuseBonus)
//  - 🔥 콤보 시스템 (comboBonus)
// ══════════════════════════════════════════════

const _2048 = {
  SIZE: 4, BOMB: -1,
  grid: null, tiles: null, score: 0, tileId: 0,
  prevState: null, animating: false,
  timeLeft: 30, timerInterval: null, running: false,
  combo: 0, lastMergeTime: 0, bombCounter: 0,
  acornDropped: 0,
  audioCtx: null, maxTime: 30,
  bgm: null, bgmReady: false,
  cfg: { bombStartTurn: 3, bombMaxChance: 60, defuseBonus: 1.2, comboBonus: 0.5, dropChance: 20, dropMin: 1, dropMax: 1 },
  tileLayer: null, boardEl: null, timerBar: null, timerText: null,
  timerWrap: null, overlayEl: null, scoreEl: null, bestEl: null,
  _keyHandler: null, _touchSX: 0, _touchSY: 0, _mouseDown: false, _mouseX: 0, _mouseY: 0,
};

// ── BGM ──
function _2048_bgmInit() {
  if (_2048.bgm) return;
  const a = new Audio('sounds/menu_bgm_2048.mp3');
  a.loop = true;
  a.volume = 0.25;
  a.preload = 'auto';
  _2048.bgm = a;
}
function _2048_bgmPlay() {
  _2048_bgmInit();
  const a = _2048.bgm;
  if (!a) return;
  a.currentTime = 0;
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
}
function _2048_bgmStop() {
  const a = _2048.bgm;
  if (!a) return;
  a.pause();
  a.currentTime = 0;
}
// 글로벌 stop (탭 전환 등 외부에서 호출)
function stop2048Bgm() { _2048_bgmStop(); }

// ── Audio ──
function _2048_initAudio() {
  if (!_2048.audioCtx) _2048.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_2048.audioCtx.state === 'suspended') _2048.audioCtx.resume();
}
function _2048_tone(freq, dur, type = 'sine', vol = 0.12) {
  if (!_2048.audioCtx) return;
  const ctx = _2048.audioCtx, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
}
function _2048_noise(dur, vol = 0.1) {
  if (!_2048.audioCtx) return;
  const ctx = _2048.audioCtx, bs = ctx.sampleRate * dur;
  const buf = ctx.createBuffer(1, bs, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < bs; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bs, 2);
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(g).connect(ctx.destination); src.start();
}
const _2048_sfx = {
  move()    { _2048_tone(220, .07, 'triangle', .07); },
  merge(v)  { const f = 300 + Math.min(v, 2048) * .3; _2048_tone(f, .13, 'sine', .14); setTimeout(() => _2048_tone(f * 1.5, .1, 'sine', .1), 40); },
  spawn()   { _2048_tone(600, .05, 'sine', .04); },
  invalid() { _2048_tone(120, .12, 'square', .05); },
  bombIn()  { _2048_tone(80, .3, 'sawtooth', .12); setTimeout(() => _2048_tone(60, .2, 'square', .08), 100); },
  bombCancel() { _2048_noise(.35, .18); _2048_tone(200, .15, 'square', .1); setTimeout(() => _2048_tone(400, .12, 'sine', .12), 60); setTimeout(() => _2048_tone(800, .15, 'sine', .1), 120); },
  combo(n)  { const b = 400 + n * 80; _2048_tone(b, .15, 'sine', .12); setTimeout(() => _2048_tone(b * 1.25, .12, 'sine', .1), 60); setTimeout(() => _2048_tone(b * 1.5, .1, 'sine', .08), 120); },
  timeUp()  { _2048_tone(400, .2, 'sawtooth', .1); setTimeout(() => _2048_tone(300, .25, 'sawtooth', .1), 120); setTimeout(() => _2048_tone(180, .4, 'sawtooth', .12), 250); },
  timeBonus() { _2048_tone(800, .12, 'sine', .08); setTimeout(() => _2048_tone(1000, .1, 'sine', .06), 60); },
  tick()    { _2048_tone(900, .03, 'triangle', .04); },
};

// ── Helpers ──
function _2048_clone(g) { return g.map(r => [...r]); }
function _2048_cellMetrics() { const w = _2048.tileLayer.offsetWidth, gap = 10, cs = (w - gap * 3) / 4; return { gap, cs }; }
function _2048_cellPos(r, c) { const { gap, cs } = _2048_cellMetrics(); return { left: c * (cs + gap), top: r * (cs + gap), size: cs }; }
function _2048_makeTileEl(t, r, c, cs) {
  const { left, top } = _2048_cellPos(r, c);
  const el = document.createElement('div');
  if (t.value === _2048.BOMB) { el.className = 'mg2048-tile mg2048-bomb'; el.textContent = '💀'; }
  else { el.className = `mg2048-tile mg2048-v${t.value > 2048 ? 'super' : t.value}`; el.style.fontSize = t.value >= 1024 ? '1rem' : t.value >= 128 ? '1.15rem' : '1.35rem'; el.textContent = t.value; }
  Object.assign(el.style, { width: cs + 'px', height: cs + 'px', left: left + 'px', top: top + 'px' });
  return el;
}
function _2048_getBest() { return +localStorage.getItem('mg2048hcBest') || 0; }
function _2048_setBest(v) { localStorage.setItem('mg2048hcBest', v); }
function _2048_updateBest() { const b = _2048_getBest(); if (_2048.score > b) _2048_setBest(_2048.score); _2048.bestEl.textContent = Math.max(_2048.score, b); }

// ══════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════
function start2048Game() {
  const hub = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.add('hidden'); play.classList.remove('hidden');

  const maxTime       = getMgSetting('2048', 'duration') || 30;
  const bombStartTurn = getMgSetting('2048', 'bombStartTurn') ?? 3;
  const bombMaxChance = getMgSetting('2048', 'bombMaxChance') ?? 60;
  const defuseBonus   = getMgSetting('2048', 'defuseBonus') ?? 1.2;
  const comboBonus    = getMgSetting('2048', 'comboBonus') ?? 0.5;
  const dropChance    = getMgSetting('2048', 'dropChance') ?? 20;
  const dropMin       = getMgSetting('2048', 'dropMin') ?? 1;
  const dropMax       = getMgSetting('2048', 'dropMax') ?? 1;
  _2048.maxTime = maxTime;
  _2048.acornDropped = 0;
  _2048.cfg = { bombStartTurn, bombMaxChance, defuseBonus, comboBonus, dropChance, dropMin, dropMax };

  play.innerHTML = `
    <style>
      .mg2048-wrap{position:relative;width:100%;max-width:400px;margin:0 auto;touch-action:none;user-select:none;-webkit-user-select:none}
      .mg2048-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:0 2px}
      .mg2048-title{font-size:1.5rem;font-weight:900;color:#78350f;display:flex;align-items:baseline;gap:8px}
      .mg2048-badge{font-size:.5rem;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;padding:3px 8px;border-radius:6px;animation:mg2048-pulse 1.5s ease infinite;box-shadow:0 2px 8px rgba(245,158,11,.3)}
      @keyframes mg2048-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.85;transform:scale(1.04)}}
      .mg2048-exit-top{width:32px;height:32px;border-radius:50%;border:none;background:rgba(120,53,15,.08);color:#92400e;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;flex-shrink:0}
      .mg2048-exit-top:hover{background:rgba(120,53,15,.15)}
      .mg2048-scores{display:flex;gap:6px;margin-bottom:14px}
      .mg2048-sbox{flex:1;background:linear-gradient(135deg,#fffbeb,#fef3c7);border-radius:12px;padding:8px 10px;text-align:center;border:1.5px solid rgba(180,100,0,.1);box-shadow:0 2px 8px rgba(180,100,0,.06)}
      .mg2048-sbox-label{font-size:.5rem;text-transform:uppercase;letter-spacing:1px;color:#b45309;opacity:.6;font-weight:700}
      .mg2048-sbox-val{font-size:1.1rem;font-weight:900;color:#d97706;margin-top:2px}
      .mg2048-sbox.drop{background:linear-gradient(135deg,#fffbeb,#fef9e7);border-color:rgba(251,191,36,.2)}
      .mg2048-sbox.combo{background:linear-gradient(135deg,#faf5ff,#f3e8ff);border-color:rgba(168,85,247,.12)}
      .mg2048-sbox.combo .mg2048-sbox-label{color:#7c3aed;opacity:.6}
      .mg2048-sbox.combo .mg2048-sbox-val{color:#7c3aed}
      .mg2048-timer-wrap{position:relative;height:8px;background:rgba(180,100,0,.08);border-radius:6px;margin-bottom:14px;overflow:hidden;border:1px solid rgba(180,100,0,.06)}
      .mg2048-timer-bar{height:100%;border-radius:6px;background:linear-gradient(90deg,#ef4444,#f59e0b,#22c55e);transition:width .1s linear}
      .mg2048-timer-bar.danger{background:linear-gradient(90deg,#ef4444,#dc2626);animation:mg2048-tflash .3s ease infinite}
      @keyframes mg2048-tflash{0%,100%{opacity:1}50%{opacity:.5}}
      .mg2048-timer-text{position:absolute;right:6px;top:-18px;font-size:.72rem;font-weight:800;color:#dc2626;font-variant-numeric:tabular-nums}
      .mg2048-time-bonus{position:absolute;right:6px;top:-35px;font-size:.78rem;font-weight:800;color:#059669;pointer-events:none;animation:mg2048-floatUp 650ms ease forwards}
      @keyframes mg2048-floatUp{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-20px)}}
      .mg2048-board{width:100%;aspect-ratio:1;background:linear-gradient(145deg,#fef3c7,#fde68a);border-radius:16px;padding:10px;display:grid;grid-template:repeat(4,1fr)/repeat(4,1fr);gap:10px;position:relative;border:2px solid rgba(180,100,0,.12);box-shadow:0 4px 20px rgba(180,100,0,.1),inset 0 2px 0 rgba(255,255,255,.6);touch-action:none;transition:box-shadow .3s}
      .mg2048-board.danger-glow{box-shadow:0 0 24px rgba(239,68,68,.2),0 4px 20px rgba(180,100,0,.1),inset 0 2px 0 rgba(255,255,255,.6)}
      .mg2048-cell{background:rgba(120,53,15,.07);border-radius:10px;box-shadow:inset 0 2px 4px rgba(120,53,15,.06)}
      .mg2048-tile-layer{position:absolute;inset:10px;pointer-events:none}
      .mg2048-tile{position:absolute;display:flex;align-items:center;justify-content:center;font-weight:900;border-radius:10px;transition:left 130ms cubic-bezier(.4,0,.2,1),top 130ms cubic-bezier(.4,0,.2,1);will-change:left,top,transform;z-index:1;box-shadow:0 3px 0 rgba(0,0,0,.1),0 2px 8px rgba(0,0,0,.08)}
      .mg2048-tile.spawning{animation:mg2048-spawn 220ms cubic-bezier(.2,.6,.4,1.4) forwards}
      .mg2048-tile.merging{animation:mg2048-merge 300ms cubic-bezier(.2,.6,.4,1.6) forwards;z-index:3}
      .mg2048-tile.bomb-enter{animation:mg2048-bombDrop 400ms cubic-bezier(.4,0,.2,1) forwards}
      @keyframes mg2048-spawn{0%{transform:scale(0);opacity:0}100%{transform:scale(1);opacity:1}}
      @keyframes mg2048-merge{0%{transform:scale(1)}35%{transform:scale(1.3)}70%{transform:scale(.94)}100%{transform:scale(1)}}
      @keyframes mg2048-bombDrop{0%{transform:scale(1.8) rotate(20deg);opacity:0}50%{transform:scale(.9) rotate(-5deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}
      .mg2048-v2{background:#fff7ed;color:#c2410c;font-weight:800}
      .mg2048-v4{background:#ffedd5;color:#c2410c}
      .mg2048-v8{background:#f59e0b;color:#fff;box-shadow:0 3px 0 #d97706,0 2px 8px rgba(245,158,11,.2)}
      .mg2048-v16{background:#f97316;color:#fff;box-shadow:0 3px 0 #ea580c,0 2px 8px rgba(249,115,22,.2)}
      .mg2048-v32{background:#ef4444;color:#fff;box-shadow:0 3px 0 #dc2626,0 2px 8px rgba(239,68,68,.2)}
      .mg2048-v64{background:#dc2626;color:#fff;box-shadow:0 3px 0 #b91c1c,0 2px 8px rgba(220,38,38,.25)}
      .mg2048-v128{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#78350f;box-shadow:0 3px 0 #d97706,0 4px 12px rgba(245,158,11,.3)}
      .mg2048-v256{background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;box-shadow:0 3px 0 #c2410c,0 4px 12px rgba(234,88,12,.3)}
      .mg2048-v512{background:linear-gradient(135deg,#ea580c,#dc2626);color:#fff;box-shadow:0 3px 0 #b91c1c,0 4px 12px rgba(220,38,38,.3)}
      .mg2048-v1024{background:linear-gradient(135deg,#dc2626,#9333ea);color:#fff;box-shadow:0 3px 0 #7e22ce,0 4px 14px rgba(147,51,234,.3)}
      .mg2048-v2048{background:linear-gradient(135deg,#f59e0b,#ef4444,#9333ea);color:#fff;box-shadow:0 3px 0 #7e22ce,0 0 20px rgba(245,158,11,.3),0 0 40px rgba(239,68,68,.15);animation:mg2048-glow 2s ease infinite}
      @keyframes mg2048-glow{0%,100%{box-shadow:0 3px 0 #7e22ce,0 0 20px rgba(245,158,11,.3)}50%{box-shadow:0 3px 0 #7e22ce,0 0 28px rgba(245,158,11,.4),0 0 50px rgba(239,68,68,.2)}}
      .mg2048-vsuper{background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;box-shadow:0 3px 0 #7e22ce,0 0 16px rgba(139,92,246,.3)}
      .mg2048-bomb{background:radial-gradient(circle at 40% 35%,#6b7280,#374151);color:#fca5a5;border:2px solid rgba(252,165,165,.3);box-shadow:0 3px 0 #1f2937,0 0 12px rgba(239,68,68,.15);font-size:1.4rem!important}
      .mg2048-particle{position:absolute;border-radius:50%;pointer-events:none;z-index:5;animation:mg2048-pfly var(--dur,450ms) ease-out forwards}
      @keyframes mg2048-pfly{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0)}}
      .mg2048-float{position:absolute;font-weight:900;color:#dc2626;pointer-events:none;z-index:20;font-size:.95rem;text-shadow:0 1px 2px rgba(0,0,0,.1);animation:mg2048-floatUp 600ms ease forwards}
      .mg2048-acorn-drop{position:absolute;font-weight:900;color:#d97706;pointer-events:none;z-index:21;font-size:.9rem;text-shadow:0 1px 4px rgba(217,119,6,.3);animation:mg2048-acornDrop 800ms ease forwards}
      @keyframes mg2048-acornDrop{0%{opacity:0;transform:scale(.5) translateY(5px)}20%{opacity:1;transform:scale(1.2) translateY(-8px)}100%{opacity:0;transform:scale(1) translateY(-28px)}}
      .mg2048-combo{position:absolute;font-weight:900;color:#b45309;pointer-events:none;z-index:20;font-size:1.3rem;text-shadow:0 2px 8px rgba(180,83,9,.3);animation:mg2048-comboAnim 800ms ease forwards}
      @keyframes mg2048-comboAnim{0%{opacity:0;transform:scale(.5) translateY(10px)}30%{opacity:1;transform:scale(1.2) translateY(-5px)}100%{opacity:0;transform:scale(1) translateY(-35px)}}
      .mg2048-defuse{position:absolute;font-weight:900;color:#0891b2;pointer-events:none;z-index:20;font-size:1.15rem;text-shadow:0 2px 8px rgba(8,145,178,.3);animation:mg2048-comboAnim 900ms ease forwards}
      .mg2048-ring{position:absolute;border-radius:50%;border:3px solid rgba(245,158,11,.6);pointer-events:none;z-index:6;animation:mg2048-ring 500ms ease-out forwards}
      @keyframes mg2048-ring{0%{width:8px;height:8px;opacity:1;transform:translate(-4px,-4px)}100%{width:90px;height:90px;opacity:0;transform:translate(-45px,-45px)}}
      .mg2048-board.shake{animation:mg2048-shake 200ms ease}
      @keyframes mg2048-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
      .mg2048-swipe-zone{min-height:80px;border-radius:16px;margin-top:14px;display:flex;align-items:center;justify-content:center;border:1.5px dashed rgba(180,100,0,.08);background:rgba(180,100,0,.02)}
      .mg2048-swipe-hint{font-size:.65rem;color:rgba(120,53,15,.18);font-weight:700;letter-spacing:.5px}
      .mg2048-overlay{position:absolute;inset:0;background:rgba(254,243,199,.94);backdrop-filter:blur(8px);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10;transition:opacity .3s}
      [data-theme="dark"] .mg2048-overlay{background:rgba(30,30,40,.92)}
      .mg2048-overlay.hidden{opacity:0;pointer-events:none}
      .mg2048-overlay h3{font-size:1.4rem;font-weight:900;margin-bottom:6px;color:#78350f}
      .mg2048-overlay .rules{font-size:.75rem;color:#92400e;opacity:.7;text-align:center;line-height:1.8;margin-bottom:16px;padding:0 18px}
      .mg2048-overlay .rules b{color:#dc2626;font-weight:800;opacity:1}
      .mg2048-overlay .rules .cyan{color:#0891b2;font-weight:800;opacity:1}
      [data-theme="dark"] .mg2048-overlay h3{color:#e8e8f0}
      [data-theme="dark"] .mg2048-overlay .rules{color:#ccc}
      .mg2048-foot{text-align:center;font-size:.6rem;opacity:.2;margin-top:10px;letter-spacing:1px}
    </style>
    <div class="mg2048-wrap" id="mg2048Wrap">
      <div class="mg2048-header">
        <div class="mg2048-title">2048 <span class="mg2048-badge">HARDCORE</span></div>
        <button class="mg2048-exit-top" onclick="_2048_confirmExit()">✕</button>
      </div>
      <div class="mg2048-scores">
        <div class="mg2048-sbox"><div class="mg2048-sbox-label">Score</div><div class="mg2048-sbox-val" id="mg2048Score">0</div></div>
        <div class="mg2048-sbox"><div class="mg2048-sbox-label">Best</div><div class="mg2048-sbox-val" id="mg2048Best">${_2048_getBest()}</div></div>
        <div class="mg2048-sbox drop"><div class="mg2048-sbox-label">Drop</div><div class="mg2048-sbox-val" id="mg2048AcornCount">🌰 0</div></div>
        <div class="mg2048-sbox combo"><div class="mg2048-sbox-label">Combo</div><div class="mg2048-sbox-val" id="mg2048ComboCount">-</div></div>
      </div>
      <div class="mg2048-timer-wrap" id="mg2048TimerWrap">
        <div class="mg2048-timer-text" id="mg2048TimerText">${maxTime}.0s</div>
        <div class="mg2048-timer-bar" id="mg2048TimerBar" style="width:100%"></div>
      </div>
      <div class="mg2048-board" id="mg2048Board">
        <div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div>
        <div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div>
        <div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div>
        <div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div><div class="mg2048-cell"></div>
        <div class="mg2048-tile-layer" id="mg2048TileLayer"></div>
        <div class="mg2048-overlay" id="mg2048Start">
          <div style="font-size:2.5rem;margin-bottom:6px">⚡</div>
          <h3>HARDCORE MODE</h3>
          <div class="rules">
            제한시간 <b>${maxTime}초</b> 생존<br>
            💀 <b>폭탄 타일</b>이 랜덤 등장 (합칠 수 없음!)<br>
            💥 <span class="cyan">폭탄끼리 부딪히면 상쇄 제거</span> +${defuseBonus}초<br>
            🔥 연속 병합 <b>콤보</b>로 시간 보너스
          </div>
          <button class="btn btn-primary px-8 py-3 text-base" onclick="_2048_begin()">🎮 시작!</button>
        </div>
        <div class="mg2048-overlay hidden" id="mg2048Overlay"></div>
      </div>
      <div class="mg2048-swipe-zone">
        <span class="mg2048-swipe-hint">↕ 여기서도 스와이프 가능 ↕</span>
      </div>
      <p class="mg2048-foot">방향키 · WASD · 스와이프 · 💀+💀 = 💥</p>
    </div>`;

  _2048.tileLayer = document.getElementById('mg2048TileLayer');
  _2048.boardEl   = document.getElementById('mg2048Board');
  _2048.timerBar  = document.getElementById('mg2048TimerBar');
  _2048.timerText = document.getElementById('mg2048TimerText');
  _2048.timerWrap = document.getElementById('mg2048TimerWrap');
  _2048.overlayEl = document.getElementById('mg2048Overlay');
  _2048.scoreEl   = document.getElementById('mg2048Score');
  _2048.bestEl    = document.getElementById('mg2048Best');
  _2048.wrapEl    = document.getElementById('mg2048Wrap');
  _2048_bindInput();
}

// ── Input ──
function _2048_bindInput() {
  _2048._keyHandler = e => {
    const map = { ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down', a:'left',d:'right',w:'up',s:'down', ㅁ:'left',ㅇ:'right',ㅈ:'up',ㄴ:'down' };
    const dir = map[e.key]; if (dir) { e.preventDefault(); _2048_move(dir); }
  };
  document.addEventListener('keydown', _2048._keyHandler);
  // 스와이프: wrap 전체에 바인딩 (보드 밖에서도 인식)
  const w = _2048.wrapEl;

  // ── Touch: track during move, fire early on sufficient delta ──
  let _tActive = false, _tSX = 0, _tSY = 0, _tFired = false;
  w.addEventListener('touchstart', e => {
    _tSX = e.touches[0].clientX; _tSY = e.touches[0].clientY;
    _tActive = true; _tFired = false;
  }, { passive: true });
  w.addEventListener('touchmove', e => {
    if (!_tActive || _tFired) return;
    e.preventDefault(); // 스크롤 방지
    const dx = e.touches[0].clientX - _tSX, dy = e.touches[0].clientY - _tSY;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 20) return; // 임계값 20px
    _tFired = true;
    adx > ady ? _2048_move(dx > 0 ? 'right' : 'left') : _2048_move(dy > 0 ? 'down' : 'up');
  }, { passive: false });
  w.addEventListener('touchend', e => {
    if (!_tActive || _tFired) { _tActive = false; return; }
    _tActive = false;
    // touchmove에서 못 잡은 짧은 스와이프 보완
    const dx = e.changedTouches[0].clientX - _tSX, dy = e.changedTouches[0].clientY - _tSY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 15) return;
    Math.abs(dx) > Math.abs(dy) ? _2048_move(dx > 0 ? 'right' : 'left') : _2048_move(dy > 0 ? 'down' : 'up');
  });

  // ── Mouse drag ──
  w.addEventListener('mousedown', e => { _2048._mouseX = e.clientX; _2048._mouseY = e.clientY; _2048._mouseDown = true; });
  w.addEventListener('mouseup', e => {
    if (!_2048._mouseDown) return; _2048._mouseDown = false;
    const dx = e.clientX - _2048._mouseX, dy = e.clientY - _2048._mouseY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    Math.abs(dx) > Math.abs(dy) ? _2048_move(dx > 0 ? 'right' : 'left') : _2048_move(dy > 0 ? 'down' : 'up');
  });
}
function _2048_unbindInput() { if (_2048._keyHandler) document.removeEventListener('keydown', _2048._keyHandler); _2048._keyHandler = null; }

// ── Begin ──
function _2048_begin() {
  _2048_initAudio();
  _2048_bgmPlay();
  const S = _2048.SIZE;
  _2048.grid = Array.from({ length: S }, () => Array(S).fill(0));
  _2048.tiles = Array.from({ length: S }, () => Array(S).fill(null));
  _2048.score = 0; _2048.tileId = 0; _2048.prevState = null;
  _2048.combo = 0; _2048.lastMergeTime = 0; _2048.bombCounter = 0; _2048.animating = false;
  document.getElementById('mg2048Start').classList.add('hidden');
  _2048.overlayEl.classList.add('hidden');
  _2048_spawnTile(); _2048_spawnTile();
  _2048_renderInstant();
  _2048.running = true; _2048_startTimer();
  try { playSound('gacha'); } catch (e) {}
}
function _2048_spawnTile() {
  const S = _2048.SIZE, empty = [];
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (!_2048.grid[r][c]) empty.push([r, c]);
  if (!empty.length) return null;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  const v = Math.random() < .9 ? 2 : 4;
  _2048.grid[r][c] = v; _2048.tiles[r][c] = { id: ++_2048.tileId, value: v, spawned: true };
  return [r, c];
}
function _2048_spawnBomb() {
  const S = _2048.SIZE, empty = [];
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (!_2048.grid[r][c]) empty.push([r, c]);
  if (!empty.length) return null;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  _2048.grid[r][c] = _2048.BOMB; _2048.tiles[r][c] = { id: ++_2048.tileId, value: _2048.BOMB, bomb: true };
  return [r, c];
}
function _2048_renderInstant() {
  _2048.tileLayer.innerHTML = '';
  _2048.scoreEl.textContent = _2048.score; _2048_updateBest();
  const { cs } = _2048_cellMetrics(), S = _2048.SIZE;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    const t = _2048.tiles[r][c]; if (!t) continue;
    const el = _2048_makeTileEl(t, r, c, cs);
    if (t.spawned) { el.classList.add('spawning'); t.spawned = false; }
    _2048.tileLayer.appendChild(el);
  }
}

// ── Timer ──
function _2048_startTimer() {
  _2048.timeLeft = _2048.maxTime; _2048_updateTimerDisplay();
  _2048.timerInterval = setInterval(() => {
    _2048.timeLeft -= 0.1;
    if (_2048.timeLeft <= 5 && Math.abs(_2048.timeLeft - Math.round(_2048.timeLeft)) < .05) _2048_sfx.tick();
    if (_2048.timeLeft <= 0) { _2048.timeLeft = 0; _2048_updateTimerDisplay(); _2048_endGame("TIME'S UP", '시간 초과!'); return; }
    _2048_updateTimerDisplay();
  }, 100);
}
function _2048_updateTimerDisplay() {
  const pct = (_2048.timeLeft / _2048.maxTime) * 100;
  _2048.timerBar.style.width = pct + '%';
  _2048.timerText.textContent = _2048.timeLeft.toFixed(1) + 's';
  if (pct <= 25) { _2048.timerBar.classList.add('danger'); _2048.boardEl.classList.add('danger-glow'); }
  else { _2048.timerBar.classList.remove('danger'); _2048.boardEl.classList.remove('danger-glow'); }
}
function _2048_addTime(sec) {
  _2048.timeLeft = Math.min(_2048.timeLeft + sec, _2048.maxTime); _2048_updateTimerDisplay();
  const el = document.createElement('div'); el.className = 'mg2048-time-bonus';
  el.textContent = '+' + sec.toFixed(1) + 's';
  _2048.timerWrap.appendChild(el); setTimeout(() => el.remove(), 600);
  _2048_sfx.timeBonus();
}

// ══════════════════════════════════════════════
//  MOVE
// ══════════════════════════════════════════════
function _2048_move(dir) {
  if (_2048.animating || !_2048.running) return;
  _2048_initAudio();
  const S = _2048.SIZE, BOMB = _2048.BOMB;
  const prevGrid = _2048_clone(_2048.grid);
  const prevTiles = _2048.tiles.map(r => r.map(t => t ? { ...t } : null));
  const prevScore = _2048.score;
  const anims = [];
  const d = { left:{dr:0,dc:-1}, right:{dr:0,dc:1}, up:{dr:-1,dc:0}, down:{dr:1,dc:0} }[dir];
  const rows = d.dr === 1 ? [3,2,1,0] : [0,1,2,3];
  const cols = d.dc === 1 ? [3,2,1,0] : [0,1,2,3];
  const newGrid = Array.from({length:S}, () => Array(S).fill(0));
  const newTiles = Array.from({length:S}, () => Array(S).fill(null));
  const merged = Array.from({length:S}, () => Array(S).fill(false));
  let mergeCount = 0;
  const bombCancels = [];

  for (const r of rows) for (const c of cols) {
    if (!_2048.grid[r][c]) continue;
    const val = _2048.grid[r][c];
    let nr = r, nc = c;
    while (true) {
      const nnr = nr + d.dr, nnc = nc + d.dc;
      if (nnr < 0 || nnr >= S || nnc < 0 || nnc >= S) break;
      if (newGrid[nnr][nnc] === 0) { nr = nnr; nc = nnc; continue; }
      if (val === BOMB && newGrid[nnr][nnc] === BOMB && !merged[nnr][nnc]) { nr = nnr; nc = nnc; break; }
      if (val !== BOMB && newGrid[nnr][nnc] !== BOMB && newGrid[nnr][nnc] === val && !merged[nnr][nnc]) { nr = nnr; nc = nnc; break; }
      break;
    }
    if (val === BOMB && newGrid[nr][nc] === BOMB && !merged[nr][nc] && (nr !== r || nc !== c)) {
      newGrid[nr][nc] = 0; newTiles[nr][nc] = null; merged[nr][nc] = true;
      bombCancels.push([nr, nc]);
      anims.push({ fromR:r, fromC:c, toR:nr, toC:nc, tile:_2048.tiles[r][c], merge:false, bombCancel:true });
      continue;
    }
    const canMerge = val !== BOMB && newGrid[nr][nc] === val && newGrid[nr][nc] !== BOMB && !merged[nr][nc] && (nr !== r || nc !== c);
    if (canMerge) {
      const nv = val * 2;
      newGrid[nr][nc] = nv; newTiles[nr][nc] = { id:++_2048.tileId, value:nv, merged:true };
      merged[nr][nc] = true; _2048.score += nv; mergeCount++;
      anims.push({ fromR:r, fromC:c, toR:nr, toC:nc, tile:_2048.tiles[r][c], merge:true, newValue:nv });
    } else {
      newGrid[nr][nc] = val; newTiles[nr][nc] = _2048.tiles[r][c];
      anims.push({ fromR:r, fromC:c, toR:nr, toC:nc, tile:_2048.tiles[r][c], merge:false });
    }
  }

  let changed = false;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (newGrid[r][c] !== prevGrid[r][c]) changed = true;
  if (!changed) { _2048_sfx.invalid(); _2048.boardEl.classList.add('shake'); setTimeout(() => _2048.boardEl.classList.remove('shake'), 220); return; }

  _2048.prevState = { grid:prevGrid, tiles:prevTiles, score:prevScore };
  _2048.grid = newGrid; _2048.tiles = newTiles; _2048.animating = true; _2048_sfx.move();

  const now = Date.now();
  if (mergeCount > 0) { _2048.combo = (now - _2048.lastMergeTime < 1200) ? _2048.combo + mergeCount : mergeCount; _2048.lastMergeTime = now; }
  else if (now - _2048.lastMergeTime > 1500) _2048.combo = 0;
  const comboEl = document.getElementById('mg2048ComboCount');
  if (comboEl) comboEl.textContent = _2048.combo >= 2 ? '×' + _2048.combo : '-';

  _2048.bombCounter++;
  let shouldBomb = false;
  const bStart = _2048.cfg.bombStartTurn, bMax = _2048.cfg.bombMaxChance / 100;
  if (_2048.bombCounter >= bStart) {
    const chance = Math.min(0.15 + (_2048.bombCounter - bStart) * 0.1, bMax);
    if (Math.random() < chance) shouldBomb = true;
  }

  const { cs } = _2048_cellMetrics();
  _2048.tileLayer.innerHTML = '';
  const els = new Map();
  for (const a of anims) { if (!a.tile || els.has(a.tile.id)) continue; const el = _2048_makeTileEl(a.tile, a.fromR, a.fromC, cs); els.set(a.tile.id, el); _2048.tileLayer.appendChild(el); }
  void _2048.tileLayer.offsetHeight;
  for (const a of anims) { const el = els.get(a.tile?.id); if (!el) continue; const { left, top } = _2048_cellPos(a.toR, a.toC); el.style.left = left + 'px'; el.style.top = top + 'px'; }

  setTimeout(() => {
    _2048.tileLayer.innerHTML = '';
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      const t = _2048.tiles[r][c]; if (!t) continue;
      const el = _2048_makeTileEl(t, r, c, cs);
      if (t.merged) {
        el.classList.add('merging'); t.merged = false;
        _2048_sfx.merge(t.value); _2048_particles(r, c, t.value, 'merge'); _2048_scoreFloat(r, c, t.value);
        // 🌰 도토리 드롭 확률 체크
        if (Math.random() * 100 < _2048.cfg.dropChance) {
          const drop = _2048.cfg.dropMin + Math.floor(Math.random() * (_2048.cfg.dropMax - _2048.cfg.dropMin + 1));
          _2048.acornDropped += drop;
          _2048_acornFloat(r, c, drop);
          const acornEl = document.getElementById('mg2048AcornCount');
          if (acornEl) acornEl.textContent = '🌰 ' + _2048.acornDropped;
        }
      }
      _2048.tileLayer.appendChild(el);
    }
    _2048.scoreEl.textContent = _2048.score; _2048_updateBest();
    for (const [br, bc] of bombCancels) { _2048_sfx.bombCancel(); _2048_particles(br, bc, 0, 'bomb'); _2048_ring(br, bc); _2048_defuseText(br, bc); _2048_addTime(_2048.cfg.defuseBonus); }
    if (_2048.combo >= 2) { _2048_addTime(_2048.combo * _2048.cfg.comboBonus); _2048_comboText(_2048.combo); _2048_sfx.combo(_2048.combo); }

    setTimeout(() => {
      const sp = _2048_spawnTile();
      if (sp) { const [sr,sc] = sp; const t = _2048.tiles[sr][sc]; const el = _2048_makeTileEl(t, sr, sc, cs); el.classList.add('spawning'); t.spawned = false; _2048.tileLayer.appendChild(el); _2048_sfx.spawn(); }
      if (shouldBomb) { const bp = _2048_spawnBomb(); if (bp) { _2048.bombCounter = 0; const [br,bc] = bp; const bt = _2048.tiles[br][bc]; const bel = _2048_makeTileEl(bt, br, bc, cs); bel.classList.add('bomb-enter'); _2048.tileLayer.appendChild(bel); _2048_sfx.bombIn(); } }
      _2048.animating = false;
      if (_2048_isGameOver()) _2048_endGame('GAME OVER', '보드가 꽉 찼어요!');
    }, 70);
  }, 140);
}

// ── Effects ──
function _2048_particles(r, c, value, type) {
  const { left, top, size } = _2048_cellPos(r, c), cx = left + size / 2, cy = top + size / 2;
  const isBomb = type === 'bomb';
  const colors = isBomb ? ['#06b6d4','#ef4444','#f59e0b','#fff','#f97316'] : ['#ef4444','#f59e0b','#fbbf24','#fff','#22c55e'];
  const count = isBomb ? 14 : Math.min(5 + Math.log2(Math.max(value, 2)), 12);
  const maxDist = isBomb ? 45 : 30, dur = isBomb ? 550 : 420;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div'); p.className = 'mg2048-particle';
    const angle = (Math.PI * 2 / count) * i + Math.random() * .4, dist = 16 + Math.random() * maxDist;
    p.style.left = cx + 'px'; p.style.top = cy + 'px';
    p.style.setProperty('--dx', Math.cos(angle) * dist + 'px'); p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
    p.style.setProperty('--dur', dur + 'ms'); p.style.background = colors[Math.floor(Math.random() * colors.length)];
    const s = isBomb ? 4 + Math.random() * 5 : 3 + Math.random() * 3; p.style.width = s + 'px'; p.style.height = s + 'px';
    _2048.tileLayer.appendChild(p); setTimeout(() => p.remove(), dur);
  }
}
function _2048_ring(r, c) { const { left, top, size } = _2048_cellPos(r, c); const ring = document.createElement('div'); ring.className = 'mg2048-ring'; ring.style.left = (left + size / 2) + 'px'; ring.style.top = (top + size / 2) + 'px'; _2048.tileLayer.appendChild(ring); setTimeout(() => ring.remove(), 500); }
function _2048_scoreFloat(r, c, v) { const { left, top, size } = _2048_cellPos(r, c); const el = document.createElement('div'); el.className = 'mg2048-float'; el.textContent = '+' + v; el.style.left = (left + size / 2 - 16) + 'px'; el.style.top = (top - 4) + 'px'; _2048.tileLayer.appendChild(el); setTimeout(() => el.remove(), 600); }
function _2048_acornFloat(r, c, amount) {
  const { left, top, size } = _2048_cellPos(r, c);
  const el = document.createElement('div');
  el.className = 'mg2048-acorn-drop';
  el.textContent = '🌰+' + amount;
  el.style.left = (left + size / 2 - 20) + 'px';
  el.style.top = (top - 18) + 'px';
  _2048.tileLayer.appendChild(el);
  setTimeout(() => el.remove(), 800);
}
function _2048_comboText(n) { const el = document.createElement('div'); el.className = 'mg2048-combo'; el.textContent = n + 'x COMBO!'; el.style.left = '50%'; el.style.top = '45%'; el.style.transform = 'translate(-50%,-50%)'; _2048.tileLayer.appendChild(el); setTimeout(() => el.remove(), 800); }
function _2048_defuseText(r, c) { const { left, top, size } = _2048_cellPos(r, c); const el = document.createElement('div'); el.className = 'mg2048-defuse'; el.textContent = '💥 DEFUSE!'; el.style.left = (left + size / 2 - 36) + 'px'; el.style.top = (top - 4) + 'px'; _2048.tileLayer.appendChild(el); setTimeout(() => el.remove(), 900); }

// ── State ──
function _2048_isGameOver() {
  const S = _2048.SIZE, BOMB = _2048.BOMB;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    if (!_2048.grid[r][c]) return false;
    const v = _2048.grid[r][c];
    if (v === BOMB) { if (c < S - 1 && _2048.grid[r][c + 1] === BOMB) return false; if (r < S - 1 && _2048.grid[r + 1][c] === BOMB) return false; continue; }
    if (c < S - 1 && _2048.grid[r][c + 1] === v) return false;
    if (r < S - 1 && _2048.grid[r + 1][c] === v) return false;
  }
  return true;
}

// ══════════════════════════════════════════════
//  END → 도토리 상점 보상 연동
// ══════════════════════════════════════════════
function _2048_endGame(title, msg) {
  _2048.running = false; clearInterval(_2048.timerInterval); _2048_bgmStop(); _2048_sfx.timeUp(); _2048_unbindInput();
  const score = _2048.score;
  const reward = _2048.acornDropped;
  try { playSound('gachaResult'); } catch (e) {}

  document.getElementById('minigame-play').innerHTML = `
    <div class="catch-result-screen">
      <div class="clay-card p-6 text-center" style="max-width:360px;margin:0 auto">
        <div style="font-size:4rem;margin-bottom:8px">${title.includes('OVER') ? '💀' : '⏰'}</div>
        <h2 class="font-black text-xl mb-2" style="color:#78350f">${title}</h2>
        <p class="text-sm text-gray-400 font-semibold mb-4">${msg}</p>
        <div class="catch-result-stats">
          <div class="catch-result-stat"><span class="catch-result-num" style="color:#d97706">${score}</span><span class="catch-result-label">최종 점수</span></div>
          <div class="catch-result-stat"><span class="catch-result-num" style="color:#059669">${Math.max(score, _2048_getBest())}</span><span class="catch-result-label">최고 기록</span></div>
          <div class="catch-result-stat"><span class="catch-result-num" style="color:#b45309">${reward}</span><span class="catch-result-label">🌰 획득</span></div>
        </div>
        ${reward > 0 ? `
        <div class="catch-reward-box">
          <span style="font-size:1.8rem">🌰</span>
          <div>
            <p class="font-black" style="color:#78350f;font-size:18px">${reward} 도토리 획득!</p>
            <p class="text-xs" style="color:#b45309;font-weight:700">블록 합칠 때마다 확률적으로 드롭</p>
          </div>
        </div>` : ''}
        <div class="mt-4">
          <button class="btn btn-primary w-full py-3" onclick="_2048_finish(${score},${reward})">확인</button>
        </div>
      </div>
    </div>`;
}

async function _2048_finish(score, reward) {
  await recordPlay('2048', score, reward > 0);

  if (reward > 0) {
    await _giveMinigameReward(reward, score, '2048');
    toast('🌰', `+${reward} 도토리를 받았어요!`);
  } else {
    toast('🎮', '기록이 저장되었습니다');
  }

  document.getElementById('minigame-play').innerHTML = `
    <div class="catch-result-screen">
      <div class="clay-card p-6 text-center" style="max-width:360px;margin:0 auto">
        <div style="font-size:3rem;margin-bottom:8px">${reward > 0 ? '🌰' : '✅'}</div>
        <h2 class="font-black text-lg mb-2" style="color:#78350f">${reward > 0 ? `+${reward} 도토리 획득!` : '기록 저장 완료'}</h2>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-gray flex-1 py-3" onclick="exitMinigame()">돌아가기</button>
          <button class="btn btn-primary flex-1 py-3" onclick="startMinigame('2048')">다시하기</button>
        </div>
      </div>
    </div>`;
}

function _2048_confirmExit() {
  if (_2048.running) {
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">⚠️</div>
      <h2 class="text-lg font-black text-gray-800 mb-2">게임을 종료할까요?</h2>
      <p class="text-sm text-gray-500 mb-4">현재 진행 중인 게임이 끝나고<br>결과 화면으로 이동합니다.</p>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">계속하기</button>
        <button class="btn btn-primary flex-1 py-2" onclick="closeModal();_2048_endGame('GAME OVER','게임을 종료했습니다')">종료하기</button>
      </div>
    </div>`);
  } else exitMinigame();
}
