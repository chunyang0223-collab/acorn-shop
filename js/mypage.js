// ──────────────────────────────────────────────
//  MYPAGE
// ──────────────────────────────────────────────
// ── 마이페이지 페이지네이션 상태 ──
let _reqPage = 0, _reqItems = [];
let _txPage  = 0, _txItems  = [];
let _glogPage = 0, _glogItems = [];
const PAGE_SIZE_REQ  = 3;  // 상품 신청 현황
const PAGE_SIZE_QCR  = 2;  // 퀘스트 신청 현황
const PAGE_SIZE_TX   = 3;  // 도토리 내역
const PAGE_SIZE_GLOG = 5;  // 뽑기 기록 (session 단위)
const PAGE_SIZE = 5;       // 하위호환

function _renderGlogPage() {
  const el = document.getElementById('myGachaLogList');
  if (!el) return;
  const total = _glogItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const slice = _glogItems.slice(_glogPage * PAGE_SIZE, (_glogPage + 1) * PAGE_SIZE);

  // session 기준으로 그룹화해서 표시
  const sessions = [];
  let lastSession = null;
  for (const g of slice) {
    if (g.session_id !== lastSession) {
      sessions.push({ session_id: g.session_id, created_at: g.created_at, items: [] });
      lastSession = g.session_id;
    }
    sessions[sessions.length - 1].items.push(g);
  }

  const rarityColor = { legendary:'#f59e0b', epic:'#a855f7', rare:'#3b82f6', common:'#6b7280' };

  el.innerHTML = sessions.length
    ? sessions.map(s => `
        <div class="p-3 rounded-2xl bg-gray-50 border border-gray-100">
          <p class="text-xs text-gray-400 mb-2">${fmtTs(s.created_at)} · ${s.items.length}회${s.items[0]?.is_free ? ' 🎁 무료' : ''}</p>
          <div class="flex flex-wrap gap-1">
            ${s.items.map(item => `
              <div class="flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-bold" style="background:rgba(0,0,0,0.04)">
                <span>${item.item_icon}</span>
                <span class="text-gray-700">${item.item_name}</span>
                ${item.reward_type==='AUTO_ACORN' ? `<span class="text-amber-600">+${item.acorn_amt}🌰</span>` : ''}
                ${item.reward_type==='MANUAL_ITEM' ? '<span style="color:#7c3aed">📦</span>' : ''}
                ${item.reward_type==='COUPON' ? '<span style="color:#d97706">🎟️</span>' : ''}
              </div>`).join('')}
          </div>
        </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-3">뽑기 기록이 없어요</p>';

  const label = document.getElementById('glogPageLabel');
  const prev  = document.getElementById('glogPrevBtn');
  const next  = document.getElementById('glogNextBtn');
  if (label) label.textContent = total ? `${_glogPage+1} / ${totalPages}` : '';
  if (prev)  prev.disabled  = _glogPage === 0;
  if (next)  next.disabled  = _glogPage >= totalPages - 1;
}

function moveGlogPage(dir) {
  const totalPages = Math.max(1, Math.ceil(_glogItems.length / PAGE_SIZE));
  _glogPage = Math.max(0, Math.min(totalPages - 1, _glogPage + dir));
  _renderGlogPage();
}

function _renderReqPage() {
  const el = document.getElementById('myRequestList');
  const total = _reqItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_REQ));
  const slice = _reqItems.slice(_reqPage * PAGE_SIZE_REQ, (_reqPage + 1) * PAGE_SIZE_REQ);

  el.innerHTML = slice.length
    ? slice.map(r => `<div class="flex items-center justify-between p-3 rounded-xl" class="row-item-bg">
        <div class="min-w-0 mr-2">
          <p class="text-sm font-bold text-gray-800">${r.icon} ${r.label}</p>
          <p class="text-xs text-gray-400">${r.sub}</p>
        </div>
        <span class="badge ${stClass(r.status)} shrink-0">${stLabel(r.status)}</span>
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-3">신청 내역이 없어요</p>';

  const label = document.getElementById('reqPageLabel');
  const prev  = document.getElementById('reqPrevBtn');
  const next  = document.getElementById('reqNextBtn');
  if (label) label.textContent = total ? `${_reqPage+1} / ${totalPages}` : '';
  if (prev)  prev.disabled  = _reqPage === 0;
  if (next)  next.disabled  = _reqPage >= totalPages - 1;
}

function _renderQcrPage(qcrs) {
  const el = document.getElementById('myQuestReqList');
  if (!el) return;
  const total = qcrs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_QCR));
  const slice = qcrs.slice(window._qcrPage * PAGE_SIZE_QCR, (window._qcrPage + 1) * PAGE_SIZE_QCR);
  el.innerHTML = slice.length
    ? slice.map(r => `<div class="flex items-center justify-between p-3 rounded-xl" style="background:#f9fafb">
        <div class="min-w-0 mr-2">
          <p class="text-sm font-bold text-gray-800">${r.quests?.icon||'📋'} ${r.quests?.name||'퀘스트'}</p>
          <p class="text-xs text-gray-400">${fmtTs(r.created_at)} · 완료 요청</p>
        </div>
        <span class="badge ${stClass(r.status)} shrink-0">${stLabel(r.status)}</span>
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-3">퀘스트 신청 내역이 없어요</p>';
  const label = document.getElementById('qcrPageLabel');
  const prev  = document.getElementById('qcrPrevBtn');
  const next  = document.getElementById('qcrNextBtn');
  if (label) label.textContent = total ? `${window._qcrPage+1} / ${totalPages}` : '';
  if (prev)  prev.disabled  = window._qcrPage === 0;
  if (next)  next.disabled  = window._qcrPage >= totalPages - 1;
}
function moveQcrPage(dir) {
  if (!window._qcrCache) return;
  const totalPages = Math.max(1, Math.ceil(window._qcrCache.length / PAGE_SIZE_QCR));
  window._qcrPage = Math.max(0, Math.min(totalPages - 1, (window._qcrPage||0) + dir));
  _renderQcrPage(window._qcrCache);
}

function _renderTxPage() {
  const el = document.getElementById('myTxList');
  const total = _txItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_TX));
  const slice = _txItems.slice(_txPage * PAGE_SIZE_TX, (_txPage + 1) * PAGE_SIZE_TX);

  el.innerHTML = slice.length
    ? slice.map(t => `<div class="flex items-center justify-between p-3 rounded-xl" class="row-item-bg">
        <div class="flex-1 min-w-0 mr-3">
          <p class="text-sm font-bold text-gray-700 truncate">${t.reason}</p>
          <p class="text-xs text-gray-400">${fmtTs(t.created_at)} · 잔액 ${t.balance}🌰</p>
        </div>
        <span class="font-black text-base shrink-0 ${t.amount>0?'tx-plus':'tx-minus'}">${t.amount>0?'+':''}${t.amount}🌰</span>
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-3">내역이 없어요</p>';

  const label = document.getElementById('txPageLabel');
  const prev  = document.getElementById('txPrevBtn');
  const next  = document.getElementById('txNextBtn');
  if (label) label.textContent = total ? `${_txPage+1} / ${totalPages}` : '';
  if (prev)  prev.disabled  = _txPage === 0;
  if (next)  next.disabled  = _txPage >= totalPages - 1;
}

