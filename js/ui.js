// ──────────────────────────────────────────────
//  UI 초기화
// ──────────────────────────────────────────────
async function initAppUI() {
  document.getElementById('loadingScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');

  if (myProfile.is_admin) {
    document.getElementById('headerUserLabel').textContent = '👑 관리자 모드';
    document.getElementById('headerRight').style.display = 'none';
    document.getElementById('logoutBtn')?.classList.remove('hidden');
    document.getElementById('adminMode').classList.remove('hidden');
    document.getElementById('userMode').classList.add('hidden');
    renderDashboard();
    loadMaintenanceSettings().then(renderMaintenanceBtns).then(renderMaintDots);
    populateAllUsers();
    populateLogFilter();
    updateReqBadge();
    loadAdminPins();
  } else {
    document.getElementById('headerUserLabel').textContent = myProfile.display_name;
    document.getElementById('headerRight').style.display = 'flex';
    document.getElementById('logoutBtn')?.classList.remove('hidden');
    document.getElementById('userMode').classList.remove('hidden');
    document.getElementById('adminMode').classList.add('hidden');
    updateAcornDisplay();
    updateNotifDot();
    await _loadEventsFromDB(); // 이벤트 데이터 DB에서 로드
    await loadMaintenanceSettings(); // 점검 설정 먼저 로드 완료 후
    checkFreeGacha(); // 무료 뽑기 상태 초기화
    checkAdminNotice(); // 공지 확인
    requestNotifPermission(); // 브라우저 알림 권한 요청

    // 첫 탭(상점)이 점검 중이면 점검 안내 표시, 아니면 정상 렌더
    const maint = window._maintSettings || {};
    if (maint['shop'] && !_isMaintBypassed()) {
      const tabEl = document.getElementById('utab-shop');
      Array.from(tabEl.children).forEach(el => {
        el.style.display = 'none';
        el.setAttribute('data-maint-hidden', '1');
      });
      const overlay = document.createElement('div');
      overlay.id = 'maint-overlay-shop';
      overlay.innerHTML = `
        <div class="clay-card p-8 text-center mt-4">
          <div style="font-size:3rem;margin-bottom:12px">🔧</div>
          <p class="text-lg font-black text-gray-700 mb-2">점검 중입니다</p>
          <p class="text-sm text-gray-400">잠시 후 다시 이용해주세요</p>
        </div>`;
      tabEl.prepend(overlay);
    } else {
      renderShop();
      renderShopEventBanner(); // 이벤트 배너
    }
    setTimeout(() => triggerAutoQuest('attendance'), 500);
  }
  // 탭바 드래그 스크롤 초기화 (PC 웹 대응)
  setTimeout(() => {
    initTabBarDragScroll(document.getElementById('userTabBar'));
    initTabBarDragScroll(document.getElementById('adminTabBar'));
  }, 300);
}

function updateAcornDisplay() {
  document.getElementById('headerAcorns').textContent = `🌰 ${myProfile.acorns || 0}`;
  updateTicketDisplay();
  const el = document.getElementById('myAcornVal');
  if (el) el.textContent = myProfile.acorns || 0;
}

async function updateTicketDisplay() {
  const el = document.getElementById('headerTickets');
  if (!el || !myProfile?.id) return;
  // 캐시 있으면 바로 표시
  if (window._gachaTicketCount !== undefined) {
    el.textContent = `🎫 ${window._gachaTicketCount}`;
    return;
  }
  // gacha_tickets 테이블에서 직접 조회
  const { data } = await sb.from('gacha_tickets')
    .select('id,ticket_count').eq('user_id', myProfile.id).maybeSingle();
  window._gachaTicketCount = data?.ticket_count ?? 0;
  el.textContent = `🎫 ${window._gachaTicketCount}`;
}

// ──────────────────────────────────────────────
//  AUTH
// ──────────────────────────────────────────────
async function doEmailLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pw    = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginErr');
  errEl.classList.add('hidden');
  if (!email || !pw) { showErr('이메일과 비밀번호를 입력해주세요'); return; }

  document.getElementById('loginEmail').disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  document.getElementById('loginEmail').disabled = false;
  if (error) { showErr(error.message.includes('Invalid') ? '이메일 또는 비밀번호가 올바르지 않아요' : error.message); }
}

async function doKakaoLogin() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: window.location.href }
  });
  if (error) toast('❌', '카카오 로그인 오류: ' + error.message);
}

async function doLogout() {
  playSound('click');
  await sb.auth.signOut();
}

