//  HELPERS
// ──────────────────────────────────────────────

// ── 아바타 렌더링 헬퍼 ──
// user 객체에 profile_icon이 있으면 이미지, 없으면 avatar_emoji 폴백
// size: CSS 크기 (예: '3rem', '40px')
function _avatarHtml(user, size) {
  size = size || '2.5rem';
  if (user?.profile_icon) {
    return '<img src="images/user_profile_icon/' + _escHtml(user.profile_icon) + '" class="avatar-icon" style="width:' + size + ';height:' + size + '" alt="avatar" onerror="this.outerHTML=\'<span class=\\\'avatar-emoji\\\' style=\\\'font-size:' + size + '\\\'>' + (user.avatar_emoji || '🐿️') + '</span>\'">';
  }
  return '<span class="avatar-emoji" style="font-size:' + size + '">' + (user?.avatar_emoji || '🐿️') + '</span>';
}

// profile_icon 총 개수 (선택 UI용)
var PROFILE_ICON_COUNT = 41;

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
  const modal = document.getElementById('modal');
  const wasVisible = !modal.classList.contains('hidden');
  // 이미 열린 상태에서 내용만 교체할 때는 팝 애니메이션 억제
  if (wasVisible) {
    const box = modal.querySelector('.modal-box');
    if (box) box.style.animation = 'none';
  }
  document.getElementById('modalContent').innerHTML = html;
  modal.classList.remove('hidden');
  modal.addEventListener('touchmove', _blockScroll, { passive: false });
  // 새로 열리는 경우 애니메이션 복원 (CSS 기본값 사용)
  if (!wasVisible) {
    const newBox = modal.querySelector('.modal-box');
    if (newBox) newBox.style.animation = '';
  }
}
function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.add('hidden');
  modal.removeEventListener('touchmove', _blockScroll);
  // 모달 내용 비우기 — 잔존 DOM이 상태 판별을 오염시키는 것 방지
  document.getElementById('modalContent').innerHTML = '';
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
//  도토리 전역 유틸
//  - canAfford  : 잔액 체크 (관리자는 항상 true)
//  - spendAcorns: 차감 (관리자는 RPC·잔액 체크 모두 우회)
//  앞으로 모든 도토리 차감은 spendAcorns 사용 → 관리자 자동 우회
// ──────────────────────────────────────────────
function canAfford(amount) {
  if (typeof myProfile === 'undefined') return false;
  if (myProfile?.is_admin) return true;
  return (myProfile.acorns || 0) >= amount;
}

async function spendAcorns(amount, reason) {
  if (myProfile?.is_admin) return { error: null };
  const res = await sb.rpc('adjust_acorns', {
    p_user_id: myProfile.id,
    p_amount: -amount,
    p_reason: reason
  });
  if (!res.error) {
    myProfile.acorns = (myProfile.acorns || 0) - amount;
    if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
  }
  return res;
}
// ──────────────────────────────────────────────
let _deferredInstall = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // 새 서비스워커가 설치되면 자동으로 활성화
      reg.addEventListener('updatefound', () => {
        var newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'activated') {
            // 첫 설치가 아닌 업데이트일 때만 새로고침
            if (navigator.serviceWorker.controller) {
              console.log('[SW] 새 버전 감지 → 자동 새로고침');
              window.location.reload();
            }
          }
        });
      });
      // 주기적으로 업데이트 확인 (30분마다)
      setInterval(() => { reg.update(); }, 30 * 60 * 1000);
    }).catch(() => {});
  });
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

// ── 관리자 공지 팝업 (DB 기반 읽음 처리) ──
var _cachedNotice = null; // 현재 공지 캐시 (알림벨에서 재사용)