function moveReqPage(dir) {
  const totalPages = Math.max(1, Math.ceil(_reqItems.length / PAGE_SIZE_REQ));
  _reqPage = Math.max(0, Math.min(totalPages - 1, _reqPage + dir));
  _renderReqPage();
}

function moveTxPage(dir) {
  const totalPages = Math.max(1, Math.ceil(_txItems.length / PAGE_SIZE_TX));
  _txPage = Math.max(0, Math.min(totalPages - 1, _txPage + dir));
  _renderTxPage();
}

async function renderMypage() {
  document.getElementById('mypageHeader').innerHTML = `
    <div class="flex items-center gap-4">
      <div style="cursor:pointer;position:relative" onclick="openProfileIconPicker()" title="프로필 아이콘 변경">
        ${_avatarHtml(myProfile, '3.5rem')}
        <span style="position:absolute;bottom:-2px;right:-2px;font-size:14px;background:var(--surface);border-radius:50%;padding:1px 3px;box-shadow:0 1px 4px rgba(0,0,0,0.2)">✏️</span>
      </div>
      <div class="flex-1 min-w-0">
        <h2 class="text-xl font-black text-gray-800 cursor-pointer hover:text-amber-600 transition-colors" onclick="openMyProfile()" title="내 프로필 보기">${myProfile.display_name}</h2>
        <p class="text-xs text-gray-400 font-semibold">${session?.user?.email || ''}</p>
      </div>
      <div class="ml-auto text-center flex-shrink-0">
        <div class="text-3xl font-black text-amber-600" id="myAcornVal">${myProfile.acorns || 0}</div>
        <div class="text-xs text-gray-500 font-bold">🌰 도토리</div>
      </div>
    </div>`;

  renderInventory();

  // 30일 기준 날짜 (KST)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: myReqs }, { data: myQCRs }, { data: txs }, { data: gachaLogs }] = await Promise.all([
    sb.from('product_requests').select('*')
      .eq('user_id', myProfile.id).gte('created_at', cutoff)
      .order('created_at', { ascending: false }).limit(200),
    sb.from('quest_completion_requests').select('*, quests(name,icon)')
      .eq('user_id', myProfile.id).gte('created_at', cutoff)
      .order('created_at', { ascending: false }).limit(100),
    sb.from('transactions').select('*')
      .eq('user_id', myProfile.id).gte('created_at', cutoff)
      .order('created_at', { ascending: false }).limit(500),
    sb.from('gacha_logs').select('*')
      .eq('user_id', myProfile.id).gte('created_at', cutoff)
      .order('created_at', { ascending: false }).limit(300),
  ]);

  // 상품 신청 현황만 표시 (퀘스트 신청은 별도)
  _reqPage  = 0;
  _reqItems = (myReqs||[]).map(r => ({
    label: r.product_snapshot?.name || '상품',
    icon:  r.product_snapshot?.icon || '🎁',
    sub:   fmtTs(r.created_at) + (r.price ? ` · ${r.price}🌰` : ' · 뽑기') + (r.from_gacha ? ' 🎲' : ''),
    status: r.status,
    created_at: r.created_at,
  }));

  _renderReqPage();

  // 퀘스트 신청 현황 (페이지네이션)
  window._qcrPage = 0;
  window._qcrCache = myQCRs || [];
  _renderQcrPage(window._qcrCache);

  // 뽑기 기록
  _glogPage  = 0;
  _glogItems = gachaLogs || [];
  _renderGlogPage();

  // 도토리 내역
  _txPage  = 0;
  _txItems = txs || [];
  _renderTxPage();
}

