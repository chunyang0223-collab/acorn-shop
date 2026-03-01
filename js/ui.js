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
    loadMaintenanceSettings().then(renderMaintenanceBtns);
    populateGiveSelect();
    populateLogFilter();
    updateReqBadge();
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

    // 첫 탭(상점)이 점검 중이면 점검 안내 표시, 아니면 정상 렌더
    const maint = window._maintSettings || {};
    if (maint['shop']) {
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
const U_TABS = ['shop','gacha','quest','recycle','minigame','ranking','mypage'];
const A_TABS = ['dashboard','gachaTest','products','quests','requests','txlog','users','events','recycle','minigameSettings','ranking'];

function uTab(tab, btn) {
  U_TABS.forEach(t => document.getElementById('utab-'+t).classList.add('hidden'));
  document.querySelectorAll('#userTabBar .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('utab-'+tab).classList.remove('hidden');
  btn.classList.add('active');
  playSound('tab');

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

  if (maint[tab]) {
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
}

// ── 메뉴 점검 관리 ──
const MAINT_TABS = ['shop','gacha','quest','recycle','minigame','mypage'];

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
  return window._maintSettings;
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

function aTab(tab, btn) {
  playSound('tab');
  A_TABS.forEach(t => { const el = document.getElementById('atab-'+t); if(el) el.classList.add('hidden'); });
  document.querySelectorAll('#adminTabBar .tab-btn').forEach(b => b.classList.remove('active'));
  const tabEl = document.getElementById('atab-'+tab);
  if (tabEl) tabEl.classList.remove('hidden');
  btn.classList.add('active');
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
  if (tab === 'ranking') renderAdminRanking();
}