async function checkAdminNotice() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'admin_notice').maybeSingle();
    if (!data?.value?.message) { _cachedNotice = null; return; }
    const notice = data.value;
    // id를 항상 문자열로 정규화 (JSONB에서 숫자로 변환되는 문제 방지)
    const noticeId = String(notice.id || '');
    notice.id = noticeId;
    _cachedNotice = notice;

    if (!noticeId) return;

    // 읽음 여부 확인 (localStorage 먼저 — 빠르고 확실)
    var alreadyRead = false;
    try {
      var readIds = JSON.parse(localStorage.getItem('notice_read_ids') || '[]');
      if (readIds.includes(noticeId)) alreadyRead = true;
    } catch(e) {}
    // DB 확인
    if (!alreadyRead) {
      try {
        const { data: readRow, error: readErr } = await sb.from('notice_reads')
          .select('notice_id')
          .eq('user_id', myProfile.id)
          .eq('notice_id', noticeId)
          .maybeSingle();
        if (readErr) console.warn('[notice] DB read check failed:', readErr.message);
        if (readRow) alreadyRead = true;
      } catch(e) { console.warn('[notice] DB read check error:', e); }
    }
    if (alreadyRead) return;

    showModal(`
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:36px;margin-bottom:8px">📢</div>
        <div style="font-size:16px;font-weight:900;color:#1f2937;margin-bottom:12px">공지사항</div>
        <div style="font-size:13px;color:#4b5563;line-height:1.7;white-space:pre-wrap;text-align:left;background:#f9fafb;border-radius:12px;padding:14px;margin-bottom:16px">${notice.message.replace(/</g,'&lt;')}</div>
        <div style="font-size:10px;color:#9ca3af;margin-bottom:12px">${notice.date || ''}</div>
        <button class="btn btn-primary w-full" onclick="markNoticeRead('${noticeId}')">확인</button>
      </div>
    `);
  } catch (e) { console.warn('[notice]', e); }
}

async function markNoticeRead(noticeId) {
  closeModal();
  noticeId = String(noticeId);
  // localStorage에 즉시 저장 (DB 실패해도 팝업 반복 방지)
  try {
    var readIds = JSON.parse(localStorage.getItem('notice_read_ids') || '[]');
    if (!readIds.includes(noticeId)) { readIds.push(noticeId); localStorage.setItem('notice_read_ids', JSON.stringify(readIds)); }
  } catch(e) {}
  // DB에도 저장
  try {
    const { error } = await sb.from('notice_reads')
      .upsert({ user_id: myProfile.id, notice_id: noticeId, read_at: new Date().toISOString() },
              { onConflict: 'user_id,notice_id' });
    if (error) console.warn('[notice-read] DB upsert failed:', error.message);
  } catch (e) { console.warn('[notice-read]', e); }
}

async function adminSaveNotice() {
  const msg = document.getElementById('adminNoticeText')?.value?.trim();
  if (!msg) { toast('⚠️', '공지 내용을 입력하세요'); return; }
  const notice = {
    id: Date.now().toString(),
    message: msg,
    date: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  };
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'admin_notice', value: notice, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) { toast('❌', '공지 저장 실패'); return; }
  toast('✅', '공지가 등록되었어요! 사용자 접속 시 팝업됩니다.');
  document.getElementById('adminNoticeText').value = '';
  adminLoadCurrentNotice();
}

async function adminClearNotice() {
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'admin_notice', value: {}, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (!error) { toast('✅', '공지가 삭제되었어요'); adminLoadCurrentNotice(); }
  else toast('❌', '삭제 실패');
}

// 관리자: 현재 등록된 공지 표시
async function adminLoadCurrentNotice() {
  const el = document.getElementById('adminCurrentNotice');
  if (!el) return;
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'admin_notice').maybeSingle();
    if (!data?.value?.message) {
      el.innerHTML = '<div style="font-size:12px;color:#9ca3af;padding:8px 0">등록된 공지가 없습니다.</div>';
      return;
    }
    const n = data.value;
    el.innerHTML = `
      <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:12px;margin-top:8px">
        <div style="font-size:11px;font-weight:800;color:#92400e;margin-bottom:4px">📌 현재 공지</div>
        <div style="font-size:13px;color:#78350f;white-space:pre-wrap;line-height:1.6">${n.message.replace(/</g,'&lt;')}</div>
        <div style="font-size:10px;color:#b45309;margin-top:6px">${n.date || ''}</div>
      </div>`;
  } catch (e) { el.innerHTML = ''; }
}

// ── 브라우저 알림 ──
function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendBrowserNotif(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: 'images/icons/icon-192.png', tag: 'acorn-' + Date.now() });
  } catch (e) {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, { body, icon: 'images/icons/icon-192.png', tag: 'acorn-' + Date.now() });
      });
    }
  }
}

// ──────────────────────────────────────────────