function showErr(msg) {
  const el = document.getElementById('loginErr');
  el.textContent = '❌ ' + msg;
  el.classList.remove('hidden');
  document.getElementById('loginEmail').classList.add('shake-anim');
  setTimeout(() => document.getElementById('loginEmail').classList.remove('shake-anim'), 500);
}

function showSignup() {
  showModal(`
    <h2 class="text-lg font-black text-gray-800 mb-4">✨ 회원가입</h2>
    <div class="space-y-3">
      <input class="field" type="text" id="su-name" placeholder="이름 (닉네임)">
      <input class="field" type="email" id="su-email" placeholder="이메일">
      <input class="field" type="password" id="su-pw" placeholder="비밀번호 (6자 이상)">
      <div id="su-err" class="hidden text-xs text-red-500 font-bold"></div>
      <button class="btn btn-primary w-full py-3" onclick="doSignup()">가입하기</button>
      <button class="btn btn-gray w-full py-2 text-sm" onclick="closeModal()">취소</button>
    </div>`);
}

async function doSignup() {
  const name  = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const pw    = document.getElementById('su-pw').value;
  const errEl = document.getElementById('su-err');
  if (!name || !email || !pw) { errEl.textContent = '모든 항목을 입력해주세요'; errEl.classList.remove('hidden'); return; }
  if (pw.length < 6) { errEl.textContent = '비밀번호는 6자 이상이어야 해요'; errEl.classList.remove('hidden'); return; }

  const { error } = await sb.auth.signUp({ email, password: pw, options: { data: { full_name: name } } });
  if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
  closeModal();
  toast('✅', '가입 완료! 이메일을 확인해 주세요.');
}

// ──────────────────────────────────────────────
//  TABS
// ──────────────────────────────────────────────
const U_TABS = ['shop','gacha','quest','recycle','minigame','squirrel','ranking','mypage'];
const A_TABS = ['home','dashboard','gachaTest','products','quests','requests','txlog','users','events','recycle','minigameSettings','ranking'];

// ── 관리자 메뉴 정의 (그리드용) ──
const ADMIN_MENU_DEFS = {
  dashboard:        { icon: '📊', label: '현황' },
  requests:         { icon: '📬', label: '신청목록' },
  products:         { icon: '🛍️', label: '상품' },
  gachaTest:        { icon: '🎲', label: '뽑기' },
  quests:           { icon: '📋', label: '퀘스트' },
  recycle:          { icon: '♻️', label: '재활용' },
  events:           { icon: '🎉', label: '이벤트' },
  minigameSettings: { icon: '🎮', label: '미니게임' },
  ranking:          { icon: '🏆', label: '랭킹' },
  txlog:            { icon: '🗂️', label: '로그' },
  users:            { icon: '👥', label: '회원관리' }
};

// 핀 기본값
const DEFAULT_PINS = ['requests', 'users', 'txlog'];
let _adminPins = [...DEFAULT_PINS];

async function loadAdminPins() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'admin_pinned_tabs').maybeSingle();
    if (data?.value?.length) _adminPins = data.value;
  } catch(e) {}
  renderPinTabBar();
}

function renderPinTabBar() {
  for (let i = 0; i < 3; i++) {
    const btn = document.getElementById('pinTab' + (i + 1));
    if (!btn) continue;
    const tabId = _adminPins[i];
    const def = ADMIN_MENU_DEFS[tabId];
    if (def) {
      btn.textContent = def.icon + ' ' + def.label;
      btn.dataset.tab = tabId;
    }
  }
  // 신청 뱃지 동기화
  updateReqBadge();
}

function aTabPin(idx, btn) {
  const tabId = _adminPins[idx];
  if (tabId) aTab(tabId, btn);
}

function aTabGrid(tab) {
  // 그리드 메뉴에서 탭 전환
  const fakeBtn = document.querySelector('.adm-pin-tab.active');
  aTab(tab, fakeBtn);
}