// ── 인벤토리 상태 ──
window._invPage = 0;
window._invSort = 'date'; // 'date' | 'name'

function setInvSort(mode) {
  window._invSort = mode;
  document.getElementById('invSortDate')?.classList.toggle('inv-sort-active', mode === 'date');
  document.getElementById('invSortName')?.classList.toggle('inv-sort-active', mode === 'name');
  window._invPage = 0;
  _renderInvGrid();
}

function _sortInvItems(items) {
  const sorted = [...items];
  if (window._invSort === 'name') {
    sorted.sort((a, b) => {
      const na = (a.product_snapshot || a.products || {}).name || '';
      const nb = (b.product_snapshot || b.products || {}).name || '';
      return na.localeCompare(nb, 'ko');
    });
  }
  // 'date'는 DB에서 이미 created_at DESC 정렬됨
  return sorted;
}

function _renderInvGrid() {
  const el = document.getElementById('myInventory');
  const dotsEl = document.getElementById('invPageDots');
  if (!el) return;

  const items = _sortInvItems(window._invCache || []);
  const pendingIds = window._invPendingIds || new Set();
  const PAGE_SIZE = 6;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (window._invPage >= totalPages) window._invPage = totalPages - 1;

  // 빈 상태
  if (!items.length) {
    el.innerHTML = '<p class="text-xs text-center py-4" style="color:var(--text-secondary)">아이템이 없어요 🎒</p>';
    if (dotsEl) dotsEl.innerHTML = '';
    return;
  }

  // 페이지별 그리드 생성
  let pagesHtml = '';
  for (let pg = 0; pg < totalPages; pg++) {
    const pageItems = items.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
    let slotsHtml = '';
    for (const item of pageItems) {
      const p = item.product_snapshot || item.products || {};
      const isPending = pendingIds.has(item.id);
      const qty = item.quantity || 1;
      const showQty = qty > 1;
      const pendingCls = isPending ? ' inv-slot-pending' : '';
      const icon = p.reward_type === 'GIFT_ACORN' ? '🎁' : (p.icon || '🎁');
      const name = p.reward_type === 'GIFT_ACORN' ? '도토리 선물' : (p.name || '아이템');

      slotsHtml += `<div class="inv-slot${pendingCls}" onclick="openInvDetail('${item.id}')">
        <div class="inv-slot-icon">${icon}</div>
        <div class="inv-slot-name">${name}</div>
        ${showQty ? `<div class="inv-slot-qty">${qty}</div>` : ''}
      </div>`;
    }
    // 빈 슬롯으로 6칸 채우기
    const emptyCount = PAGE_SIZE - pageItems.length;
    for (let i = 0; i < emptyCount; i++) {
      slotsHtml += `<div class="inv-slot inv-slot-empty"><div class="inv-slot-icon">📦</div></div>`;
    }
    pagesHtml += `<div class="inv-grid-page">${slotsHtml}</div>`;
  }

  el.innerHTML = `<div class="inv-slider" id="invSlider">${pagesHtml}</div>`;
  _applyInvPage();

  // 페이지 도트
  if (dotsEl) {
    if (totalPages <= 1) { dotsEl.innerHTML = ''; return; }
    dotsEl.innerHTML = Array.from({ length: totalPages }, (_, i) =>
      `<div class="inv-dot${i === window._invPage ? ' inv-dot-active' : ''}" onclick="goInvPage(${i})"></div>`
    ).join('');
  }
}

function _applyInvPage() {
  const slider = document.getElementById('invSlider');
  if (slider) slider.style.transform = `translateX(-${window._invPage * 100}%)`;
}

function goInvPage(pg) {
  window._invPage = pg;
  _applyInvPage();
  const dotsEl = document.getElementById('invPageDots');
  if (dotsEl) dotsEl.querySelectorAll('.inv-dot').forEach((d, i) => d.classList.toggle('inv-dot-active', i === pg));
}

