/* ================================================================
   🤝 친구 시스템 (friend.js)
   ================================================================
   - 친구 검색 / 요청 / 수락 / 거절 / 삭제
   - 친구 목록 렌더
   - 받은 요청 목록
   ================================================================ */

// ── 전역 상태 ──
var _friendList = [];     // accepted 친구 목록
var _friendRequests = []; // 받은 요청 (pending)
var _friendSentReqs = []; // 보낸 요청 (pending)

// ── 친구 탭 초기화 ──
async function friendInit() {
  const area = document.getElementById('utab-friend');
  if (!area) return;
  try {
    await Promise.all([_loadFriends(), _loadFriendRequests()]);
  } catch (e) {
    console.warn('friendInit: DB 로드 실패 (테이블 미생성?)', e);
    _friendList = [];
    _friendRequests = [];
    _friendSentReqs = [];
  }
  _renderFriendTab();
}

// ── 데이터 로드 ──
async function _loadFriends() {
  try {
    const uid = myProfile.id;
    const { data, error } = await sb.from('friends')
      .select('id, requester_id, receiver_id, accepted_at, requester:users!friends_requester_id_fkey(id,display_name,avatar_emoji,acorns), receiver:users!friends_receiver_id_fkey(id,display_name,avatar_emoji,acorns)')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${uid},receiver_id.eq.${uid}`)
      .order('accepted_at', { ascending: false });
    if (error) { console.warn('_loadFriends error:', error); _friendList = []; return; }
    _friendList = (data || []).map(f => {
      const isMeReq = f.requester_id === uid;
      const friend = isMeReq ? f.receiver : f.requester;
      return { friendshipId: f.id, ...friend, accepted_at: f.accepted_at };
    });
  } catch (e) {
    console.warn('_loadFriends exception:', e);
    _friendList = [];
  }
}

async function _loadFriendRequests() {
  try {
    const uid = myProfile.id;
    // 받은 요청
    const { data: received, error: err1 } = await sb.from('friends')
      .select('id, requester_id, created_at, requester:users!friends_requester_id_fkey(id,display_name,avatar_emoji)')
      .eq('receiver_id', uid).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (err1) console.warn('_loadFriendRequests received error:', err1);
    _friendRequests = received || [];

    // 보낸 요청
    const { data: sent, error: err2 } = await sb.from('friends')
      .select('id, receiver_id, created_at, receiver:users!friends_receiver_id_fkey(id,display_name,avatar_emoji)')
      .eq('requester_id', uid).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (err2) console.warn('_loadFriendRequests sent error:', err2);
    _friendSentReqs = sent || [];
  } catch (e) {
    console.warn('_loadFriendRequests exception:', e);
    _friendRequests = [];
    _friendSentReqs = [];
  }
}

// ── 메인 렌더 ──
function _renderFriendTab() {
  const area = document.getElementById('friendContent');
  if (!area) return;

  const reqCount = _friendRequests.length;
  const reqBadge = reqCount > 0 ? `<span class="fr-req-badge">${reqCount}</span>` : '';

  area.innerHTML = `
    <!-- 검색 바 -->
    <div class="fr-search-wrap clay-card p-4 mb-4">
      <p class="text-sm font-black mb-2" style="color:var(--text-primary,#1f2937)">🔍 친구 찾기</p>
      <div class="flex gap-2">
        <input class="field flex-1" type="text" id="friendSearchInput" placeholder="닉네임으로 검색..." onkeydown="if(event.key==='Enter')searchFriend()">
        <button class="btn btn-primary px-4" onclick="searchFriend()">검색</button>
      </div>
      <div id="friendSearchResult" class="mt-3"></div>
    </div>

    <!-- 받은 요청 -->
    ${reqCount > 0 ? `
    <div class="clay-card p-4 mb-4">
      <p class="text-sm font-black mb-3" style="color:var(--text-primary,#1f2937)">📬 받은 요청 ${reqBadge}</p>
      <div class="space-y-2" id="friendReqList">
        ${_friendRequests.map(r => `
          <div class="fr-req-row">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-xl">${r.requester?.avatar_emoji || '🐿️'}</span>
              <div class="min-w-0">
                <p class="text-sm font-black truncate" style="color:var(--text-primary,#1f2937)">${_escHtml(r.requester?.display_name || '???')}</p>
                <p class="text-xs" style="color:#fbbf24">${fmtTs(r.created_at)}</p>
              </div>
            </div>
            <div class="flex gap-1 shrink-0">
              <button class="fr-accept-btn" onclick="acceptFriend('${r.id}')">수락</button>
              <button class="fr-reject-btn" onclick="rejectFriend('${r.id}')">거절</button>
            </div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- 보낸 요청 -->
    ${_friendSentReqs.length > 0 ? `
    <div class="clay-card p-4 mb-4">
      <p class="text-sm font-black mb-3" style="color:var(--text-primary,#1f2937)">📤 보낸 요청</p>
      <div class="space-y-2">
        ${_friendSentReqs.map(r => `
          <div class="fr-req-row">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-xl">${r.receiver?.avatar_emoji || '🐿️'}</span>
              <p class="text-sm font-black truncate" style="color:var(--text-primary,#1f2937)">${_escHtml(r.receiver?.display_name || '???')}</p>
            </div>
            <button class="fr-cancel-btn" onclick="cancelFriendReq('${r.id}')">취소</button>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- 친구 목록 -->
    <div class="clay-card p-4">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm font-black" style="color:var(--text-primary,#1f2937)">👥 친구 목록 <span style="color:#fbbf24">(${_friendList.length}명)</span></p>
      </div>
      ${_friendList.length === 0
        ? '<p class="text-sm text-center py-6" style="color:#fbbf24">아직 친구가 없어요. 위에서 검색해서 추가해보세요!</p>'
        : `<div class="space-y-2">
            ${_friendList.map(f => `
              <div class="fr-friend-row" onclick="openProfile('${f.id}')">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="text-2xl">${f.avatar_emoji || '🐿️'}</span>
                  <div class="min-w-0">
                    <p class="text-sm font-black truncate" style="color:var(--text-primary,#1f2937)">${_escHtml(f.display_name || '???')}</p>
                    <p class="text-xs" style="color:#86efac">🌰 ${f.acorns ?? 0}</p>
                  </div>
                </div>
                <span class="text-xs" style="color:#fbbf24">프로필 →</span>
              </div>`).join('')}
          </div>`}
    </div>`;

  _updateFriendBadge();
}

// ── 친구 요청 뱃지 (탭바) ──
function _updateFriendBadge() {
  const dot = document.getElementById('friendReqDot');
  if (dot) dot.classList.toggle('hidden', _friendRequests.length === 0);
}

// ── 친구 검색 ──
async function searchFriend() {
  const input = document.getElementById('friendSearchInput');
  const resultEl = document.getElementById('friendSearchResult');
  if (!input || !resultEl) return;
  const query = input.value.trim();
  if (!query) { resultEl.innerHTML = ''; return; }

  resultEl.innerHTML = '<p class="text-xs" style="color:#fbbf24">검색 중...</p>';

  const { data } = await sb.from('users')
    .select('id, display_name, avatar_emoji')
    .ilike('display_name', `%${query}%`)
    .neq('id', myProfile.id)
    .limit(10);

  if (!data || data.length === 0) {
    resultEl.innerHTML = '<p class="text-xs" style="color:#fbbf24">검색 결과가 없어요</p>';
    return;
  }

  // 이미 친구인지, 요청 보냈는지 체크
  const friendIds = new Set(_friendList.map(f => f.id));
  const sentIds = new Set(_friendSentReqs.map(r => r.receiver_id));
  const recvIds = new Set(_friendRequests.map(r => r.requester_id));

  resultEl.innerHTML = data.map(u => {
    const isFriend = friendIds.has(u.id);
    const isSent = sentIds.has(u.id);
    const isRecv = recvIds.has(u.id);
    let actionBtn = '';
    if (isFriend) {
      actionBtn = `<span class="text-xs font-bold" style="color:#4ade80">✓ 친구</span>`;
    } else if (isSent) {
      actionBtn = `<span class="text-xs font-bold" style="color:#fbbf24">요청 중</span>`;
    } else if (isRecv) {
      actionBtn = `<span class="text-xs font-bold" style="color:#fbbf24">요청 받음</span>`;
    } else {
      actionBtn = `<button class="fr-add-btn" onclick="sendFriendReq('${u.id}',this)">친구 추가</button>`;
    }
    return `
      <div class="fr-search-row">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xl">${u.avatar_emoji || '🐿️'}</span>
          <p class="text-sm font-black truncate" style="color:var(--text-primary,#1f2937)">${_escHtml(u.display_name || '???')}</p>
        </div>
        ${actionBtn}
      </div>`;
  }).join('');
}

// ── 친구 요청 보내기 ──
async function sendFriendReq(targetId, btnEl) {
  if (btnEl) setBtnLoading(btnEl, true);
  const { error } = await sb.from('friends')
    .insert({ requester_id: myProfile.id, receiver_id: targetId });
  if (error) {
    toast('❌', error.message.includes('duplicate') ? '이미 요청을 보냈어요' : '요청 실패');
    if (btnEl) setBtnLoading(btnEl, false, '친구 추가');
    return;
  }
  toast('✅', '친구 요청을 보냈어요!');
  // 알림 보내기
  if (typeof pushNotif === 'function') {
    pushNotif(targetId, 'reward', '🤝 친구 요청', `${myProfile.display_name}님이 친구 요청을 보냈어요!`);
  }
  await _loadFriendRequests();
  _renderFriendTab();
}

// ── 수락 ──
async function acceptFriend(friendshipId) {
  const { error } = await sb.from('friends')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', friendshipId);
  if (error) { toast('❌', '수락 실패'); return; }
  toast('🎉', '친구가 되었어요!');
  // 요청자에게 알림
  const req = _friendRequests.find(r => r.id === friendshipId);
  if (req && typeof pushNotif === 'function') {
    pushNotif(req.requester_id, 'reward', '🤝 친구 수락', `${myProfile.display_name}님이 친구 요청을 수락했어요!`);
  }
  await Promise.all([_loadFriends(), _loadFriendRequests()]);
  _renderFriendTab();
}

// ── 거절 ──
async function rejectFriend(friendshipId) {
  await sb.from('friends').delete().eq('id', friendshipId);
  toast('👋', '요청을 거절했어요');
  await _loadFriendRequests();
  _renderFriendTab();
}

// ── 요청 취소 ──
async function cancelFriendReq(friendshipId) {
  await sb.from('friends').delete().eq('id', friendshipId);
  toast('🗑️', '요청을 취소했어요');
  await _loadFriendRequests();
  _renderFriendTab();
}

// ── 친구 삭제 ──
async function removeFriend(friendshipId) {
  showModal(`
    <div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">😢</div>
      <p class="text-sm font-black mb-3" style="color:var(--text-primary,#1f2937)">정말 친구를 삭제할까요?</p>
      <div class="flex gap-2 mt-3">
        <button class="btn flex-1" style="background:#fee2e2;color:#dc2626;font-weight:800" onclick="confirmRemoveFriend('${friendshipId}')">삭제</button>
        <button class="btn flex-1" onclick="closeModal()">취소</button>
      </div>
    </div>`);
}

async function confirmRemoveFriend(friendshipId) {
  closeModal();
  await sb.from('friends').delete().eq('id', friendshipId);
  toast('👋', '친구를 삭제했어요');
  await _loadFriends();
  _renderFriendTab();
}

// ── HTML 이스케이프 ──
function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
