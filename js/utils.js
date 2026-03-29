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
  }
}

// (withLock, setBtnLoading, KST 헬퍼 등은 state.js에 포함)