// 터치 스와이프 지원
(function() {
  let startX = 0;
  document.addEventListener('touchstart', e => {
    const el = e.target.closest('#myInventory');
    if (!el) return;
    startX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const el = e.target.closest('#myInventory');
    if (!el) return;
    const diff = startX - e.changedTouches[0].clientX;
    const items = window._invCache || [];
    const totalPages = Math.max(1, Math.ceil(items.length / 6));
    if (Math.abs(diff) > 40) {
      if (diff > 0 && window._invPage < totalPages - 1) goInvPage(window._invPage + 1);
      else if (diff < 0 && window._invPage > 0) goInvPage(window._invPage - 1);
    }
  }, { passive: true });
})();

// ── 인벤토리 상세 모달 ──
function openInvDetail(inventoryId) {
  const item = (window._invCache || []).find(i => i.id === inventoryId);
  if (!item) return;
  const p = item.product_snapshot || item.products || {};
  const isPending = (window._invPendingIds || new Set()).has(item.id);

  const isCoupon       = p.reward_type === 'COUPON';
  const isAcornTicket  = p.reward_type === 'ACORN_TICKET';
  const isGachaTicket  = p.reward_type === 'GACHA_TICKET';
  const isGiftTicket   = p.reward_type === 'GIFT_GACHA_TICKET';
  const isGiftAcorn    = p.reward_type === 'GIFT_ACORN';
  const isExamMaterial = p.reward_type === 'EXAM_MATERIAL';
  const qty = item.quantity || 1;

  const icon = isGiftAcorn ? '🎁' : (p.icon || '🎁');
  const name = isGiftAcorn ? '도토리 선물' : (p.name || '아이템');
  const desc = p.description || '';

  // 뱃지들 (모달 안에서만 표시)
  let badges = '';

  // 출처 태그
  const sourceLabel = isGiftTicket || isGiftAcorn ? '🎁 선물'
    : item.from_gacha ? '🎲 뽑기' : '🛍️ 구매';
  const sourceCls = isGiftTicket || isGiftAcorn ? 'background:rgba(52,211,153,0.15);color:#065f46'
    : item.from_gacha ? 'background:rgba(139,92,246,0.15);color:#6d28d9' : 'background:rgba(245,158,11,0.15);color:#92400e';
  if (!isExamMaterial) badges += `<span class="inv-detail-badge" style="${sourceCls}">${sourceLabel}</span>`;

  // 타입별 뱃지
  if (isCoupon) badges += `<span class="inv-detail-badge" style="background:rgba(253,224,71,0.25);color:#854d0e">🎟️ ${p.discount_pct||0}% 할인</span>`;
  if (isAcornTicket) badges += `<span class="inv-detail-badge" style="background:rgba(52,211,153,0.15);color:#065f46">🌰 ${p.acorn_amt||0} 도토리</span>`;
  if (isGachaTicket) badges += `<span class="inv-detail-badge" style="background:rgba(139,92,246,0.15);color:#6d28d9">🎫 뽑기권</span>`;
  if (isGiftTicket) badges += `<span class="inv-detail-badge" style="background:rgba(139,92,246,0.15);color:#6d28d9">🎫 티켓 ${p.gift_qty||1}장</span>`;
  if (isGiftAcorn) badges += `<span class="inv-detail-badge" style="background:rgba(52,211,153,0.15);color:#065f46">🌰 도토리 ${p.gift_qty||0}개</span>`;
  if (qty > 1) badges += `<span class="inv-detail-badge" style="background:rgba(99,102,241,0.15);color:#4338ca">x${qty}</span>`;

  // 액션 버튼
  let actionsHtml = '';
  if (isPending) {
    actionsHtml = `<button class="btn w-full py-2 text-sm" disabled style="background:#fef3c7;color:#92400e;border:1.5px solid rgba(245,158,11,0.3);cursor:not-allowed">⏳ 승인 대기중</button>`;
  } else if (isExamMaterial) {
    // 등급심사 재료: 사용 버튼 없음
  } else {
    // 사용하기 버튼
    let btnLabel = '사용하기';
    let btnColor = 'btn-primary';
    if (isCoupon)      { btnLabel = '🎟️ 쿠폰 사용'; }
    if (isAcornTicket) { btnLabel = `🌰 +${p.acorn_amt||0} 받기`; btnColor = 'btn-green'; }
    if (isGachaTicket) { btnLabel = '🎫 뽑기 1회'; btnColor = 'btn-purple'; }
    if (isGiftTicket)  { btnLabel = `🎫 티켓 ${p.gift_qty||1}장 받기`; btnColor = 'btn-purple'; }
    if (isGiftAcorn)   { btnLabel = `🌰 도토리 ${p.gift_qty||0} 받기`; btnColor = 'btn-green'; }
    actionsHtml += `<button class="btn ${btnColor} w-full py-2 text-sm" onclick="closeModal();useInventoryItem('${item.id}')">${btnLabel}</button>`;

    // 되팔기 버튼 (resell_price가 있는 경우)
    const resellPrice = (item.products || {}).resell_price || (item.product_snapshot || {}).resell_price || 0;
    if (resellPrice > 0) {
      actionsHtml += `<button class="btn btn-gray w-full py-2 text-sm" onclick="closeModal();resellInventoryItem('${item.id}')">💰 되팔기 (+${resellPrice}🌰)</button>`;
    }
  }

  showModal(`<div class="text-center">
    <div style="font-size:3rem;line-height:1;margin-bottom:6px">${icon}</div>
    <h2 class="text-lg font-black" style="color:var(--text-primary);margin-bottom:2px">${name}</h2>
    ${(desc && !isExamMaterial) ? `<p class="text-xs" style="color:var(--text-secondary);margin-bottom:8px">${desc}</p>` : ''}
    <div class="inv-detail-badges">${badges}</div>
    <div class="inv-detail-actions">
      ${actionsHtml}
      <button class="btn btn-gray w-full py-2 text-sm" onclick="closeModal()">닫기</button>
    </div>
  </div>`);
}

