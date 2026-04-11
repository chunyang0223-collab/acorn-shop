// ──────────────────────────────────────────────
//  NOTIFICATIONS
// ──────────────────────────────────────────────
async function pushNotif(userId, type, title, body) {
  await sb.from('notifications').insert({ user_id: userId, type, title, body });
}

async function updateReqBadge() {
  if (!myProfile?.is_admin) return;
  try {
    const { data } = await sb.from('product_requests').select('id').eq('status', 'pending');
    const cnt = data?.length || 0;
    const show = cnt > 0;
    const label = cnt > 9 ? '9+' : String(cnt);

    // 탭바 뱃지
    const tabBadge = document.getElementById('reqBadgeTab');
    if (tabBadge) {
      if (show) { tabBadge.textContent = label; tabBadge.classList.remove('hidden'); }
      else tabBadge.classList.add('hidden');
    }

    // 핀 탭바에 requests가 있으면 뱃지 표시
    const pinIdx = (window._adminPins || []).indexOf('requests');
    if (pinIdx >= 0) {
      const pinBtn = document.getElementById('pinTab' + (pinIdx + 1));
      if (pinBtn) {
        const def = ADMIN_MENU_DEFS?.requests;
        if (def) {
          pinBtn.innerHTML = def.icon + ' ' + def.label + (show ? ` <span class="req-badge">${label}</span>` : '');
        }
      }
    }
  } catch(e) {}
}

async function updateNotifDot() {
  const { count } = await sb.from('notifications').select('*', { count: 'exact', head: true })
    .eq('user_id', myProfile.id).eq('is_read', false);
  const dot = document.getElementById('notifDot');
  const btn = document.getElementById('notifBtn');
  if (dot) dot.classList.toggle('hidden', !count);
  if (btn) btn.classList.toggle('hidden', false);
}

async function showNotifications() {
  // 모달 즉시 열기 → 로딩 느낌 없애기
  showModal(`
    <h2 class="text-lg font-black text-gray-800 mb-3">🔔 알림</h2>
    <div id="notifNoticeArea"></div>
    <div class="notif-scroll" id="notifContent">
      <p class="text-sm text-gray-400 text-center py-6">불러오는 중...</p>
    </div>`);

  // 공지사항 영역 렌더
  _renderNoticeInNotif();

  const typeIcon = { reward:'🎁', quest:'📋', admin:'👑', gachaReward:'🎲', request:'📬', quest_approved:'✅', quest_rejected:'❌' };
  const [{ data: notifs }] = await Promise.all([
    sb.from('notifications').select('*').eq('user_id', myProfile.id).order('created_at', { ascending: false }).limit(20),
    sb.from('notifications').update({ is_read: true }).eq('user_id', myProfile.id).eq('is_read', false)
  ]);
  updateNotifDot();

  const el = document.getElementById('notifContent');
  if (!el) return;
  el.innerHTML = !notifs?.length
    ? '<p class="text-sm text-gray-400 text-center py-6">알림이 없어요</p>'
    : notifs.map(n => `<div class="row-item-bg p-3 rounded-2xl mb-2 flex gap-3">
        <span class="text-xl shrink-0">${typeIcon[n.type]||'🔔'}</span>
        <div><p class="text-sm font-black text-gray-800">${n.title}</p>
          <p class="text-xs text-gray-500 font-semibold" style="word-break:break-word">${n.body}</p>
          <p class="text-xs text-gray-400 mt-1">${fmtTs(n.created_at)}</p>
        </div>
      </div>`).join('');
}

function _renderNoticeInNotif() {
  const area = document.getElementById('notifNoticeArea');
  if (!area) return;
  const notice = typeof _cachedNotice !== 'undefined' ? _cachedNotice : null;
  if (!notice?.message) { area.innerHTML = ''; return; }
  area.innerHTML = `
    <div style="background:var(--bg-amber-subtle);border:1.5px solid var(--border-amber);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:900;color:var(--p-amber-700);margin-bottom:6px">📢 공지사항</div>
      <div style="font-size:13px;color:var(--text-brand);white-space:pre-wrap;line-height:1.6">${notice.message.replace(/</g,'&lt;')}</div>
      <div style="font-size:10px;color:var(--p-amber-600);margin-top:6px">${notice.date || ''}</div>
    </div>`;
}

