// ──────────────────────────────────────────────
//  버튼 이중클릭 방지 유틸
// ──────────────────────────────────────────────
function btnLock(el, text = '처리 중...') {
  if (!el) return;
  el.dataset.origText = el.textContent;
  el.textContent = text;
  el.classList.add('btn-loading');
  el.disabled = true;
}
function btnUnlock(el) {
  if (!el) return;
  el.textContent = el.dataset.origText || el.textContent;
  el.classList.remove('btn-loading');
  el.disabled = false;
}

// ──────────────────────────────────────────────
//  SOUND SYSTEM (Web Audio API - 외부 파일 없음)
// ──────────────────────────────────────────────
let _audioCtx = null;

// 모바일 여부 감지 → 볼륨 배율 (모바일 +15%)
const _isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const _volMult = _isMobile ? 1.15 : 1.0;

// 첫 터치/클릭 시 AudioContext 생성 (브라우저 자동재생 정책 우회)
function _ensureAudio() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
}
['touchstart', 'mousedown', 'keydown'].forEach(e =>
  document.addEventListener(e, _ensureAudio, { once: false, passive: true })
);

function _playTone(freq, type, duration, vol=0.165) {
  _ensureAudio();
  if (!_audioCtx || _audioCtx.state !== 'running') return;
  try {
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain); gain.connect(_audioCtx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, _audioCtx.currentTime);
    gain.gain.setValueAtTime(vol * _volMult, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + duration);
    osc.start(); osc.stop(_audioCtx.currentTime + duration);
  } catch(e) {}
}

function _playChord(notes, type='sine', duration=0.12, vol=0.132) {
  notes.forEach((f,i) => setTimeout(() => _playTone(f, type, duration, vol), i*60));
}

