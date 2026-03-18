// ──────────────────────────────────────────────
//  앱 시작
// ──────────────────────────────────────────────
async function boot() {
  // ── OAuth 콜백 처리 (카카오 로그인 후 URL 해시에서 토큰 파싱) ──
  const hash = window.location.hash;
  if (hash && hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    const access_token = params.get('access_token');

    if (access_token) {
      // JWT payload에서 userId 파싱 (카카오 OAuth는 URL에 user 객체를 안 줌)
      let userId = '';
      try {
        const rawUser = params.get('user');
        if (rawUser) {
          userId = JSON.parse(rawUser).id;
        } else {
          const payload = JSON.parse(atob(access_token.split('.')[1]));
          userId = payload.sub;
        }
      } catch(e) { userId = 'oauth_user'; }

      const sessionData = {
        access_token,
        refresh_token: params.get('refresh_token'),
        expires_at: Math.floor(Date.now() / 1000) + parseInt(params.get('expires_in') || '3600'),
        user: { id: userId, email: 'kakao_user' }
      };
      localStorage.setItem('sb_session', JSON.stringify(sessionData));
      window.history.replaceState(null, null, window.location.pathname);
      window.location.reload(); // 세션 저장 후 새로고침해야 getSession()이 정상 동작
      return;
    }
  }

  // Auth 상태 변경 구독
  sb.auth.onAuthStateChange(async (event, s) => {
    session = s;
    if (s && s.user) {
      await onSignedIn(s);
    } else if (event === 'SIGNED_OUT') {
      showLoginScreen();
    }
  });

  // 현재 세션 확인
  const { data } = await sb.auth.getSession();
  if (data && data.session && data.session.user) {
    await onSignedIn(data.session);
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('loadingScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  // 마지막 로그인 이메일 자동 입력
  const saved = localStorage.getItem('dotori_last_email');
  if (saved) { const el = document.getElementById('loginEmail'); if(el) el.value = saved; }
}

async function onSignedIn(s) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('loadingScreen').classList.remove('hidden');

  try {
    // 프로필 로드 (없으면 생성)
    let { data: profile, error } = await sb.from('users').select('*').eq('id', s.user.id).single();
    if (error || !profile) {
      // 트리거가 이미 생성했지만 혹시 없으면 수동 생성
      const email = s.user.email || '';
      const name  = s.user.user_metadata?.full_name || s.user.user_metadata?.name || email.split('@')[0] || '사용자';
      const { data: created } = await sb.from('users').upsert({
        id: s.user.id, display_name: name, acorns: 0, is_admin: false
      }).select().single();
      profile = created;
    }
    myProfile = profile;

    // 마지막 접속 시간 기록 — fetch 직접 호출로 확실히 전송
    try {
      const _tok = s.access_token || SUPABASE_KEY;
      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${s.user.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + _tok,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_seen_at: new Date().toISOString() })
      });
    } catch(e) { /* 접속 기록 실패해도 앱 진행 */ }

    // 뽑기 풀 로드
    const { data: gi } = await sb.from('gacha_items').select('*').eq('active', true);
    gachaPool = gi || [];

    // 실시간 구독
    setupRealtime();

    // UI 초기화
    initAppUI();
  } catch (err) {
    console.error('onSignedIn error:', err);
    toast('❌', '로그인 처리 중 오류가 발생했어요');
    showLoginScreen();
  }
}

// ──────────────────────────────────────────────
//  실시간 구독
// ──────────────────────────────────────────────
// Realtime: 폴링 방식 (WebSocket 없이 주기적 동기화)
let _pollTimer = null;
let _lastNotifCount = 0;
let _lastReqCount = 0;
let _lastReqRemindAt = 0;   // 마지막 재알림 시각 (ms)
const REQ_REMIND_INTERVAL = 3 * 60 * 1000; // 3분