function aTab(tab, btn) {
  playSound('tab');
  A_TABS.forEach(t => { const el = document.getElementById('atab-'+t); if(el) el.classList.add('hidden'); });
  document.querySelectorAll('#adminTabBar .adm-pin-tab').forEach(b => b.classList.remove('active'));

  if (tab === 'home') {
    document.getElementById('atab-home').classList.remove('hidden');
    document.querySelector('#adminTabBar .adm-pin-tab').classList.add('active'); // 홈 버튼
    renderDashboard();
    loadMaintenanceSettings().then(renderMaintDots);
    return;
  }

  const tabEl = document.getElementById('atab-'+tab);
  if (tabEl) tabEl.classList.remove('hidden');

  // 핀 탭 하이라이트
  const pinIdx = _adminPins.indexOf(tab);
  if (pinIdx >= 0) {
    document.getElementById('pinTab' + (pinIdx + 1))?.classList.add('active');
  }

  if (tab === 'dashboard')  { renderDashboard(); loadMaintenanceSettings().then(renderMaintenanceBtns); }
  if (tab === 'gachaTest')  renderAdminGachaProbTable();
  if (tab === 'products')   renderProductAdmin();
  if (tab === 'quests')     renderQuestAdmin();
  if (tab === 'requests')   renderRequestAdmin();
  if (tab === 'txlog')      renderTxLog();
  if (tab === 'users')      renderUserAdmin();
  if (tab === 'events')     { _loadEventsFromDB().then(() => { renderEventAdmin(); renderScheduleList(); }); return; }
  if (tab === 'recycle')    renderRecycleAdmin();
  if (tab === 'minigameSettings') renderMinigameAdmin();
  if (tab === 'squirrelSettings') sqAdminInit();
  if (tab === 'ranking') renderAdminRanking();
}

// ── 점검 상태 도트 (홈 화면용) ──
function renderMaintDots() {
  const m = window._maintSettings || {};
  ['shop','gacha','quest','recycle','minigame','mypage'].forEach(k => {
    const dot = document.getElementById('maint-dot-' + k);
    if (dot) {
      dot.className = 'maint-dot ' + (m[k] ? 'off' : 'on');
    }
  });
}

// ── 탭 편집 모달 ──
function showPinEditor() {
  const allTabs = Object.entries(ADMIN_MENU_DEFS);
  const options = allTabs.map(([id, d]) => {
    const pinIdx = _adminPins.indexOf(id);
    const checked = pinIdx >= 0;
    return `<label class="pin-edit-item ${checked ? 'pinned' : ''}" data-id="${id}">
      <span class="pin-edit-icon">${d.icon}</span>
      <span class="pin-edit-label">${d.label}</span>
      <input type="checkbox" class="pin-edit-check" value="${id}" ${checked ? 'checked' : ''} onchange="onPinCheckChange()">
      <span class="pin-edit-star">${checked ? '★' : '☆'}</span>
    </label>`;
  }).join('');

  showModal(`<div>
    <h2 class="text-lg font-black text-gray-800 mb-2 text-center">⚙️ 탭바 편집</h2>
    <p class="text-xs text-gray-400 font-bold text-center mb-3">최대 3개 메뉴를 탭바에 고정할 수 있어요</p>
    <div class="pin-edit-list">${options}</div>
    <p class="text-xs text-gray-400 font-bold text-center mt-2 mb-3" id="pinEditCount">${_adminPins.length}/3 선택됨</p>
    <div class="flex gap-2">
      <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
      <button class="btn btn-primary flex-1 py-2" onclick="savePinEditor()">저장</button>
    </div>
  </div>`);
}

function onPinCheckChange() {
  const checks = document.querySelectorAll('.pin-edit-check');
  const selected = [];
  checks.forEach(c => { if (c.checked) selected.push(c.value); });

  // 최대 3개 제한
  if (selected.length > 3) {
    event.target.checked = false;
    toast('⚠️', '최대 3개까지 선택 가능합니다');
    return;
  }

  // 별 표시 업데이트
  checks.forEach(c => {
    const item = c.closest('.pin-edit-item');
    const star = item.querySelector('.pin-edit-star');
    if (c.checked) {
      item.classList.add('pinned');
      star.textContent = '★';
    } else {
      item.classList.remove('pinned');
      star.textContent = '☆';
    }
  });

  document.getElementById('pinEditCount').textContent = selected.length + '/3 선택됨';
}

async function savePinEditor() {
  const checks = document.querySelectorAll('.pin-edit-check');
  const selected = [];
  checks.forEach(c => { if (c.checked) selected.push(c.value); });
  if (selected.length === 0) { toast('⚠️', '최소 1개 이상 선택해주세요'); return; }

  closeModal();
  _adminPins = selected;
  renderPinTabBar();

  try {
    const key = 'admin_pinned_tabs';
    const { data } = await sb.from('app_settings').select('key').eq('key', key).maybeSingle();
    if (data) {
      await sb.from('app_settings').update({ value: selected, updated_at: new Date().toISOString() }).eq('key', key);
    } else {
      await sb.from('app_settings').insert({ key, value: selected, updated_at: new Date().toISOString() });
    }
    toast('✅', '탭바 설정 저장됨');
  } catch(e) { toast('❌', '저장 실패: ' + (e.message || e)); }
}

