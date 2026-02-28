// ──────────────────────────────────────────────
//  ADMIN — GIVE
// ──────────────────────────────────────────────
async function populateGiveSelect() {
  const { data: users } = await sb.from('users').select('*').eq('is_admin', false).order('display_name');
  allUsers = users || [];
  const sel = document.getElementById('giveUser');
  if (!sel) return;
  sel.innerHTML = allUsers.map(u => `<option value="${u.id}">${u.display_name} (${u.acorns}🌰)</option>`).join('');
  // logUserFilter 제거됨 (사용자 현황판으로 대체)
}

async function giveAcorns() {
  await withLock('giveAcorns', async () => { await _giveAcornsInner(); });
}
async function _giveAcornsInner() {
  const giveBtn = document.querySelector('#atab-give .btn-primary');
  btnLock(giveBtn, '지급 중...');
  playSound('click');

  try {
    const userId = document.getElementById('giveUser').value;
    const amount = parseInt(document.getElementById('giveAmount').value);
    const memo   = document.getElementById('giveMemo')?.value || '';
    if (!userId || !amount || amount === 0) { toast('❌', '사용자와 지급량을 확인해주세요'); return; }

    const { data: u } = await sb.from('users').select('display_name').eq('id', userId).single();
    const isDeduct = amount < 0;
    const absAmt = Math.abs(amount);

    if (isDeduct) {
      // 차감: RPC로 즉시 처리
      const res = await sb.rpc('admin_give_acorns', { p_target_user_id: userId, p_amount: amount, p_memo: memo || '관리자 차감' });
      if (res.error) { toast('❌', '차감 실패: ' + res.error.message); return; }
      // res.data는 객체 또는 배열일 수 있음
      const resData = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!resData?.success) { toast('❌', '차감 실패: ' + (resData?.error || JSON.stringify(resData))); return; }
      await pushNotif(userId, 'admin', '도토리 차감 🌰',
        `관리자가 ${absAmt} 도토리를 차감했어요. ${memo ? '(' + memo + ')' : ''}`);
    } else {
      // 지급: 선물상자를 인벤토리에 생성, 사용자가 수령 시 도토리 증가
      const { error: invErr } = await sb.from('inventory').insert({
        user_id: userId,
        product_id: null,
        product_snapshot: {
          name: `도토리 선물 (+${absAmt}🌰)`,
          icon: '🎁',
          reward_type: 'GIFT_ACORN',
          gift_qty: absAmt,
          memo: memo || ''
        },
        from_gacha: false,
        status: 'held'
      });
      if (invErr) { toast('❌', '선물 실패: ' + invErr.message); return; }
      await pushNotif(userId, 'admin', '선물 도착! 🎁',
        `도토리 ${absAmt}🌰를 선물받았어요! 인벤토리를 확인하세요. ${memo ? '(' + memo + ')' : ''}`);
    }
    toast('✅', `${u?.display_name||'사용자'}에게 ${absAmt} 도토리 ${isDeduct ? '차감' : '선물'}!`);
    document.getElementById('giveAmount').value = '';
    document.getElementById('giveMemo').value = '';
    populateGiveSelect();
    renderGiveHistory();
  } finally {
    btnUnlock(giveBtn);
  }
}