async function _pollSync() {
  if (!myProfile) return;
  const token = session?.access_token || SUPABASE_KEY;
  const h = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token };

  try {
    // 내 잔액 동기화
    const ur = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${myProfile.id}&select=acorns`, { headers: h });
    const ud = await ur.json();
    if (ud?.[0] && ud[0].acorns !== myProfile.acorns) {
      myProfile.acorns = ud[0].acorns;
      updateAcornDisplay();
      playSound('reward');
    }

    // 새 알림 확인
    const nr = await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${myProfile.id}&select=id&order=created_at.desc`, { headers: h });
    const nd = await nr.json();
    if (Array.isArray(nd) && nd.length > _lastNotifCount) {
      if (_lastNotifCount > 0) { playSound('notify'); }
      _lastNotifCount = nd.length;
      updateNotifDot();
    }

    // 관리자: 신청 개수 확인
    if (myProfile.is_admin) {
      const rr = await fetch(`${SUPABASE_URL}/rest/v1/product_requests?status=eq.pending&select=id`, { headers: h });
      const rd = await rr.json();
      if (Array.isArray(rd)) {
        const cnt = rd.length;
        // 배지 업데이트
        const badge = document.getElementById('reqBadge');
        if (badge) {
          if (cnt > 0) {
            badge.textContent = cnt > 9 ? '9+' : cnt;
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
          }
        }
        if (cnt !== _lastReqCount) {
          _lastReqCount = cnt;
          if (!document.getElementById('atab-requests').classList.contains('hidden')) renderRequestAdmin();
          // 새 신청 도착 시 즉시 알림
          if (cnt > 0) {
            sendBrowserNotif(`📬 미처리 신청 ${cnt}건`, '확인이 필요한 신청이 있어요!');
            _lastReqRemindAt = Date.now();
          }
        }
        // 3분마다 재알림 (pending 신청이 있는데 처리 안 됐을 때)
        if (cnt > 0 && Date.now() - _lastReqRemindAt >= REQ_REMIND_INTERVAL) {
          playSound('notify');
          sendBrowserNotif(`📬 미처리 신청 ${cnt}건`, `${cnt}건의 신청이 아직 처리되지 않았어요. 확인해주세요!`);
          _lastReqRemindAt = Date.now();
        }
      }
    }
  } catch(e) {
    console.warn('[pollSync] 동기화 실패:', e.message || e);
  }
}

function setupRealtime() {
  // 15초마다 폴링 (탭 활성 시에만)
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') _pollSync();
  }, 15000);

  // 탭 복귀 시 세션 체크 → 성공: 현재 탭 갱신 / 실패: 전체 새로고침
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !myProfile) return;
    try {
      var { data } = await sb.auth.getSession();
      if (data?.session) {
        // 세션 유효 → 현재 탭만 갱신
        _pollSync();
        _refreshActiveTab();
      } else {
        // 세션 만료 → 전체 새로고침
        console.warn('[visibility] 세션 만료 → 새로고침');
        window.location.reload();
      }
    } catch(e) {
      console.warn('[visibility] 세션 체크 실패 → 새로고침');
      window.location.reload();
    }
  });
}

// 현재 활성 탭의 데이터를 다시 로드
function _refreshActiveTab() {
  try {
    var tabs = ['shop','gacha','quest','mypage','recycle','minigame','ranking','squirrel'];
    var activeTab = null;
    for (var i = 0; i < tabs.length; i++) {
      var el = document.getElementById('utab-' + tabs[i]);
      if (el && !el.classList.contains('hidden')) { activeTab = tabs[i]; break; }
    }
    if (!activeTab) return;

    if (activeTab === 'shop' && typeof renderShop === 'function') renderShop();
    else if (activeTab === 'gacha' && typeof renderGachaProbTable === 'function') { renderGachaProbTable(); checkFreeGacha(); }
    else if (activeTab === 'quest' && typeof renderQuests === 'function') renderQuests();
    else if (activeTab === 'mypage' && typeof renderMypage === 'function') renderMypage();
    else if (activeTab === 'recycle' && typeof renderRecycleTab === 'function') renderRecycleTab();
    else if (activeTab === 'minigame' && typeof renderMinigameHub === 'function') renderMinigameHub();
    else if (activeTab === 'squirrel' && typeof sqInit === 'function') sqInit();
  } catch(e) { console.warn('[refreshTab]', e); }
}

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
  if (typeof _sndStopBGM === 'function') _sndStopBGM();
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