function playSound(name) {
  if (!_audioCtx) return;
  // 정지된 AudioContext 재개
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  switch(name) {
    case 'click':
      _playTone(880, 'sine', 0.08, 0.11); break;
    case 'tab':
      _playTone(660, 'sine', 0.1, 0.088); break;
    case 'gacha':
      _playChord([261, 329, 392, 523], 'triangle', 0.18, 0.11); break;
    case 'gachaResult':
      _playChord([523, 659, 784, 1047], 'sine', 0.22, 0.132); break;
    case 'reward':
      _playChord([523, 659, 784], 'sine', 0.2, 0.143);
      setTimeout(() => _playChord([784, 1047], 'sine', 0.3, 0.11), 200); break;
    case 'notify':
      _playTone(880, 'sine', 0.12, 0.11);
      setTimeout(() => _playTone(1047, 'sine', 0.15, 0.11), 100); break;
    case 'approve':
      _playChord([523, 659, 784, 1047], 'sine', 0.25, 0.11); break;
    case 'reject':
      _playTone(220, 'sawtooth', 0.2, 0.088); break;
    case 'error':
      _playTone(180, 'square', 0.15, 0.077); break;
    case 'farmBuy':
      // 도토리 톡 — 나무 두드리는 톡 + 반동
      _playTone(800, 'triangle', 0.06, 0.22);
      setTimeout(() => { _playTone(500, 'sine', 0.07, 0.10); }, 70);
      setTimeout(() => { _playTone(300, 'sine', 0.06, 0.06); }, 120);
      break;
    case 'farmSell':
      // 코인 쌓기 — 딸랑딸랑 동전
      [0,1,2,3,4].forEach(i => {
        setTimeout(() => _playTone(1200 + i*200, 'triangle', 0.06, 0.11), i*50);
      });
      break;
    case 'farmError':
      // 잔고 부족 삐-
      _playTone(200, 'square', 0.12, 0.088);
      setTimeout(() => _playTone(180, 'square', 0.12, 0.066), 100);
      break;
    case 'trainDotSuccess':
      // 동그라미 성공 — 맑은 상승 딩
      _playTone(880, 'sine', 0.10, 0.12);
      setTimeout(() => _playTone(1100, 'sine', 0.08, 0.10), 60);
      break;
    case 'trainDotFail':
      // 동그라미 실패 — 짧은 하강 버저
      _playTone(280, 'square', 0.06, 0.10);
      setTimeout(() => _playTone(200, 'square', 0.06, 0.08), 80);
      break;
    case 'trainStart':
      // 훈련 시작 — 힘차게 올라가는 톤
      _playTone(330, 'triangle', 0.08, 0.13);
      setTimeout(() => _playTone(440, 'triangle', 0.08, 0.13), 80);
      setTimeout(() => _playTone(554, 'triangle', 0.10, 0.15), 160);
      break;
    case 'trainPunch':
      // 훈련 중 펀치/타격 — 짧고 강한 타격감
      _playTone(150, 'square', 0.06, 0.18);
      _playTone(80, 'triangle', 0.08, 0.14);
      break;
    case 'trainSuccess':
      // 훈련 성공 — 밝은 팡파레
      _playChord([523, 659, 784], 'sine', 0.15, 0.12);
      setTimeout(() => _playChord([659, 784, 1047], 'sine', 0.20, 0.14), 180);
      setTimeout(() => _playTone(1319, 'sine', 0.30, 0.11), 380);
      break;
    case 'trainFail':
      // 훈련 실패 — 힘 빠지는 하강음
      _playTone(392, 'triangle', 0.12, 0.11);
      setTimeout(() => _playTone(330, 'triangle', 0.12, 0.11), 120);
      setTimeout(() => _playTone(262, 'triangle', 0.18, 0.09), 240);
      break;
    case 'trainGradeUp':
      // 등급 승급 — 화려한 팡파레
      _playChord([523, 659, 784], 'triangle', 0.12, 0.11);
      setTimeout(() => _playChord([659, 784, 1047], 'sine', 0.15, 0.13), 200);
      setTimeout(() => _playChord([784, 1047, 1319], 'sine', 0.18, 0.14), 400);
      setTimeout(() => _playTone(1568, 'sine', 0.35, 0.12), 600);
      break;

    // ── 🐿️ 다람쥐 도둑 ──
    case 'stCast':
      // 낚싯대 던지기 — 줄이 날아가는 휘이잉 + 풍덩
      _playTone(600, 'sine', 0.08, 0.10);
      setTimeout(() => _playTone(400, 'sine', 0.06, 0.08), 60);
      setTimeout(() => _playTone(250, 'triangle', 0.12, 0.12), 140);
      break;
    case 'stBite':
      // 찌 반응 — 긴급 알림 딩딩딩
      [0, 1, 2].forEach(i =>
        setTimeout(() => _playTone(1200, 'sine', 0.06, 0.16), i * 90)
      );
      break;
    case 'stCatch':
      // 낚시 성공 — 통통 튀는 물고기 + 팡파레
      _playTone(500, 'triangle', 0.06, 0.14);
      setTimeout(() => _playTone(700, 'triangle', 0.06, 0.14), 80);
      setTimeout(() => _playChord([784, 988, 1175], 'sine', 0.18, 0.12), 180);
      break;
    case 'stMiss':
      // 낚시 실패 — 줄이 풀리는 느낌
      _playTone(400, 'sine', 0.08, 0.10);
      setTimeout(() => _playTone(300, 'sine', 0.10, 0.08), 80);
      setTimeout(() => _playTone(200, 'sine', 0.14, 0.06), 170);
      break;
    case 'stBlockPlace':
      // 블록 슬롯 배치 — 나무블록 딸깍
      _playTone(800, 'triangle', 0.04, 0.14);
      setTimeout(() => _playTone(1000, 'triangle', 0.03, 0.10), 40);
      break;
    case 'stBlockRemove':
      // 블록 슬롯 제거 — 부드러운 빠짐
      _playTone(600, 'triangle', 0.04, 0.08);
      break;
    case 'stWordSuccess':
      // 단어 완성 — 밝은 상승 코드 + 별 반짝
      _playChord([523, 659, 784], 'sine', 0.12, 0.12);
      setTimeout(() => _playChord([659, 784, 1047], 'sine', 0.16, 0.13), 160);
      setTimeout(() => _playTone(1319, 'sine', 0.22, 0.10), 340);
      break;
    case 'stWordFail':
      // 단어 검증 실패 — 짧은 버저
      _playTone(250, 'sawtooth', 0.12, 0.10);
      setTimeout(() => _playTone(200, 'sawtooth', 0.14, 0.08), 100);
      break;
    case 'stDispatchStart':
      // 다람쥐 출정 — 달려가는 느낌 상승음
      [0, 1, 2, 3].forEach(i =>
        setTimeout(() => _playTone(400 + i * 120, 'triangle', 0.06, 0.11), i * 70)
      );
      break;
    case 'stStealSuccess':
      // 도둑 성공 — 쓱 훔치는 느낌 + 짧은 축하
      _playTone(600, 'triangle', 0.05, 0.12);
      setTimeout(() => _playTone(900, 'triangle', 0.05, 0.12), 60);
      setTimeout(() => _playChord([784, 988], 'sine', 0.12, 0.10), 140);
      break;
    case 'stStealFail':
      // 도둑 실패 — 미끄러지는 하강음
      _playTone(500, 'triangle', 0.06, 0.10);
      setTimeout(() => _playTone(350, 'triangle', 0.08, 0.08), 70);
      setTimeout(() => _playTone(250, 'triangle', 0.10, 0.06), 150);
      break;
    case 'stStealFound':
      // 블록 발견 — 짧은 핑
      _playTone(880, 'sine', 0.06, 0.10);
      break;
    case 'stStealNotFound':
      // 블록 못 찾음 — 작은 실망음
      _playTone(350, 'sine', 0.08, 0.07);
      break;
    case 'stPocketFull':
      // 주머니 가득 참 — 묵직한 톤
      _playTone(300, 'triangle', 0.10, 0.13);
      setTimeout(() => _playTone(280, 'triangle', 0.12, 0.10), 100);
      break;
    case 'stPurchase':
      // 상점 구매 — 동전 + 블록 획득
      _playTone(1000, 'triangle', 0.05, 0.11);
      setTimeout(() => _playTone(1200, 'triangle', 0.05, 0.11), 60);
      setTimeout(() => _playChord([784, 988], 'sine', 0.10, 0.10), 140);
      break;
    case 'stRanking':
      // 정산/순위 공개 — 두구두구 + 팡파레
      [0, 1, 2, 3, 4, 5].forEach(i =>
        setTimeout(() => _playTone(200 + i * 10, 'triangle', 0.05, 0.08 + i * 0.01), i * 80)
      );
      setTimeout(() => _playChord([523, 659, 784, 1047], 'sine', 0.25, 0.14), 550);
      setTimeout(() => _playTone(1319, 'sine', 0.35, 0.12), 800);
      break;
  }
}

// (withLock, setBtnLoading, KST 헬퍼 등은 state.js에 포함)