async function renderGiveHistory() {
  const { data: list } = await sb.from('transactions').select('*, users(display_name)').ilike('reason', '관리자 지급%').order('created_at', { ascending: false }).limit(8);
  const el = document.getElementById('giveHistory');
  el.innerHTML = list?.length
    ? list.map(t => `<div class="flex items-center justify-between p-3 rounded-xl bg-gray-50">
        <div><p class="text-sm font-bold text-gray-800">${t.users?.display_name||''}</p>
          <p class="text-xs text-gray-400">${t.reason.replace('관리자 지급 — ','')} · ${fmtTs(t.created_at)}</p></div>
        <span class="font-black text-amber-600">+${t.amount}🌰</span>
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-4">지급 내역 없음</p>';
}

// ──────────────────────────────────────────────
//  ADMIN — PRODUCTS
// ──────────────────────────────────────────────
function toggleAcornField(prefix) {
  const sel = document.getElementById(prefix+'-rewardType');
  const fld = document.getElementById(prefix+'-acornWrap');
  if (sel && fld) fld.classList.toggle('hidden', sel.value !== 'AUTO_ACORN' && sel.value !== 'ACORN_TICKET');
}

function toggleCouponField(prefix) {
  const sel = document.getElementById(prefix+'-rewardType');
  const couponWrap = document.getElementById(prefix+'-couponWrap');
  if (sel && couponWrap) couponWrap.classList.toggle('hidden', sel.value !== 'COUPON');
}

function toggleItemType(prefix) {
  const sel = document.getElementById(prefix+'-itemType');
  const probWrap = document.getElementById(prefix+'-probabilityWrap');
  const priceWrap = document.getElementById(prefix+'-priceWrap');
  const resellWrap = document.getElementById(prefix+'-resellWrap');
  const stockWrap = document.getElementById(prefix+'-stockWrap');
  if (sel && probWrap) probWrap.classList.toggle('hidden', sel.value !== 'gacha');
  if (sel && priceWrap) priceWrap.classList.toggle('hidden', sel.value === 'gacha');
  if (sel && resellWrap) resellWrap.classList.toggle('hidden', sel.value !== 'gacha');
  if (sel && stockWrap) stockWrap.classList.toggle('hidden', sel.value !== 'store');
}

function _productCard(p, i, listType) {
  const bg = p.active ? 'bg-gray-50' : 'bg-red-50 opacity-60';
  return `<div class="p-3 rounded-2xl ${bg} drag-item border-2 border-transparent"
      data-id="${p.id}" data-type="${listType}" data-order="${p.sort_order}"
      draggable="true"
      ondragstart="drgStart(event,'${p.id}','${listType}')"
      ondragover="drgOver(event)"
      ondrop="drgDrop(event,'${p.id}','${listType}')"
      ondragend="drgEnd(event)">
    <div class="flex items-center gap-2">
      <div class="text-gray-300 select-none">⠿</div>
      <div class="text-xl">${p.icon}</div>
      <div class="flex-1 min-w-0">
        <p class="font-black text-gray-800 text-sm truncate">${p.name}</p>
        <div class="flex items-center gap-1 flex-wrap mt-0.5">
          ${listType === 'store'
          ? `<span class="text-xs text-gray-500 font-bold">${p.price}🌰</span>
             ${p.stock !== null && p.stock !== undefined && p.stock >= 0
               ? (p.stock === 0
                 ? '<span class="badge-soldout-sm">품절</span>'
                 : `<span class="badge-stock-sm">재고 ${p.stock}</span>`)
               : '<span class="badge-unlimited-sm">무제한</span>'}`
          : `<span class="text-xs text-purple-600 font-bold">${p.probability||0}%</span>`}
          <span class="${p.reward_type==='AUTO_ACORN'?'rt-auto':'rt-manual'} text-xs">${p.reward_type==='AUTO_ACORN'?'⚡':'📬'}</span>
          ${p.reward_type==='AUTO_ACORN'?`<span class="text-xs text-green-600 font-bold">+${p.acorn_amt}🌰</span>`:''}
          ${!p.active?'<span class="badge-soldout-sm">비활성</span>':''}
        </div>
      </div>
    </div>
    <div class="flex gap-1 mt-2">
      <button class="btn btn-blue flex-1 py-1 text-xs" onclick="editProduct('${p.id}')">수정</button>
      <button class="btn btn-red px-2 py-1 text-xs" onclick="deleteProduct('${p.id}')">🗑</button>
    </div>
  </div>`;
}

async function renderProductAdmin() {
  const { data: products } = await sb.from('products').select('*').order('sort_order');
  const storeEl = document.getElementById('storeProductList');
  const gachaEl = document.getElementById('gachaProductList');
  if (!storeEl || !gachaEl) return;

  const storeItems = (products||[]).filter(p => (p.item_type||'store') === 'store');
  const gachaItems = (products||[]).filter(p => p.item_type === 'gacha');

  storeEl.innerHTML = storeItems.length
    ? storeItems.map((p,i) => _productCard(p,i,'store')).join('')
    : '<p class="text-xs text-gray-400 text-center py-3">상품이 없어요</p>';

  gachaEl.innerHTML = gachaItems.length
    ? gachaItems.map((p,i) => _productCard(p,i,'gacha')).join('')
    : '<p class="text-xs text-gray-400 text-center py-3">상품이 없어요</p>';
}

function toggleStockField() {
  const type = document.getElementById('ns-stockType')?.value;
  const fld  = document.getElementById('ns-stock');
  if (fld) fld.classList.toggle('hidden', type !== 'limited');
}

async function addStoreProduct() {
  const name       = document.getElementById('ns-name').value.trim();
  const icon       = document.getElementById('ns-icon').value || '🎁';
  const price      = parseInt(document.getElementById('ns-price').value) || 0;
  const desc       = document.getElementById('ns-desc').value || '';
  const rewardType = document.getElementById('ns-rewardType').value;
  const acornAmt   = parseInt(document.getElementById('ns-acornAmt').value) || 0;
  const stockType  = document.getElementById('ns-stockType')?.value || 'unlimited';
  const stock      = stockType === 'limited' ? (parseInt(document.getElementById('ns-stock').value) || 1) : null;
  if (!name) { toast('❌', '상품명을 입력해주세요'); return; }
  if (!price) { toast('❌', '가격을 입력해주세요'); return; }
  if (stockType === 'limited' && (!stock || stock < 1)) { toast('❌', '수량을 1개 이상 입력해주세요'); return; }
  const { data: all } = await sb.from('products').select('id');
  const { error } = await sb.from('products').insert({
    name, price, icon, description: desc,
    reward_type: rewardType, acorn_amt: acornAmt,
    item_type: 'store', probability: 0,
    stock: stock,
    active: true, sort_order: (all?.length||0)+1
  });
  if (error) { toast('❌', '추가 실패: ' + (error.message || error.details || JSON.stringify(error))); console.error('product insert error:', error); return; }
  ['ns-name','ns-icon','ns-price','ns-desc','ns-acornAmt','ns-stock'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  document.getElementById('ns-stockType').value = 'unlimited';
  toggleStockField();
  playSound('click');
  renderProductAdmin(); toast('✅', '상점 상품 추가 완료!');
}

async function addGachaProduct() {
  const name        = document.getElementById('ng-name').value.trim();
  const icon        = document.getElementById('ng-icon').value || '✨';
  const probability = parseFloat(document.getElementById('ng-probability').value) || 0;
  const desc        = document.getElementById('ng-desc').value || '';
  const rewardType  = document.getElementById('ng-rewardType').value;
  const acornAmt    = parseInt(document.getElementById('ng-acornAmt').value) || 0;
  const resellPrice = parseInt(document.getElementById('ng-resellPrice')?.value) || 0;
  const discountPct = rewardType === 'COUPON' ? (parseInt(document.getElementById('ng-discountPct')?.value) || 0) : 0;
  if (!name) { toast('❌', '아이템명을 입력해주세요'); return; }
  if (!probability) { toast('❌', '확률을 입력해주세요 (예: 10)'); return; }
  if (rewardType === 'COUPON' && (!discountPct || discountPct < 1 || discountPct > 100)) { toast('❌', '할인율을 1~100 사이로 입력해주세요'); return; }
  if (rewardType === 'ACORN_TICKET' && !acornAmt) { toast('❌', '지급할 도토리량을 입력해주세요'); return; }
  const { data: all } = await sb.from('products').select('id');
  const { error } = await sb.from('products').insert({
    name, price: 0, icon, description: desc,
    reward_type: rewardType, acorn_amt: acornAmt,
    item_type: 'gacha', probability,
    resell_price: resellPrice,
    discount_pct: discountPct,
    active: true, sort_order: (all?.length||0)+1
  });
  if (error) { toast('❌', '추가 실패: ' + error.message); return; }
  ['ng-name','ng-icon','ng-probability','ng-desc','ng-acornAmt','ng-resellPrice','ng-discountPct'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  playSound('click');
  renderProductAdmin(); toast('✅', '뽑기 상품 추가 완료!');
}

async function deleteProduct(id) {
  if (!confirm('정말 삭제할까요?')) return;

  // 인벤토리·신청 테이블의 product_id 참조 해제
  // (product_snapshot에 상품 정보가 이미 저장되어 있어 기록 표시엔 문제 없음)
  await sb.from('inventory').update({ product_id: null }).eq('product_id', id);
  await sb.from('product_requests').update({ product_id: null }).eq('product_id', id);

  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) { toast('❌', '삭제 실패: ' + error.message); return; }
  renderProductAdmin();
  toast('🗑️', '상품 삭제됨');
}

async function editProduct(id) {
  const { data: p } = await sb.from('products').select('*').eq('id', id).single();
  const it = p.item_type || 'store';
  const prob = p.probability || 0;
  const resell = p.resell_price || 0;
  const discountPct = p.discount_pct || 0;
  showModal(`
    <h2 class="text-lg font-black text-gray-800 mb-4">✏️ 상품 수정</h2>
    <div class="space-y-3">
      <input class="field" id="ep-name" value="${p.name}" placeholder="상품명">
      <div class="grid grid-cols-2 gap-2">
        <input class="field" type="number" id="ep-price" value="${p.price}" placeholder="가격">
        <input class="field" id="ep-icon" value="${p.icon}" placeholder="이모지">
      </div>
      <input class="field" id="ep-desc" value="${p.description||''}" placeholder="설명">
      <div>
        <label class="text-xs font-bold text-gray-500 mb-1 block">보상 타입</label>
        <select class="field" id="ep-rt" onchange="toggleEditAcorn();toggleEditCoupon()">
          <option value="MANUAL_ITEM" ${p.reward_type==='MANUAL_ITEM'?'selected':''}>📬 MANUAL — 관리자 승인</option>
          <option value="AUTO_ACORN" ${p.reward_type==='AUTO_ACORN'?'selected':''}>⚡ AUTO — 즉시 지급</option>
          <option value="COUPON" ${p.reward_type==='COUPON'?'selected':''}>🎟️ 할인쿠폰</option>
        </select>
      </div>
      <div id="ep-acornWrap" class="${p.reward_type==='AUTO_ACORN'?'':'hidden'}">
        <label class="text-xs font-bold text-gray-500 mb-1 block">지급 도토리</label>
        <input class="field" type="number" id="ep-acornAmt" value="${p.acorn_amt||0}" placeholder="도토리 수량">
      </div>
      <div id="ep-couponWrap" class="${p.reward_type==='COUPON'?'':'hidden'}">
        <label class="text-xs font-bold text-gray-500 mb-1 block">할인율 (%)</label>
        <input class="field" type="number" id="ep-discountPct" value="${discountPct}" placeholder="예: 20" min="1" max="100">
        <p class="text-xs text-gray-400 mt-1">※ 상점 구매 시 1회 사용 가능</p>
      </div>
      <div>
        <label class="text-xs font-bold text-gray-500 mb-1 block">상품 타입</label>
        <select class="field" id="ep-itemType" onchange="toggleItemType('ep')">
          <option value="store" ${it==='store'?'selected':''}>🛍️ 상점 상품</option>
          <option value="gacha" ${it==='gacha'?'selected':''}>🎲 뽑기 상품</option>
        </select>
      </div>
      <div id="ep-probabilityWrap" class="${it==='gacha'?'':'hidden'}">
        <label class="text-xs font-bold text-gray-500 mb-1 block">확률 (%)</label>
        <input class="field" type="number" step="0.1" min="0" id="ep-probability" value="${prob}" placeholder="예: 10 → 10%">
        <p class="text-xs text-gray-400 mt-1">※ 합이 100이 아니어도 자동 정규화됩니다</p>
      </div>
      <div id="ep-resellWrap" class="${it==='gacha'?'':'hidden'}">
        <label class="text-xs font-bold text-gray-500 mb-1 block">되팔기 가격 🌰</label>
        <input class="field" type="number" id="ep-resellPrice" value="${resell}" placeholder="0 = 되팔기 불가" min="0">
      </div>
      <div id="ep-stockWrap" class="${it==='store'?'':'hidden'}">
        <label class="text-xs font-bold text-gray-500 mb-1 block">판매 수량</label>
        <div class="flex gap-2">
          <select class="field" id="ep-stockType" onchange="toggleEditStock()" style="flex:1">
            <option value="unlimited" ${(p.stock===null||p.stock===undefined||p.stock<0)?'selected':''}>♾️ 무제한</option>
            <option value="limited" ${(p.stock!==null&&p.stock!==undefined&&p.stock>=0)?'selected':''}>🔢 수량 제한</option>
          </select>
          <input class="field" type="number" id="ep-stock" value="${(p.stock!==null&&p.stock!==undefined&&p.stock>=0)?p.stock:''}"
            placeholder="개수" min="0"
            class="${(p.stock!==null&&p.stock!==undefined&&p.stock>=0)?'':'hidden'}"
            style="width:80px;flex-shrink:0;${(p.stock!==null&&p.stock!==undefined&&p.stock>=0)?'':'display:none'}">
        </div>
      </div>
      <div class="flex gap-3 pt-2">
        <button class="btn btn-gray flex-1 py-3" onclick="closeModal()">취소</button>
        <button class="btn btn-primary flex-1 py-3" onclick="saveProduct('${id}')">저장</button>
      </div>
    </div>`);
}
function toggleEditStock() {
  const type = document.getElementById('ep-stockType')?.value;
  const fld  = document.getElementById('ep-stock');
  if (fld) fld.style.display = type === 'limited' ? '' : 'none';
}
function toggleEditAcorn() { const s=document.getElementById('ep-rt'),f=document.getElementById('ep-acornWrap'); if(s&&f)f.classList.toggle('hidden',s.value!=='AUTO_ACORN'); }
function toggleEditCoupon() { const s=document.getElementById('ep-rt'),f=document.getElementById('ep-couponWrap'); if(s&&f)f.classList.toggle('hidden',s.value!=='COUPON'); }
async function saveProduct(id) {
  const it = document.getElementById('ep-itemType')?.value || 'store';
  const stockType = document.getElementById('ep-stockType')?.value || 'unlimited';
  const stockVal = stockType === 'limited'
    ? (parseInt(document.getElementById('ep-stock')?.value) ?? 0)
    : null;
  const rt = document.getElementById('ep-rt').value;
  await sb.from('products').update({
    name: document.getElementById('ep-name').value,
    price: parseInt(document.getElementById('ep-price').value)||0,
    icon: document.getElementById('ep-icon').value,
    description: document.getElementById('ep-desc').value,
    reward_type: rt,
    acorn_amt: parseInt(document.getElementById('ep-acornAmt')?.value)||0,
    item_type: it,
    probability: it === 'gacha' ? (parseFloat(document.getElementById('ep-probability')?.value)||0) : 0,
    stock: it === 'store' ? stockVal : null,
    resell_price: it === 'gacha' ? (parseInt(document.getElementById('ep-resellPrice')?.value)||0) : 0,
    discount_pct: rt === 'COUPON' ? (parseInt(document.getElementById('ep-discountPct')?.value)||0) : 0,
  }).eq('id', id);
  closeModal(); renderProductAdmin(); invalidateGachaPoolCache(); window._shopCache = null; renderShop(true); toast('✅', '수정 완료!');
}

// ──────────────────────────────────────────────
//  DRAG & DROP
// ──────────────────────────────────────────────
let _dragSrcId = null;
let _dragSrcType = null;

function drgStart(e, id, type) {
  _dragSrcId = id;
  _dragSrcType = type;
  setTimeout(() => { e.target.style.opacity = '.4'; }, 0);
  e.dataTransfer.effectAllowed = 'move';
}
function drgOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function drgEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}
async function drgDrop(e, targetId, targetType) {
  e.preventDefault();
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (!_dragSrcId || _dragSrcId === targetId || _dragSrcType !== targetType) {
    _dragSrcId = null; return;
  }

  // 같은 타입 내에서만 순서 변경
  const listEl = targetType === 'store'
    ? document.getElementById('storeProductList')
    : document.getElementById('gachaProductList');
  const cards = Array.from(listEl.querySelectorAll('[data-id]'));
  const ids = cards.map(c => c.dataset.id);

  const srcIdx = ids.indexOf(_dragSrcId);
  const tgtIdx = ids.indexOf(targetId);
  if (srcIdx === -1 || tgtIdx === -1) { _dragSrcId = null; return; }

  // 배열 순서 교환
  ids.splice(srcIdx, 1);
  ids.splice(tgtIdx, 0, _dragSrcId);

  // DB에 sort_order 저장
  await Promise.all(ids.map((id, idx) =>
    sb.from('products').update({ sort_order: idx + 1 }).eq('id', id)
  ));

  _dragSrcId = null;
  renderProductAdmin();
  playSound('click');
}

// ──────────────────────────────────────────────
//  ADMIN — QUESTS
// ──────────────────────────────────────────────
async function renderQuestAdmin() {
  const [{ data: quests }, { data: qcrs }] = await Promise.all([
    sb.from('quests').select('*').order('sort_order'),
    sb.from('quest_completion_requests').select('*, users(display_name), quests(name,icon,reward)').eq('status','pending').order('created_at',{ascending:false}),
  ]);

  const el = document.getElementById('questAdminList');
  el.innerHTML = quests?.length
    ? quests.map(q => {
        const ct = q.completion_type;
        return `<div class="flex items-center gap-2 p-3 rounded-2xl ${q.active?'bg-gray-50':'bg-red-50 opacity-60'} border-2 border-transparent">
          <div class="text-xl flex-shrink-0">${q.icon}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-black text-gray-800 text-sm">${q.name}</p>
              <span class="rep-badge ${repClass[q.repeat_type]}">${repLabel[q.repeat_type]}</span>
              <span class="${ct==='auto'?'ct-auto':'ct-approval'}">${ct==='auto'?'⚡ 자동':'👤 승인'}</span>
              ${!q.active?'<span class="rep-badge bg-red-100 text-red-600">비활성</span>':''}
            </div>
            <p class="text-xs text-gray-400">${q.description} · +${q.reward}🌰</p>
          </div>
          <button class="btn btn-blue px-2 py-1 text-xs flex-shrink-0" onclick="editQuest('${q.id}')">수정</button>
          <label class="toggle-wrap flex-shrink-0"><input type="checkbox" ${q.active?'checked':''} onchange="toggleQuestActive('${q.id}')"><span class="toggle-slider"></span></label>
          <button class="btn btn-red px-2 py-1 text-xs flex-shrink-0" onclick="deleteQuest('${q.id}')">삭제</button>
        </div>`;
      }).join('')
    : '<p class="text-sm text-gray-400 text-center py-4">퀘스트가 없어요</p>';

  const apEl = document.getElementById('questApprovalList');
  const apCard = document.getElementById('questApprovalCard');
  const apTitle = document.getElementById('questApprovalTitle');
  const pendingCount = qcrs?.length || 0;
  // 대기 건수에 따라 카드 강조
  if (apCard) {
    apCard.style.border = pendingCount > 0 ? '2px solid rgba(236,72,153,0.5)' : '';
    apCard.style.background = pendingCount > 0 ? 'rgba(253,242,248,0.8)' : '';
  }
  if (apTitle) {
    apTitle.textContent = pendingCount > 0 ? `✋ 완료 승인 요청 (${pendingCount}건 대기중)` : '✋ 완료 승인 요청';
    apTitle.style.color = pendingCount > 0 ? '#be185d' : '';
  }
  apEl.innerHTML = qcrs?.length
    ? qcrs.map(r => `<div class="p-4 rounded-2xl bg-pink-50 border border-pink-100 flex flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xl">${r.quests?.icon||'📋'}</span>
              <p class="font-black text-gray-800 text-sm">${r.quests?.name||'퀘스트'}</p>
              <span class="ct-approval">👤 승인 필요</span>
            </div>
            <p class="text-xs text-gray-400 mt-1">${r.users?.display_name||''} · ${fmtTs(r.created_at)}</p>
          </div>
          <span class="font-black text-amber-600 flex-shrink-0">+${r.quests?.reward||0}🌰</span>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-green flex-1 py-2 text-sm" onclick="approveQuestReq('${r.id}')">✅ 승인하기</button>
          <button class="btn btn-red flex-1 py-2 text-sm" onclick="rejectQuestReq('${r.id}')">❌ 거절</button>
        </div>
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-4">대기중인 요청이 없어요</p>';
}

function toggleQuestCount() {
  const type = document.getElementById('nq-countType')?.value;
  const wrap = document.getElementById('nq-countWrap');
  if (wrap) wrap.classList.toggle('hidden', type !== 'multi');
}

async function addQuest() {
  const name = document.getElementById('nq-name').value.trim();
  const desc = document.getElementById('nq-desc').value;
  const reward = parseInt(document.getElementById('nq-reward').value);
  const icon = document.getElementById('nq-icon').value || '📋';
  const repeat = document.getElementById('nq-repeat').value;
  const ct = document.getElementById('nq-completionType').value;
  const countType = document.getElementById('nq-countType')?.value || 'once';
  const targetCount = countType === 'multi' ? (parseInt(document.getElementById('nq-targetCount')?.value) || 1) : 1;
  if (!name || !reward) { toast('❌', '이름과 보상을 입력해주세요'); return; }
  const { count } = await sb.from('quests').select('*',{count:'exact',head:true});
  await sb.from('quests').insert({ name, target_count: targetCount, description:desc, icon, reward, repeat_type:repeat, completion_type:ct, sort_order:(count||0)+1 });
  ['nq-name','nq-desc','nq-reward','nq-icon'].forEach(id => document.getElementById(id).value='');
  renderQuestAdmin(); toast('✅', '퀘스트 추가 완료!');
}

async function deleteQuest(id) {
  if (!confirm('퀘스트를 삭제할까요?')) return;
  await sb.from('quests').delete().eq('id', id);
  renderQuestAdmin(); toast('🗑️', '퀘스트 삭제됨');
}

async function toggleQuestActive(id) {
  const { data: q } = await sb.from('quests').select('active').eq('id', id).single();
  await sb.from('quests').update({ active: !q.active }).eq('id', id);
  renderQuestAdmin(); toast(q.active?'⏸️':'✅', q.active?'비활성화됨':'활성화됨');
}

async function editQuest(id) {
  const { data: q } = await sb.from('quests').select('*').eq('id', id).single();
  showModal(`
    <h2 class="text-lg font-black text-gray-800 mb-4">✏️ 퀘스트 수정</h2>
    <div class="space-y-3">
      <input class="field" id="eq-name" value="${q.name}">
      <input class="field" id="eq-desc" value="${q.description}">
      <div class="grid grid-cols-2 gap-2">
        <input class="field" type="number" id="eq-reward" value="${q.reward}">
        <input class="field" id="eq-icon" value="${q.icon}">
      </div>
      <select class="field" id="eq-repeat">
        <option value="once" ${q.repeat_type==='once'?'selected':''}>1회성</option>
        <option value="daily" ${q.repeat_type==='daily'?'selected':''}>일일</option>
        <option value="weekly" ${q.repeat_type==='weekly'?'selected':''}>주간</option>
      </select>
      <select class="field" id="eq-ct">
        <option value="auto" ${q.completion_type==='auto'?'selected':''}>⚡ 자동 완료</option>
        <option value="approval" ${q.completion_type==='approval'?'selected':''}>👤 관리자 승인</option>
      </select>
      <div class="flex gap-3 pt-2">
        <button class="btn btn-gray flex-1 py-3" onclick="closeModal()">취소</button>
        <button class="btn btn-primary flex-1 py-3" onclick="saveQuest('${id}')">저장</button>
      </div>
    </div>`);
}

async function saveQuest(id) {
  await sb.from('quests').update({
    name: document.getElementById('eq-name').value,
    description: document.getElementById('eq-desc').value,
    reward: parseInt(document.getElementById('eq-reward').value)||0,
    icon: document.getElementById('eq-icon').value,
    repeat_type: document.getElementById('eq-repeat').value,
    completion_type: document.getElementById('eq-ct').value,
  }).eq('id', id);
  closeModal(); renderQuestAdmin(); toast('✅', '퀘스트 수정 완료!');
}

async function approveQuestReq(reqId) {
  playSound('approve');
  // 승인 전 요청 정보 조회 (user_id 확보)
  const { data: qcr } = await sb.from('quest_completion_requests')
    .select('user_id').eq('id', reqId).maybeSingle();

  const res = await sb.rpc('approve_quest_request', { p_request_id: reqId });
  if (!res.data?.success) { toast('❌', '처리 실패: ' + (res.data?.error||'')); return; }

  // 승인된 유저의 "퀘스트 N회 완료하기" 카운트 업데이트
  if (qcr?.user_id) await incrementQuestComplete(qcr.user_id);

  renderQuestAdmin(); toast('✅', '퀘스트 승인 완료!');
}

// 특정 유저의 questComplete 카운트를 DB에서 직접 업데이트
async function incrementQuestComplete(userId) {
  try {
    const { data: quests } = await sb.from('quests')
      .select('*').eq('active', true).eq('completion_type', 'auto');
    if (!quests) return;
    for (const q of quests) {
      const isQC = (q.target_count||1) >= 2 &&
        (q.name.includes('퀘스트') || q.description.includes('퀘스트') || q.description.includes('완료'));
      if (!isQC) continue;
      const key = getPeriodKey(q.repeat_type);
      const { data: prog } = await sb.from('quest_progress')
        .select('id, progress_count')
        .eq('user_id', userId).eq('quest_id', q.id).eq('period_key', key)
        .maybeSingle();
      const current = (prog?.progress_count || 0) + 1;
      if (current < (q.target_count||1)) {
        await upsertQuestProgress(userId, q.id, key, current);
      } else if (!prog || (prog.progress_count||0) < (q.target_count||1)) {
        // 목표 달성 → 보상 지급
        await upsertQuestProgress(userId, q.id, key, q.target_count);
        await sb.rpc('adjust_acorns', { p_user_id: userId, p_amount: q.reward, p_reason: `퀘스트 자동완료 — ${q.name}` });
        await pushNotif(userId, 'quest', '퀘스트 완료! 🎉', `${q.icon} ${q.name} 완료! +${q.reward}🌰`);
      }
    }
  } catch(e) {}
}

async function rejectQuestReq(reqId) {
  const { data: r } = await sb.from('quest_completion_requests').select('*, quests(name,icon), users(display_name)').eq('id', reqId).single();
  await sb.from('quest_completion_requests').update({ status: 'rejected' }).eq('id', reqId);
  if (r) await pushNotif(r.user_id, 'quest_rejected', '퀘스트 거절 ❌', `${r.quests?.icon||''} ${r.quests?.name||''} 완료 요청이 거절되었어요.`);
  renderQuestAdmin(); toast('❌', '거절 완료');
}

// ──────────────────────────────────────────────
//  ADMIN — REQUESTS
// ──────────────────────────────────────────────
async function renderRequestAdmin() {
  const { data: list } = await sb.from('product_requests')
    .select('*, users(display_name)')
    .order('created_at', { ascending: false })
    .limit(50);
  const el = document.getElementById('requestAdminList');
  let items = list || [];
  if (reqFilter !== 'all') items = items.filter(r => r.status === reqFilter);
  // pending 항상 상단 고정 (같은 상태 내에서는 최신순 유지)
  if (reqFilter === 'all') {
    items.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return 0;
    });
  }
  el.innerHTML = items.length
    ? items.map(r => `<div class="p-4 rounded-2xl flex flex-col gap-2" style="${r.status==='pending'?'background:rgba(254,243,199,0.7);border:1.5px solid rgba(245,158,11,0.3)':'background:#f9fafb'}">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-black text-gray-800 text-sm">${r.status==='pending'?'🔔 ':''}${r.product_snapshot?.icon||'🎁'} ${r.product_snapshot?.name||'상품'}</p>
            <p class="text-xs text-gray-400 mt-0.5">${r.users?.display_name||''} · ${fmtTs(r.created_at)}${r.price?` · ${r.price}🌰`:''}${r.from_gacha?' · 🎲':''}</p>
          </div>
          <span class="badge ${stClass(r.status)} flex-shrink-0">${stLabel(r.status)}</span>
        </div>
        ${r.status==='pending'?`<div class="flex gap-2">
          <button class="btn btn-green flex-1 py-2 text-sm" onclick="updateReq('${r.id}','approved')">✅ 승인</button>
          <button class="btn btn-red flex-1 py-2 text-sm" onclick="updateReq('${r.id}','rejected')">❌ 거절</button>
        </div>`:''}
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-6">신청 내역 없음</p>';
}

async function updateReq(id, status) {
  playSound(status === 'approved' ? 'approve' : 'reject');
  const { data: r } = await sb.from('product_requests').select('*, users(display_name)').eq('id', id).single();
  await sb.from('product_requests').update({ status }).eq('id', id);

  // 인벤토리 아이템 사용신청인 경우 → 승인 시 'used', 거절 시 'held'로 복구
  if (r?.inventory_id) {
    await sb.from('inventory').update({
      status: status === 'approved' ? 'used' : 'held'
    }).eq('id', r.inventory_id);
    // 로컬 pending 캐시에서도 제거
    if (window._pendingInvIds) window._pendingInvIds.delete(r.inventory_id);
  }

  if (r) await pushNotif(r.user_id, status==='approved'?'approved':'rejected',
    status==='approved'?'신청 승인! ✅':'신청 거절 ❌',
    status==='approved'?`${r.product_snapshot?.name||'상품'} 신청이 승인되었어요!`:`${r.product_snapshot?.name||'상품'} 신청이 거절되었어요.`);
  renderRequestAdmin();
  updateReqBadge();
  toast(status==='approved'?'✅':'❌', status==='approved'?'승인했어요!':'거절했어요');
}

function filterReqs(f, btn) {
  reqFilter = f;
  document.querySelectorAll('#atab-requests .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); renderRequestAdmin();
}

// ──────────────────────────────────────────────
//  ADMIN — TX LOG
// ──────────────────────────────────────────────
async function populateLogFilter() {
  await populateGiveSelect();
}

// ── 사용자 현황판 ──
// 사용자별 뽑기 날짜 페이지 상태
const _statusPage = {}; // { userId: dateIndex }

async function renderTxLog() {
  const btnList = document.getElementById('logUserBtnList');
  const el = document.getElementById('userStatusList');
  btnList.innerHTML = '<p class="text-sm text-gray-400">불러오는 중...</p>';
  el.innerHTML = '';
  // 탭 재진입 시 캐시 초기화 (최신 데이터 반영)
  window._userLogCache = {};
  _statusPage && Object.keys(_statusPage).forEach(k => delete _statusPage[k]);

  const { data: users, error: uErr } = await sb.from('users').select('id, display_name, acorns, avatar_emoji').order('display_name');
  if (uErr) { btnList.innerHTML = `<p class="text-sm text-red-400">로드 실패: ${uErr.message}</p>`; return; }
  if (!users?.length) { btnList.innerHTML = '<p class="text-sm text-gray-400">사용자 없음</p>'; return; }

  // 사용자 버튼 목록
  window._logUsers = users;
  btnList.innerHTML = users.map(u => `
    <button id="logBtn-${u.id}" onclick="selectLogUser('${u.id}')"
      style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:16px;border:1.5px solid rgba(200,180,240,0.3);background:rgba(255,255,255,0.7);font-family:'Jua',sans-serif;font-size:13px;color:#4b3060;cursor:pointer;transition:all .15s">
      <span>${u.avatar_emoji || '🐿️'}</span>
      <span>${u.display_name}</span>
      <span style="font-size:11px;color:#a78bfa">🌰${u.acorns||0}</span>
    </button>`).join('');
}

function selectLogUser(uid) {
  // 버튼 활성화 표시
  document.querySelectorAll('[id^="logBtn-"]').forEach(b => {
    b.style.background = 'rgba(255,255,255,0.7)';
    b.style.borderColor = 'rgba(200,180,240,0.3)';
    b.style.color = '#4b3060';
  });
  const activeBtn = document.getElementById('logBtn-' + uid);
  if (activeBtn) {
    activeBtn.style.background = 'linear-gradient(135deg,#ff8fab,#c084fc)';
    activeBtn.style.borderColor = 'transparent';
    activeBtn.style.color = '#fff';
  }

  // 카드 렌더 (날짜 인덱스 리셋, 캐시는 유지)
  _statusPage[uid] = 0;
  const el = document.getElementById('userStatusList');
  el.innerHTML = '';
  const u = (window._logUsers || []).find(x => x.id === uid);
  if (!u) return;
  const card = document.createElement('div');
  card.className = 'status-card';
  card.id = 'sc-' + u.id;
  el.appendChild(card);
  renderUserStatusCard(u, card);
}

async function renderUserStatusCard(u, card) {
  const uid = u.id;

  // ── 캐시 확인: 같은 사용자 데이터는 탭 내에서 재사용 ──
  if (!window._userLogCache) window._userLogCache = {};
  if (!window._userLogCache[uid]) {
    const [
      { data: gachaLogs },
      { data: txLogs },
      { data: heldInv }
    ] = await Promise.all([
      sb.from('gacha_logs').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(500),
      sb.from('transactions').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(500),
      sb.from('inventory').select('*, product_snapshot').eq('user_id', uid).in('status', ['held', 'pending']).order('created_at', { ascending: false })
    ]);

    const gachaSessions = buildGachaSessions(gachaLogs || []);
    const eventsByDate = {};
    gachaSessions.forEach(s => {
      if (!eventsByDate[s.date]) eventsByDate[s.date] = [];
      eventsByDate[s.date].push({ type: 'gacha', time_ts: new Date(s.firstTime).getTime(), session: s });
    });
    (txLogs || []).forEach(tx => {
      const d = toDateStr(new Date(tx.created_at));
      if (!eventsByDate[d]) eventsByDate[d] = [];
      eventsByDate[d].push({ type: 'tx', time_ts: new Date(tx.created_at).getTime(), tx });
    });
    Object.keys(eventsByDate).forEach(d => {
      eventsByDate[d].sort((a, b) => b.time_ts - a.time_ts);
    });
    window._userLogCache[uid] = {
      eventsByDate,
      dates: Object.keys(eventsByDate).sort((a, b) => b.localeCompare(a)),
      heldInv: heldInv || []
    };
  }

  const { eventsByDate, dates, heldInv } = window._userLogCache[uid];
  if (!_statusPage[uid]) _statusPage[uid] = 0;
  const curIdx = Math.min(_statusPage[uid], Math.max(0, dates.length - 1));

  const avatarEmoji = u.avatar_emoji || '🐿️';
  let html = `<div class="status-card-header">
    <span class="sc-avatar">${avatarEmoji}</span>
    <div><div class="sc-name">${u.display_name}</div></div>
    <span class="sc-acorn">🌰 ${u.acorns || 0}</span>
  </div>
  <div class="sc-body">`;

  if (dates.length === 0) {
    html += `<p style="font-size:11px;color:#d1d5db;font-weight:700;text-align:center;padding:16px 0">활동 내역 없음</p>`;
  } else {
    const curDate = dates[curIdx];
    const events  = eventsByDate[curDate];
    const isToday     = curDate === todayStr();
    const isYesterday = curDate === yesterdayStr();
    const dateLabel   = isToday ? `오늘 (${formatDateShort(curDate)})` : isYesterday ? `어제 (${formatDateShort(curDate)})` : formatDateShort(curDate);

    html += `<div class="date-nav">
      <button class="date-arrow" onclick="changeStatusDate('${uid}',1)" ${curIdx >= dates.length-1 ? 'disabled' : ''}>◀</button>
      <div class="date-center">
        <div class="date-center-label">${dateLabel}</div>
        <span class="date-center-sub">${events.length}건의 활동</span>
      </div>
      <button class="date-arrow" onclick="changeStatusDate('${uid}',-1)" ${curIdx <= 0 ? 'disabled' : ''}>▶</button>
    </div>`;

    events.forEach((ev, ei) => {
      if (ev.type === 'gacha') {
        const s = ev.session;
        const sessionId = `gs-${uid}-${curIdx}-${ei}`;
        const hasItems  = s.items.some(l => l.reward_type !== 'AUTO_ACORN' && l.reward_type !== 'GIFT_ACORN' && l.reward_type !== 'GACHA_TICKET' && l.reward_type !== 'GIFT_GACHA_TICKET');
        const hasTicket = s.items.some(l => l.reward_type === 'GACHA_TICKET' || l.reward_type === 'GIFT_GACHA_TICKET');
        const subParts  = [];
        if (s.acornGain > 0) subParts.push(`획득 +${s.acornGain}🌰`);
        if (hasItems)  subParts.push('아이템 획득');
        if (hasTicket) subParts.push('티켓 획득');
        const subText = subParts.length ? subParts.join(' · ') : '획득 없음';

        html += `<div class="ev-card">
          <div class="ev-row" onclick="toggleEvBody('${sessionId}')">
            <span class="ev-icon">🎲</span>
            <div class="ev-body">
              <div class="ev-title">${s.items.length}회 뽑기</div>
              <div class="ev-sub">${subText}</div>
            </div>
            <div class="ev-right">
              <span class="ev-time">${s.timeLabel}</span>
              <span class="ev-arrow" id="arr-${sessionId}">▼</span>
            </div>
          </div>
          <div class="gsc-body closed" id="${sessionId}">
            ${s.items.map(log => {
              const isAcorn  = log.reward_type === 'AUTO_ACORN' || log.reward_type === 'GIFT_ACORN';
              const isTicket = log.reward_type === 'GACHA_TICKET' || log.reward_type === 'GIFT_GACHA_TICKET';
              const amt = isAcorn  ? `<span class="g-chip-amt a">+${log.acorn_amt||0}🌰</span>`
                        : isTicket ? `<span class="g-chip-amt t">+1장</span>`
                        : `<span class="g-chip-amt i">아이템</span>`;
              return `<div class="g-chip ${isAcorn?'acorn':isTicket?'ticket':''}">
                <span class="g-chip-icon">${log.item_icon||'📦'}</span>
                <span class="g-chip-name">${log.item_name||'아이템'}</span>
                ${amt}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      } else {
        const tx   = ev.tx;
        const isPlus = tx.amount > 0;
        const amtText = `${isPlus?'+':''}${tx.amount}🌰`;
        const icon = tx.reason?.includes('퀘스트') ? '📋'
                   : tx.reason?.includes('관리자') ? '👑'
                   : tx.reason?.includes('선물')   ? '🎁'
                   : tx.reason?.includes('뽑기')   ? '🎲'
                   : tx.reason?.includes('구매')   ? '🛍️'
                   : tx.reason?.includes('되팔기') ? '♻️'
                   : '🌰';
        html += `<div class="ev-card">
          <div class="ev-row no-click">
            <span class="ev-icon">${icon}</span>
            <div class="ev-body">
              <div class="ev-title">${tx.reason||'도토리 변동'}</div>
            </div>
            <div class="ev-right">
              <span class="ev-amt ${isPlus?'tx-plus':'tx-minus'}">${amtText}</span>
              <span class="ev-time">${fmtTime(tx.created_at)}</span>
            </div>
          </div>
        </div>`;
      }
    });
  }

  html += `<div class="sc-divider"></div>
  <span class="sc-label">인벤토리 (${heldInv.length}개)</span>`;
  if (!heldInv.length) {
    html += `<div class="inv-grid2"><span class="inv-empty2">보유 아이템 없음</span></div>`;
  } else {
    html += `<div class="inv-grid2">`;
    heldInv.forEach(item => {
      const p = item.product_snapshot || {};
      const isPending = item.status === 'pending';
      html += `<div class="inv-chip2 ${isPending?'pending':''}">
        <span class="ic2-icon">${p.icon||'📦'}</span>
        <div>
          <div class="ic2-name">${p.name||'아이템'}</div>
          <div class="ic2-status ${isPending?'ic2-pending':'ic2-held'}">${isPending?'⏳ 대기중':'📦 보관중'}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  card.innerHTML = html;
}

function toggleEvBody(id) {
  const body  = document.getElementById(id);
  const arrow = document.getElementById('arr-' + id);
  if (!body || !arrow) return;
  body.classList.toggle('closed');
  arrow.classList.toggle('open');
}

function buildGachaSessions(logs) {
  // gacha_logs를 session_id 기준으로 회차 묶기
  if (!logs.length) return [];

  const sessionMap = {};
  const sessionOrder = [];

  logs.forEach(log => {
    const sid = log.session_id;
    if (!sessionMap[sid]) {
      const t = new Date(log.created_at);
      sessionMap[sid] = {
        session_id: sid,
        date: toDateStr(t),
        firstTime: log.created_at,
        timeLabel: fmtTime(log.created_at),
        items: [],
        acornGain: 0
      };
      sessionOrder.push(sid);
    }
    sessionMap[sid].items.push(log);
    if (log.reward_type === 'AUTO_ACORN') {
      sessionMap[sid].acornGain += (log.acorn_amt || 0);
    }
  });

  // 시간 내림차순 정렬
  return sessionOrder
    .map(sid => sessionMap[sid])
    .sort((a, b) => new Date(b.firstTime) - new Date(a.firstTime));
}

function toggleGscBody(id) {
  const body  = document.getElementById(id);
  const arrow = document.getElementById('arr-' + id);
  if (!body || !arrow) return;
  const isClosed = body.classList.contains('closed');
  body.classList.toggle('closed', !isClosed);
  arrow.classList.toggle('open', isClosed);
}

function changeStatusDate(uid, delta) {
  _statusPage[uid] = (_statusPage[uid] || 0) + delta;
  const card = document.getElementById('sc-' + uid);
  if (!card) return;
  // 캐시된 사용자 정보로 바로 렌더 (DB 재조회 없음)
  const u = (window._logUsers || []).find(x => x.id === uid);
  if (u) renderUserStatusCard(u, card);
}

function todayStr() {
  return toDateStr(new Date());
}
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return toDateStr(d);
}
function toDateStr(d) {
  return d.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\. /g,'-').replace(/\.$/,'');
}
function formatDateShort(dateStr) {
  // "2025-02-27" → "2/27"
  const parts = dateStr.split('-');
  if (parts.length >= 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  return dateStr;
}
function fmtTime(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
  return `${h >= 12 ? '오후' : '오전'} ${h > 12 ? h-12 : h}:${m}`;
}

// ──────────────────────────────────────────────
//  ADMIN — USERS
// ──────────────────────────────────────────────
async function renderUserAdmin() {
  const { data: users } = await sb.from('users').select('*').order('acorns', { ascending: false });
  const el = document.getElementById('userAdminList');
  el.innerHTML = users?.length
    ? users.map(u => `<div class="flex items-center gap-3 p-3 rounded-2xl" style="background:#f9fafb">
        <div class="text-2xl">${u.avatar_emoji||'🐿️'}</div>
        <div class="flex-1 min-w-0">
          <p class="font-black text-gray-800 text-sm">${u.display_name}${u.is_admin?' 👑':''}</p>
          <p class="text-xs text-gray-400">가입: ${fmtTs(u.created_at)}</p>
          <p class="text-xs" style="color:#a78bfa">🕐 최근접속: ${u.last_seen_at ? fmtTs(u.last_seen_at) : '기록없음'}</p>
        </div>
        <div class="flex flex-col items-end gap-1">
          <div class="font-black text-amber-600 text-sm">🌰 ${u.acorns}</div>
          ${u.is_admin ? '' : `<button class="btn btn-purple px-2 py-1 text-xs" onclick="showGiftItemModal('${u.id}','${u.display_name}')">🎁 선물</button>`}
        </div>
      </div>`).join('')
    : '<p class="text-sm text-gray-400 text-center py-6">회원이 없어요</p>';
}

async function showGiftItemModal(userId, userName) {
  const { data: products } = await sb.from('products')
    .select('id,name,icon,reward_type,acorn_amt').eq('active', true)
    .order('name');
  if (!products?.length) { toast('❌', '선물할 상품이 없어요'); return; }

  // AUTO_ACORN 제외 (도토리=지급메뉴에서 처리), GACHA_TICKET은 허용
  const giftable = (products || []).filter(p => p.reward_type !== 'AUTO_ACORN');
  if (!giftable.length) { toast('❌', '선물 가능한 상품이 없어요'); return; }

  const typeLabel = p => {
    if (p.reward_type === 'ACORN_TICKET') return '🌰 도토리티켓';
    if (p.reward_type === 'COUPON')       return '🎟️ 쿠폰';
    return '📬 아이템';
  };

  showModal(`
    <div>
      <div class="text-center mb-4">
        <div style="font-size:2rem">🎁</div>
        <h2 class="text-lg font-black text-gray-800">${userName}님께 선물</h2>
        <p class="text-xs text-gray-400 mt-1">인벤토리에 바로 추가됩니다</p>
      </div>
      <select id="giftProductId" class="field w-full mb-3">
        <option value="">상품 선택</option>
        ${giftable.map(p => `<option value="${p.id}">${p.icon} ${p.name} (${typeLabel(p)})</option>`).join('')}
      </select>
      <input type="number" id="giftQty" class="field w-full mb-4" placeholder="수량 (기본 1)" min="1" max="99" value="1">
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-purple flex-1 py-2" onclick="confirmGiftItem('${userId}','${userName}')">🎁 선물하기</button>
      </div>
    </div>`);
}

async function confirmGiftItem(userId, userName) {
  const productId = document.getElementById('giftProductId')?.value;
  const qty = parseInt(document.getElementById('giftQty')?.value) || 1;
  if (!productId) { toast('❌', '상품을 선택해주세요'); return; }

  const { data: p } = await sb.from('products').select('*').eq('id', productId).single();
  if (!p) { toast('❌', '상품을 찾을 수 없어요'); return; }

  closeModal();

  // 뽑기 티켓: gacha_tickets 카운터에 직접 추가
  if (p.reward_type === 'GACHA_TICKET') {
    const { data: tr, error: trErr } = await sb.rpc('adjust_gacha_tickets', {
      p_user_id: userId, p_amount: qty
    });
    if (trErr) { toast('❌', '선물 실패: ' + trErr.message); return; }
    await pushNotif(userId, 'reward', '선물 도착! 🎁', `관리자가 🎫 뽑기 티켓 ${qty}장을 선물했어요!`);
    toast('🎁', `${userName}님께 🎫 뽑기 티켓 ${qty}장 선물했어요!`);
    playSound('approve');
    return;
  }

  // 일반 아이템: 수량만큼 인벤토리에 추가
  const rows = Array.from({ length: qty }, () => ({
    user_id: userId,
    product_id: p.id,
    product_snapshot: p,
    from_gacha: false,
    status: 'held'
  }));
  const { error } = await sb.from('inventory').insert(rows);
  if (error) { toast('❌', '선물 실패: ' + error.message); return; }

  await pushNotif(userId, 'request', '선물 도착! 🎁', `관리자가 ${p.icon} ${p.name}을(를) ${qty}개 선물했어요! 인벤토리를 확인하세요.`);
  toast('🎁', `${userName}님께 ${p.icon} ${p.name} ${qty}개 선물했어요!`);
  playSound('approve');
}

// ──────────────────────────────────────────────

//  ADMIN — DASHBOARD
// ──────────────────────────────────────────────
async function renderDashboard() {
  const todayStart = getToday() + 'T00:00:00+09:00'; // KST 자정 기준
  const [{ data: users }, { data: todayTxs }, { data: recentTxs }] = await Promise.all([
    sb.from('users').select('id', { count: 'exact' }),
    sb.from('transactions').select('amount,reason').gte('created_at', todayStart),
    sb.from('transactions').select('*, users(display_name)').order('created_at', { ascending: false }).limit(10),
  ]);

  const todayGacha = (todayTxs||[]).filter(t => t.reason?.startsWith('뽑기 사용'));
  const todayGachaCount = todayGacha.reduce((s,t) => s + Math.abs(t.amount)/GACHA_COST, 0);
  const todayGiven = (todayTxs||[]).filter(t => t.amount > 0 && !t.reason?.startsWith('뽑기 사용')).reduce((s,t)=>s+t.amount,0);
  const todayUsed  = (todayTxs||[]).filter(t => t.amount < 0).reduce((s,t)=>s+Math.abs(t.amount),0);

  document.getElementById('ds-users').textContent      = users?.length || 0;
  document.getElementById('ds-todayGacha').textContent = todayGachaCount;
  document.getElementById('ds-todayGiven').textContent = '+' + todayGiven;
  document.getElementById('ds-todayUsed').textContent  = '-' + todayUsed;

  const logEl = document.getElementById('ds-activityLog');
  logEl.innerHTML = recentTxs?.length
    ? `<div class="overflow-x-auto"><table class="w-full" style="min-width:340px">
        <thead><tr class="border-b border-gray-100 text-left">
          <th class="pb-2 font-black text-gray-400 text-xs pr-2">사용자</th>
          <th class="pb-2 font-black text-gray-400 text-xs pr-2">활동</th>
          <th class="pb-2 font-black text-gray-400 text-xs pr-2">변화</th>
          <th class="pb-2 font-black text-gray-400 text-xs">일시</th>
        </tr></thead>
        <tbody>${recentTxs.map(t=>`<tr class="border-b border-gray-50">
          <td class="py-2 pr-2 font-bold text-gray-700 text-xs whitespace-nowrap">${t.users?.display_name||''}</td>
          <td class="py-2 pr-2 text-gray-400 text-xs text-ellipsis">${t.reason}</td>
          <td class="py-2 pr-2 font-black text-sm ${t.amount>0?'tx-plus':'tx-minus'}">${t.amount>0?'+':''}${t.amount}🌰</td>
          <td class="py-2 text-gray-400 text-xs whitespace-nowrap">${fmtTs(t.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="text-sm text-gray-400 text-center py-4">활동 없음</p>';
}

// ──────────────────────────────────────────────