async function renderInventory() {
  const el = document.getElementById('myInventory');
  if (!el) return;
  el.innerHTML = '<p class="text-xs text-center py-2" style="color:var(--text-secondary)">로딩 중...</p>';
  updateTicketDisplay().catch(()=>{});

  const [{ data: items }, { data: pendingReqs }] = await Promise.all([
    sb.from('inventory')
      .select('*, products(id,name,icon,description,reward_type,discount_pct,acorn_amt,resell_price)')
      .eq('user_id', myProfile.id).eq('status', 'held')
      .order('created_at', { ascending: false }),
    sb.from('product_requests')
      .select('inventory_id')
      .eq('user_id', myProfile.id).eq('status', 'pending')
  ]);

  const pendingIds = new Set((pendingReqs||[]).map(r => r.inventory_id).filter(Boolean));
  if (window._pendingInvIds) window._pendingInvIds.forEach(id => pendingIds.add(id));

  window._invCache = items || [];
  window._invPendingIds = pendingIds;
  window._invPage = 0;
  _renderInvGrid();
}

async function useInventoryItem(inventoryId) {
  const item = (window._invCache || []).find(i => i.id === inventoryId);
  const p = item?.products || item?.product_snapshot || {};

  // 도토리 티켓 확인 모달
  if (p.reward_type === 'ACORN_TICKET') {
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem">🌰</div>
      <h2 class="text-lg font-black text-gray-800 mt-2 mb-1">${p.name}</h2>
      <div class="text-3xl font-black text-amber-600 my-3">+${p.acorn_amt||0}🌰</div>
      <p class="text-sm text-gray-500 mb-4">사용하면 즉시 도토리가 지급됩니다.</p>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-green flex-1 py-2" onclick="closeModal();confirmUseItem('${inventoryId}')">🌰 사용하기</button>
      </div></div>`);
    return;
  }

  // 선물 뽑기 티켓 확인 모달
  if (p.reward_type === 'GIFT_GACHA_TICKET') {
    const giftQty = p.gift_qty || 1;
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem">🎁</div>
      <h2 class="text-lg font-black text-gray-800 mt-2 mb-1">${p.name}</h2>
      <div class="text-2xl font-black text-purple-600 my-3">🎫 +${giftQty}장</div>
      <p class="text-sm text-gray-500 mb-4">사용하면 뽑기 티켓 ${giftQty}장이 즉시 추가됩니다.</p>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-purple flex-1 py-2" onclick="closeModal();confirmUseItem('${inventoryId}')">🎫 받기</button>
      </div></div>`);
    return;
  }

  // 선물 도토리 확인 모달
  if (p.reward_type === 'GIFT_ACORN') {
    const giftQty = p.gift_qty || item.product_snapshot?.gift_qty || 0;
    const memo = p.memo || item.product_snapshot?.memo || '';
    showModal(`<div style="text-align:center;font-family:'Nunito',sans-serif">
      <div style="position:relative;display:inline-block;margin-bottom:4px">
        <span style="position:absolute;top:2px;right:-2px;font-size:13px;animation:sparkle 2s ease-in-out infinite">✨</span>
        <span style="position:absolute;top:18px;left:-6px;font-size:10px;animation:sparkle 2s ease-in-out infinite;animation-delay:.6s">⭐</span>
        <span style="font-size:3rem;display:block;animation:float 3s ease-in-out infinite;filter:drop-shadow(0 6px 12px rgba(52,211,153,0.25))">🎁</span>
      </div>
      <h2 style="font-family:'Jua',sans-serif;font-size:1.1rem;color:#374151;margin:8px 0 4px">도토리 선물</h2>
      <div style="display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid rgba(52,211,153,0.3);border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;color:#065f46;margin-bottom:14px">
        <span style="width:6px;height:6px;border-radius:50%;background:#34d399;display:inline-block;flex-shrink:0"></span>
        관리자가 보낸 선물
      </div>
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid rgba(52,211,153,0.25);border-radius:20px;padding:14px 20px;margin-bottom:14px">
        <div style="font-family:'Jua',sans-serif;font-size:2rem;color:#065f46;line-height:1;display:flex;align-items:center;justify-content:center;gap:6px">
          <span style="font-size:1.1rem;color:#34d399">+</span>🌰 ${giftQty}
        </div>
        <div style="font-size:11px;color:#6ee7b7;margin-top:3px;font-weight:700">즉시 지급</div>
      </div>
      ${memo ? `<div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;background:rgba(249,250,251,0.8);border:1.5px solid rgba(210,180,240,0.3);border-radius:14px;padding:10px 14px;margin-bottom:18px">
        <span style="font-size:15px;line-height:1;flex-shrink:0">💬</span>
        <span style="font-size:12px;font-weight:700;color:#6b7280;line-height:1">${memo}</span>
      </div>` : '<div style="margin-bottom:18px"></div>'}
      <div style="display:flex;gap:8px">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-green flex-1 py-2" onclick="closeModal();confirmUseItem('${inventoryId}')">🌰 받기</button>
      </div>
    </div>`);
    return;
  }

  // 뽑기 티켓 확인 모달
  if (p.reward_type === 'GACHA_TICKET') {
    showModal(`<div class="text-center">
      <div style="font-size:2.5rem">🎫</div>
      <h2 class="text-lg font-black text-gray-800 mt-2 mb-1">${p.name}</h2>
      <p class="text-sm text-gray-500 mb-4">뽑기 탭에서 <b>티켓으로 뽑기</b> 버튼으로 자동 적용됩니다.<br>인벤토리에 보관 중인 티켓은 뽑기 탭에서 우선 사용됩니다.</p>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-purple flex-1 py-2" onclick="closeModal();confirmUseItem('${inventoryId}')">🎫 뽑기 시작</button>
      </div></div>`);
    return;
  }

  if (p.reward_type === 'COUPON') {
    showModal(`
      <div class="text-center">
        <div style="font-size:2.6rem;line-height:1;margin-bottom:8px">🎟️</div>
        <h2 class="text-lg font-black text-gray-800 mb-1">${p.name}</h2>
        <div class="text-3xl font-black text-yellow-600 my-3">${p.discount_pct || 0}% 할인 쿠폰</div>
        <p class="text-sm text-gray-500 mb-4">${p.description || '상점에서 아이템 구매 시<br>할인된 가격으로 구매할 수 있어요!'}</p>
        <div class="modal-notice-box">
          🛍️ 상점에서 아이템 구매 시 이 쿠폰을 선택하면<br>
          <span class="font-black text-yellow-700">${p.discount_pct || 0}% 할인</span>된 가격으로 구매할 수 있어요.<br>
          단, <span class="font-black">1회만</span> 사용 가능합니다.
        </div>
        <div class="flex gap-2">
          <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">닫기</button>
          <button class="btn btn-primary flex-1 py-2" onclick="closeModal();uTab('shop',document.querySelector('#userMode .tab-btn'))">🛍️ 상점으로</button>
        </div>
      </div>`);
    return;
  }

  showModal(`
    <div class="text-center">
      <div style="font-size:2.6rem;line-height:1;margin-bottom:8px">${p.icon || '🎁'}</div>
      <h2 class="text-lg font-black text-gray-800" style="margin-bottom:4px">${p.name || '아이템'}</h2>
      <p class="text-sm text-gray-400" style="margin-bottom:12px">${p.description || ''}</p>
      <div class="modal-notice-box">
        ✋ 사용하면 관리자에게 신청이 전달돼요.<br>승인 후 아이템이 지급됩니다.
      </div>
      <div class="flex gap-2" style="margin-top:4px">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-primary flex-1 py-2" onclick="confirmUseItem('${inventoryId}')">사용하기!</button>
      </div>
    </div>`);
}

