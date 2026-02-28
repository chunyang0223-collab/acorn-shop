//  HELPERS
// ──────────────────────────────────────────────
const stClass = s => ({ pending:'st-pending', approved:'st-approved', rejected:'st-rejected' })[s] || 'st-pending';
const stLabel = s => ({ pending:'⏳ 대기중', approved:'✅ 승인', rejected:'❌ 거절' })[s] || s;

function fmtTs(iso) {
  if (!iso) return '';
  try {
    const now  = new Date();
    const date = new Date(iso);
    const diff = Math.floor((now - date) / 1000); // 초 단위
    if (diff < 60)   return '방금 전';
    if (diff < 3600) return `${Math.floor(diff/60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff/3600)}시간 전`;
    if (diff < 604800) return `${Math.floor(diff/86400)}일 전`;
    return date.toLocaleString('ko-KR', { timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return iso.slice(0,16).replace('T',' '); }
}

// ── 테마 관리 ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // 도토리 이모지 다크모드 시 어둡게
  const emoji = document.getElementById('headerAcornEmoji');
  if (emoji) emoji.style.filter = theme === 'dark'
    ? 'brightness(0.5) sepia(0.3) drop-shadow(0 2px 6px rgba(0,0,0,0.5))'
    : 'drop-shadow(0 2px 8px rgba(180,100,0,0.25))';
  localStorage.setItem('acornTheme', theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
// 저장된 테마 반영 (기본값: light)
(function() {
  const saved = localStorage.getItem('acornTheme') || 'light';
  applyTheme(saved);
})();

// ── 별 생성 (다크모드용, 35개 랜덤) ──
(function() {
  const COUNT = 23;
  // 별 색상: 흰색, 따뜻한 노랑, 차가운 파랑 계열 섞기
  const COLORS = [
    '#ffffff', '#ffffff', '#ffffff',   // 흰색 (가장 많이)
    '#fffbe8', '#fff5cc', '#ffeea0',   // 노란빛 별
    '#ddeeff', '#cce4ff', '#b8d8ff',   // 파란빛 별
    '#ffe8d0',                          // 주황빛 별 (드물게)
  ];
  for (let i = 0; i < COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'star';
    const size  = (Math.random() * 2.5 + 2).toFixed(1);          // 2~4.5px
    const peak  = (Math.random() * 0.30 + 0.10).toFixed(2);      // 0.10~0.40
    const dur   = (Math.random() * 6 + 4).toFixed(1) + 's';      // 4~10초
    const delay = '-' + (Math.random() * 12).toFixed(1) + 's';   // 0~12초 오프셋
    const top   = (Math.random() * 100).toFixed(1) + 'vh';
    const left  = (Math.random() * 100).toFixed(1) + 'vw';
    const blur  = (Math.random() * 0.8).toFixed(1) + 'px';       // 0~0.8px 번짐
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    el.style.cssText = `width:${size}px;height:${size}px;top:${top};left:${left};--peak:${peak};--dur:${dur};--delay:${delay};filter:blur(${blur});background:${color}`;
    document.body.appendChild(el);
  }
})();

function _blockScroll(e) {
  // 모달 내부 스크롤(.modal-box)은 허용, 오버레이 터치는 차단
  if (!e.target.closest('.modal-box')) e.preventDefault();
}
function showModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').addEventListener('touchmove', _blockScroll, { passive: false });
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').removeEventListener('touchmove', _blockScroll);
}

let _toastT;
function toast(icon, msg, duration = 3000) {
  clearTimeout(_toastT);
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastMsg').textContent  = msg;
  const el = document.getElementById('toast');
  const inner = document.getElementById('toastInner');
  el.classList.remove('hidden');
  if (inner) { inner.style.animation='none'; void inner.offsetWidth; inner.style.animation='toastIn .25s cubic-bezier(.34,1.56,.64,1) both'; }
  _toastT = setTimeout(()=>{ el.classList.add('hidden'); el.style.animation=''; }, duration);
}

// ──────────────────────────────────────────────
//  PWA
// ──────────────────────────────────────────────
let _deferredInstall = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); _deferredInstall = e;
  document.getElementById('installBanner').classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  document.getElementById('installBanner').classList.add('hidden'); _deferredInstall = null;
});
function installPWA() {
  if (!_deferredInstall) return;
  _deferredInstall.prompt();
  _deferredInstall.userChoice.then(r => {
    if (r.outcome === 'accepted') document.getElementById('installBanner').classList.add('hidden');
    _deferredInstall = null;
  });
}

// ──────────────────────────────────────────────