function uTab(tab, btn) {
  U_TABS.forEach(t => document.getElementById('utab-'+t).classList.add('hidden'));
  document.querySelectorAll('#userTabBar .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('utab-'+tab).classList.remove('hidden');
  btn.classList.add('active');
  playSound('tab');

  // 다람쥐 탭이 아닌 곳으로 이동 시 배경음 정지
  if (tab !== 'squirrel' && typeof _sndStopBGM === 'function') {
    _sndStopBGM();
  }

  // 점검 중 확인
  const maint = window._maintSettings || {};
  const tabEl = document.getElementById('utab-'+tab);
  const maintId = 'maint-overlay-'+tab;

  // 기존 오버레이 제거 + 숨겼던 콘텐츠 복원
  const prevOverlay = document.getElementById(maintId);
  if (prevOverlay) {
    prevOverlay.remove();
    tabEl.querySelectorAll('[data-maint-hidden]').forEach(el => {
      el.style.display = '';
      el.removeAttribute('data-maint-hidden');
    });
  }

  if (maint[tab] && !_isMaintBypassed()) {
    // 기존 자식 요소 전부 숨기기
    Array.from(tabEl.children).forEach(el => {
      el.style.display = 'none';
      el.setAttribute('data-maint-hidden', '1');
    });
    // 점검 안내 박스 삽입
    const overlay = document.createElement('div');
    overlay.id = maintId;
    overlay.innerHTML = `
      <div class="clay-card p-8 text-center mt-4">
        <div style="font-size:3rem;margin-bottom:12px">🔧</div>
        <p class="text-lg font-black text-gray-700 mb-2">점검 중입니다</p>
        <p class="text-sm text-gray-400">잠시 후 다시 이용해주세요</p>
      </div>`;
    tabEl.prepend(overlay);
    return;
  }

  if (tab === 'shop')   { renderShop(); triggerAutoQuest('shopVisit'); }
  if (tab === 'gacha')  { renderGachaProbTable(); checkFreeGacha(); }
  if (tab === 'quest')  renderQuests();
  if (tab === 'mypage') renderMypage();
  if (tab === 'recycle') renderRecycleTab();
  if (tab === 'minigame') renderMinigameHub();
  if (tab === 'ranking') renderUserRanking();
  if (tab === 'squirrel') { sqInit(); }
  else if (typeof _sqUnsubscribe === 'function') _sqUnsubscribe();
}

// ── 메뉴 점검 관리 ──
const MAINT_TABS = ['shop','gacha','quest','recycle','minigame','squirrel','mypage'];

async function toggleMaintenance(tab) {
  // 현재 DB 값 읽기
  const { data } = await sb.from('app_settings').select('value').eq('key', 'maintenance').single();
  const maint = data?.value || {};
  maint[tab] = !maint[tab];

  // DB 업데이트
  await sb.from('app_settings').update({ value: maint, updated_at: new Date().toISOString() }).eq('key', 'maintenance');

  // 전역 캐시 갱신
  window._maintSettings = maint;
  renderMaintenanceBtns();
  toast(maint[tab] ? '🔧' : '✅', `${tab} ${maint[tab] ? '점검 중으로 전환' : '정상 운영으로 전환'}`);
}

async function loadMaintenanceSettings() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'maintenance').single();
  window._maintSettings = data?.value || {};
  // 점검 우회 유저 목록 로드
  try {
    const { data: bp } = await sb.from('app_settings').select('value').eq('key', 'maintenance_bypass').maybeSingle();
    window._maintBypass = bp?.value || [];
  } catch(e) { window._maintBypass = []; }
  return window._maintSettings;
}

// 점검 우회 대상인지 확인 (관리자 또는 bypass 목록에 포함)
function _isMaintBypassed() {
  if (myProfile?.is_admin) return true;
  var bypassList = window._maintBypass || [];
  if (!myProfile?.id) return false;
  return bypassList.indexOf(myProfile.id) >= 0;
}

function renderMaintenanceBtns() {
  const maint = window._maintSettings || {};
  MAINT_TABS.forEach(tab => {
    const btn = document.getElementById('maint-'+tab);
    if (!btn) return;
    if (maint[tab]) {
      btn.classList.add('on');
      btn.title = '점검 중 (클릭하여 해제)';
    } else {
      btn.classList.remove('on');
      btn.title = '정상 운영 중 (클릭하여 점검 전환)';
    }
  });
}