async function resellInventoryItem(inventoryId, e) {
  if (e) e.stopPropagation();
  const item = (window._invCache || []).find(i => i.id === inventoryId);
  const p = item?.products || item?.product_snapshot || {};
  const resellPrice = p.resell_price || 0;
  if (!resellPrice) { toast('❌', '이 아이템은 되팔기가 불가해요'); return; }

  showModal(`
    <div class="text-center">
      <div style="font-size:2.6rem;line-height:1;margin-bottom:8px">${p.icon || '🎁'}</div>
      <h2 class="text-lg font-black text-gray-800 mb-1">${p.name}</h2>
      <div class="text-3xl font-black text-amber-600 my-3">+${resellPrice} 🌰</div>
      <div class="modal-notice-box" style="background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.25)">
        💰 이 아이템을 되팔면 <span class="font-black">${resellPrice} 도토리</span>를 받아요.<br>
        되팔기한 아이템은 <span class="font-black">복구되지 않아요!</span>
      </div>
      <div class="flex gap-2" style="margin-top:4px">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-green flex-1 py-2" onclick="confirmResellItem('${inventoryId}')">💰 되팔기!</button>
      </div>
    </div>`);
}

async function confirmResellItem(inventoryId) {
  await withLock('resell_'+inventoryId, async () => {
    closeModal();
    const { data: item } = await sb.from('inventory')
      .select('*, products(id,name,icon,resell_price)')
      .eq('id', inventoryId).eq('status', 'held').single();
    if (!item) { toast('❌', '이미 처리된 아이템이에요'); return; }

    const p = item.products || item.product_snapshot || {};
    const resellPrice = p.resell_price || 0;
    if (!resellPrice) { toast('❌', '이 아이템은 되팔기가 불가해요'); return; }

    // pending 신청이 있으면 되팔기 차단
    const { data: pendingReq } = await sb.from('product_requests')
      .select('id').eq('inventory_id', inventoryId).eq('status', 'pending').limit(1);
    if (pendingReq && pendingReq.length > 0) {
      toast('❌', '승인 대기 중인 신청이 있어요. 취소 후 되팔기 해주세요.'); return;
    }

    const { data: updated, error: updateErr } = await sb.from('inventory')
      .update({ status: 'resold' })
      .eq('id', inventoryId).eq('status', 'held').select('id');
    if (updateErr || !updated || updated.length === 0) {
      toast('❌', '이미 처리된 아이템이에요 (중복 방지)'); return;
    }

    const res = await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: resellPrice, p_reason: `되팔기 — ${p.name}` });
    if (res.data?.success) { myProfile.acorns = res.data.balance; updateAcornDisplay(); }
    await pushNotif(myProfile.id, 'reward', '되팔기 완료! 💰', `${p.icon} ${p.name} 되팔기로 +${resellPrice}🌰 획득!`);
    playSound('reward');
    toast('💰', `${p.name} 되팔기! +${resellPrice}🌰`);
    renderInventory();
  });
}

async function confirmUseItem(inventoryId) {
  await withLock('useitem_'+inventoryId, async () => { await _confirmUseItemInner(inventoryId); });
}
async function _confirmUseItemInner(inventoryId) {
  closeModal();
  const { data: item } = await sb.from('inventory')
    .select('*, products(id,name,icon,description,reward_type)')
    .eq('id', inventoryId).single();
  if (!item) { toast('❌', '아이템을 찾을 수 없어요'); return; }
  const p = item.products || item.product_snapshot || {};

  // 동일 인벤토리 아이템의 중복 사용신청 방지 (inventoryId 기준)
  {
    const { data: existingReq } = await sb.from('product_requests')
      .select('id').eq('user_id', myProfile.id).eq('inventory_id', inventoryId).eq('status', 'pending').limit(1);
    if (existingReq && existingReq.length > 0) {
      toast('⏳', '이미 승인 대기 중인 신청이 있어요!'); return;
    }
  }

  // ── 선물 뽑기 티켓: 즉시 카운터 추가 ──
  if (p.reward_type === 'GIFT_GACHA_TICKET') {
    const giftQty = p.gift_qty || item.product_snapshot?.gift_qty || 1;
    await sb.from('inventory').update({ status: 'used' }).eq('id', inventoryId);
    const { data: tr } = await sb.rpc('adjust_gacha_tickets', {
      p_user_id: myProfile.id, p_amount: giftQty
    });
    if (tr?.success) window._gachaTicketCount = tr.count;
    playSound('reward');
    toast('🎫', `뽑기 티켓 ${giftQty}장 획득!`);
    triggerAutoQuest('itemUse');
    window._gachaTicketCount = undefined; // 캐시 무효화
    renderInventory();
    renderMypage();
    return;
  }

  // ── 선물 도토리: 즉시 지급 ──
  if (p.reward_type === 'GIFT_ACORN') {
    const giftQty = p.gift_qty || item.product_snapshot?.gift_qty || 0;
    await sb.from('inventory').update({ status: 'used' }).eq('id', inventoryId);
    if (giftQty > 0) {
      const res = await sb.rpc('adjust_acorns', {
        p_user_id: myProfile.id, p_amount: giftQty,
        p_reason: `도토리 선물 사용 — ${giftQty}🌰`
      });
      if (res.data?.success) myProfile.acorns = res.data.balance;
    }
    playSound('reward');
    toast('🌰', `도토리 +${giftQty}🌰 획득!`);
    triggerAutoQuest('itemUse');
    updateAcornDisplay();
    renderInventory();
    renderMypage();
    return;
  }

  // ── 도토리 티켓: 즉시 지급 ──
  if (p.reward_type === 'ACORN_TICKET') {
    await sb.from('inventory').update({ status: 'used' }).eq('id', inventoryId);
    const acornAmt = p.acorn_amt || item.product_snapshot?.acorn_amt || 0;
    if (acornAmt > 0) {
      const res = await sb.rpc('adjust_acorns', {
        p_user_id: myProfile.id, p_amount: acornAmt,
        p_reason: `도토리 티켓 사용 — ${p.icon} ${p.name}`
      });
      if (res.data?.success) myProfile.acorns = res.data.balance;
    }
    playSound('reward');
    toast('🌰', `${p.name} 사용! +${acornAmt}🌰`);
    updateAcornDisplay();
    triggerAutoQuest('itemUse');
    renderInventory();
    renderMypage();
    return;
  }

  // ── 뽑기 티켓: 무료 뽑기 1회 ──
  if (p.reward_type === 'GACHA_TICKET') {
    await sb.from('inventory').update({ status: 'used' }).eq('id', inventoryId);
    playSound('pop');
    toast('🎫', '뽑기 티켓 사용! 뽑기를 진행합니다');
    triggerAutoQuest('itemUse');
    renderInventory();
    // 뽑기 탭으로 이동 (티켓은 자동으로 인식됨)
    setTimeout(() => {
      uTab('gacha', document.querySelector('#userMode .tab-btn[onclick*="gacha"]'));
    }, 300);
    return;
  }

  // 인벤토리는 pending 상태 유지 (관리자 승인 시 'used'로 변경)
  // UI에서 버튼만 "승인 대기중"으로 변경

  // product_requests에 신청 생성 (product_id + snapshot + inventory_id 저장)
  const { error: reqErr } = await sb.from('product_requests').insert({
    user_id: myProfile.id,
    product_id: item.product_id,
    product_snapshot: item.product_snapshot,
    price: 0,
    status: 'pending',
    reward_type: 'MANUAL_ITEM',
    from_gacha: item.from_gacha || false,
    inventory_id: inventoryId
  });
  if (reqErr) { toast('❌', '신청 실패: ' + reqErr.message); return; }

  // 즉시 pending 캐시에 추가 → renderInventory 호출 시 버튼 즉시 변경
  if (!window._pendingInvIds) window._pendingInvIds = new Set();
  window._pendingInvIds.add(inventoryId);

  playSound('pop');
  toast('✅', `${p.name} 신청 완료! 관리자 승인을 기다려주세요.`);
  triggerAutoQuest('itemUse');

  // 렌더링 먼저 — 버튼 즉시 변경
  await renderInventory();
  renderMypage();

  // 알림은 백그라운드 (UI 블로킹 없음)
  pushNotif(myProfile.id, 'request', '신청 완료! ✋', `${p.icon} ${p.name} 신청을 보냈어요. 관리자 승인 대기 중이에요.`).catch(()=>{});
  sb.from('users').select('id').eq('is_admin', true).maybeSingle().then(({ data: adminUser }) => {
    if (adminUser) {
      pushNotif(adminUser.id, 'request', `📬 신청 도착! ${p.icon} ${p.name}`,
        `${myProfile.display_name}님이 아이템 사용을 신청했어요.`).catch(()=>{});
    }
  }).catch(()=>{});
  sendBrowserNotif('📬 새 신청이 도착했어요!', `${myProfile.display_name}님: ${p.icon} ${p.name} 사용 신청`);
}

// 브라우저 Push 알림 (Web Notification API)
async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function sendBrowserNotif(title, body, icon = '🌰') {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/acorn-shop/apple-touch-icon.png',
      badge: '/acorn-shop/apple-touch-icon.png',
      tag: 'acorn-admin-request',
      renotify: true
    });
  } catch(e) {}
}

// ══════════════════════════════════════════════
//  프로필 아이콘 선택
// ══════════════════════════════════════════════
function openProfileIconPicker() {
  let grid = '';
  for (let i = 1; i <= PROFILE_ICON_COUNT; i++) {
    const fn = String(i).padStart(2, '0') + '.png';
    const selected = myProfile.profile_icon === fn;
    grid += '<div class="pi-item' + (selected ? ' pi-selected' : '') + '" onclick="selectProfileIcon(\'' + fn + '\')">' +
      '<img src="images/user_profile_icon/' + fn + '" alt="' + fn + '" loading="lazy">' +
    '</div>';
  }

  showModal(`
    <div class="pi-picker">
      <h3 class="text-base font-black text-center mb-4" style="color:var(--text-primary)">프로필 아이콘 선택</h3>
      <div class="pi-grid">${grid}</div>
      <div class="text-center mt-4">
        <button class="btn px-6 py-2 text-xs font-bold" style="background:var(--surface);color:var(--text-secondary);border:1px solid var(--border)" onclick="selectProfileIcon(null)">기본 이모지로 되돌리기</button>
      </div>
    </div>`);
}

async function selectProfileIcon(filename) {
  const { error } = await sb.from('users').update({ profile_icon: filename }).eq('id', myProfile.id);
  if (error) { toast('❌', '저장 실패: ' + (error.message || '')); return; }

  myProfile.profile_icon = filename;
  closeModal();
  toast('✅', filename ? '프로필 아이콘이 변경되었어요!' : '기본 이모지로 되돌렸어요!');

  // 헤더 + 마이페이지 즉시 반영
  _updateHeaderAvatar();
  renderMypage();
}

// 헤더 아바타 갱신
function _updateHeaderAvatar() {
  const el = document.getElementById('headerAvatarIcon');
  if (el) el.innerHTML = _avatarHtml(myProfile, '3.2rem');
}

