//  재활용센터
// ──────────────────────────────────────────────
let _recycleItems = [];        // 매입 목록 (DB)
let _recycleSelMap = {};       // { inventoryId: { item, recycleItem } }

// ── 사용자: 재활용센터 탭 렌더 ──
async function renderRecycleTab() {
  // 매입 목록 로드
  const { data: rItems } = await sb.from('recycle_items')
    .select('*, products(id,name,icon,item_type)')
    .eq('active', true);
  _recycleItems = rItems || [];

  // ── 매입 목록 UI: 이름 기준 그룹핑 (출처 무관, 같은 이름 = 같은 아이템) ──
  const shopEl = document.getElementById('recycleShopList');
  if (shopEl) {
    if (_recycleItems.length === 0) {
      shopEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">현재 매입 중인 아이템이 없어요</p>';
    } else {
      // 이름별 그룹핑 → 대표 가격 표시
      const groups = {};
      _recycleItems.forEach(ri => {
        const name = ri.products?.name || '아이템';
        if (!groups[name] || ri.recycle_price > groups[name].recycle_price) {
          groups[name] = ri;
        }
      });

      shopEl.innerHTML = Object.values(groups).map(ri => {
        const p = ri.products || {};
        return `<div class="recycle-item-card">
          <div class="flex items-center gap-3">
            <span style="font-size:2rem">${p.icon || '🎁'}</span>
            <div>
              <p class="text-sm font-black text-gray-800">${p.name || '아이템'}</p>
              <p class="text-xs text-gray-500">보유 시 판매 가능</p>
            </div>
          </div>
          <div class="text-right">
            <p class="text-lg font-black text-amber-600">+${ri.recycle_price}🌰</p>
            <p class="text-xs text-green-600 font-bold">매입 중</p>
          </div>
        </div>`;
      }).join('');
    }
  }

  // 내 인벤토리 중 판매 가능한 아이템 로드
  _recycleSelMap = {};
  updateRecycleSellBar();
  await renderRecycleInventory();
}

async function renderRecycleInventory() {
  const el = document.getElementById('recycleInventoryList');
  const emptyEl = document.getElementById('recycleEmptyMsg');
  if (!el) return;

  // 판매 가능한 아이템 이름 → 매입가 매핑 (이름 기준 매칭)
  const recyclableMap = {};  // { name: recycle_price }
  _recycleItems.forEach(ri => {
    const name = ri.products?.name;
    if (name && (!recyclableMap[name] || ri.recycle_price > recyclableMap[name])) {
      recyclableMap[name] = ri.recycle_price;
    }
  });
  if (Object.keys(recyclableMap).length === 0) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  // 내 인벤토리에서 held 상태 아이템 로드 (products JOIN)
  const [{ data: items }, { data: pendingReqs }] = await Promise.all([
    sb.from('inventory')
      .select('*, products(id,name,icon,reward_type)')
      .eq('user_id', myProfile.id).eq('status', 'held')
      .order('created_at', { ascending: false }),
    sb.from('product_requests')
      .select('inventory_id')
      .eq('user_id', myProfile.id).eq('status', 'pending')
  ]);

  // pending 신청 중인 inventory_id 집합 (로컬 캐시 포함)
  const pendingInvIds = new Set((pendingReqs||[]).map(r => r.inventory_id).filter(Boolean));
  if (window._pendingInvIds) window._pendingInvIds.forEach(id => pendingInvIds.add(id));

  // 이름 기준 매칭 + pending 아이템 제외
  const sellable = (items || []).filter(item => {
    if (pendingInvIds.has(item.id)) return false;
    const name = item.products?.name || item.product_snapshot?.name;
    return name && recyclableMap.hasOwnProperty(name);
  });

  if (sellable.length === 0) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  el.innerHTML = sellable.map(item => {
    const p = item.products || item.product_snapshot || {};
    const name = p.name || '아이템';
    const price = recyclableMap[name] || 0;
    const isSelected = !!_recycleSelMap[item.id];
    // 출처 라벨: 선물상자 / 뽑기 / 상점 / 기타
    const srcLabel = item.product_snapshot?.reward_type === 'REWARD_BOX' ? '🎁 보상'
      : item.from_gacha ? '🎲 뽑기'
      : item.product_id ? '🛍️ 상점' : '📦 지급';
    return `<div class="recycle-inv-card ${isSelected ? 'selected' : ''}" onclick="toggleRecycleSel('${item.id}')" data-inv-id="${item.id}" data-price="${price}">
      <div class="check-badge">✓</div>
      <span style="font-size:2rem">${p.icon || '🎁'}</span>
      <p class="text-xs font-black text-gray-700 text-center leading-tight">${name}</p>
      <span class="text-xs font-black text-amber-600">+${price}🌰</span>
      <span class="text-xs text-gray-400">${srcLabel}</span>
    </div>`;
  }).join('');
}

function toggleRecycleSel(inventoryId) {
  // 인벤토리 카드에서 직접 데이터 찾기
  const cardEl = document.querySelector(`.recycle-inv-card[data-inv-id="${inventoryId}"]`);
  if (!cardEl) return;

  if (_recycleSelMap[inventoryId]) {
    delete _recycleSelMap[inventoryId];
    cardEl.classList.remove('selected');
  } else {
    const price = parseInt(cardEl.dataset.price || '0') || 0;
    _recycleSelMap[inventoryId] = { price };
    cardEl.classList.add('selected');
  }
  updateRecycleSellBar();
}

function updateRecycleSellBar() {
  const bar = document.getElementById('recycleSellBar');
  const label = document.getElementById('recycleSellLabel');
  const sub = document.getElementById('recycleSellSub');
  const cntEl = document.getElementById('recycleSelCount');
  const keys = Object.keys(_recycleSelMap);
  const total = keys.reduce((s, id) => s + (_recycleSelMap[id].price || 0), 0);

  if (keys.length === 0) {
    if (bar) bar.classList.add('hidden');
    if (cntEl) cntEl.textContent = '';
    return;
  }
  if (bar) bar.classList.remove('hidden');
  if (label) label.textContent = `${keys.length}개 아이템 선택됨`;
  if (sub) sub.textContent = `총 +${total}🌰 받을 수 있어요`;
  if (cntEl) cntEl.textContent = `${keys.length}개 선택`;
}

async function confirmRecycleSell() {
  const keys = Object.keys(_recycleSelMap);
  if (keys.length === 0) return;
  const total = keys.reduce((s, id) => s + (_recycleSelMap[id].price || 0), 0);

  showModal(`
    <div class="text-center">
      <div style="font-size:3rem;margin-bottom:8px">♻️</div>
      <h2 class="text-lg font-black text-gray-800 mb-1">아이템 판매</h2>
      <p class="text-sm text-gray-500 mb-3">${keys.length}개 아이템을 판매해요</p>
      <div class="text-3xl font-black text-amber-600 my-3">+${total} 🌰</div>
      <div class="modal-notice-box" style="background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.25)">
        판매한 아이템은 <span class="font-black">복구되지 않아요!</span>
      </div>
      <div class="flex gap-2 mt-4">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-green flex-1 py-2" onclick="executeRecycleSell()">💰 판매!</button>
      </div>
    </div>`);
}

async function executeRecycleSell() {
  const keys = Object.keys(_recycleSelMap);
  if (keys.length === 0) return;
  closeModal();

  await withLock('recycleSell', async () => {
    let successCount = 0;
    let totalEarned = 0;

    for (const inventoryId of keys) {
      // status='held' 조건 포함해서 업데이트 → 이중 판매 방지
      const { data: updated, count } = await sb.from('inventory')
        .update({ status: 'resold' })
        .eq('id', inventoryId)
        .eq('user_id', myProfile.id)
        .eq('status', 'held')
        .select('id');
      const didUpdate = (Array.isArray(updated) && updated.length > 0)
                     || (updated && !Array.isArray(updated) && updated.id)
                     || (typeof count === 'number' && count > 0);
      if (didUpdate) {
        successCount++;
        totalEarned += (_recycleSelMap[inventoryId].price || 0);
      }
    }

    if (totalEarned > 0) {
      const res = await sb.rpc('adjust_acorns', {
        p_user_id: myProfile.id,
        p_amount: totalEarned,
        p_reason: `재활용센터 판매 ${successCount}개`
      });
      if (res.data?.success) { myProfile.acorns = res.data.balance; updateAcornDisplay(); }
      await pushNotif(myProfile.id, 'reward', '판매 완료! ♻️', `${successCount}개 아이템 판매 → +${totalEarned}🌰 획득!`);
    }

    _recycleSelMap = {};
    playSound('reward');
    toast('♻️', `${successCount}개 판매 완료! +${totalEarned}🌰`);
    await renderRecycleInventory();
    updateRecycleSellBar();
  });
}

// ── 관리자: 재활용센터 관리 ──
async function renderRecycleAdmin() {
  // 상품 드롭다운: 이름 기준 중복 제거 단일 목록 (상점/뽑기 구분 없이)
  const sel = document.getElementById('rc-productSelect');
  if (sel) {
    sel.innerHTML = '<option value="">상품을 선택하세요...</option>';
    const { data: prods } = await sb.from('products').select('id,name,icon,item_type').order('sort_order');
    if (prods) {
      // 이름 기준 중복 제거 (store 우선, 없으면 gacha)
      const seen = {};
      prods.forEach(p => {
        if (!seen[p.name]) seen[p.name] = p;
        else if (seen[p.name].item_type !== 'store' && p.item_type === 'store') seen[p.name] = p;
      });
      Object.values(seen).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; // name을 key로 사용 (scope 처리 시 name으로 검색)
        opt.textContent = `${p.icon || '🎁'} ${p.name}`;
        sel.appendChild(opt);
      });
    }
  }
  // 매입 목록 렌더
  await renderRecycleAdminList();
}

// setRecycleScope 제거됨 — 이름 기준 매칭으로 scope 불필요

async function renderRecycleAdminList() {
  const el = document.getElementById('recycleAdminList');
  if (!el) return;
  const { data: items } = await sb.from('recycle_items')
    .select('*, products(id,name,icon,item_type)')
    .order('created_at', { ascending: false });

  if (!items || items.length === 0) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">등록된 아이템이 없어요</p>';
    return;
  }

  // 이름별 그룹핑해서 같은 이름 항목은 묶어서 표시
  const adminGroups = {};
  items.forEach(ri => {
    const name = ri.products?.name || '알 수 없음';
    if (!adminGroups[name]) adminGroups[name] = [];
    adminGroups[name].push(ri);
  });

  el.innerHTML = Object.values(adminGroups).map(grp => {
    const sample = grp[0];
    const p = sample.products || {};
    const allSamePrice = grp.every(ri => ri.recycle_price === sample.recycle_price);
    const allActive = grp.every(ri => ri.active);
    const anyActive = grp.some(ri => ri.active);

    const priceDisplay = `<p class="text-base font-black text-amber-600">+${sample.recycle_price}🌰</p>`;

    // 활성 상태 (그룹 전체 기준)
    const activeStatus = allActive ? 'recycle-badge-active' : anyActive ? 'recycle-badge-inactive' : 'recycle-badge-inactive';
    const activeText = allActive ? '활성' : anyActive ? '일부활성' : '비활성';

    // 버튼: 그룹 전체 토글 / 개별 삭제
    const ids = grp.map(ri => ri.id);
    return `<div class="p-4 rounded-2xl row-item-bg space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span style="font-size:1.8rem">${p.icon || '🎁'}</span>
          <div>
            <p class="text-sm font-black text-gray-800">${p.name || '알 수 없음'}</p>
            <div class="flex items-center gap-1 mt-0.5">${priceDisplay}</div>
          </div>
        </div>
        <span class="${activeStatus}">${activeText}</span>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1 py-1 text-xs" onclick="editRecycleGroup(${JSON.stringify(ids).replace(/"/g,'&quot;')},${sample.recycle_price})">✏️ 가격 수정</button>
        <button class="btn btn-gray flex-1 py-1 text-xs" onclick="toggleRecycleGroup(${JSON.stringify(ids).replace(/"/g,'&quot;')},${allActive})">${allActive ? '⏹ 비활성화' : '✅ 활성화'}</button>
        <button class="btn py-1 px-3 text-xs" style="background:#fee2e2;color:#b91c1c" onclick="deleteRecycleGroup(${JSON.stringify(ids).replace(/"/g,'&quot;')})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function addRecycleItem() {
  const productName = document.getElementById('rc-productSelect')?.value;
  const price = parseInt(document.getElementById('rc-price')?.value || 0);
  if (!productName) { toast('❌', '상품을 선택해주세요'); return; }
  if (!price || price < 1) { toast('❌', '매입 가격을 입력해주세요'); return; }

  // 같은 이름의 모든 product 조회 (item_type 무관)
  const { data: targets } = await sb.from('products').select('id,name,icon,item_type').eq('name', productName);
  if (!targets || targets.length === 0) {
    toast('❌', '상품을 찾을 수 없어요'); return;
  }

  // 이미 등록된 product_id 확인
  const targetIds = targets.map(t => t.id);
  const { data: existItems } = await sb.from('recycle_items').select('product_id').in('product_id', targetIds);
  const existIds = new Set((existItems || []).map(e => e.product_id));
  const newTargets = targets.filter(t => !existIds.has(t.id));

  if (newTargets.length === 0) {
    toast('❌', '이미 등록된 상품이에요'); return;
  }

  // 등록 (같은 이름의 모든 타입 일괄)
  const rows = newTargets.map(t => ({
    product_id: t.id,
    recycle_price: price,
    scope: t.item_type || 'store',
    active: true
  }));
  const { error } = await sb.from('recycle_items').insert(rows);
  if (error) {
    toast('❌', '등록 실패: ' + (error.message || '')); return;
  }

  document.getElementById('rc-productSelect').value = '';
  document.getElementById('rc-price').value = '';
  toast('✅', `${productName} 등록 완료!`);
  await renderRecycleAdminList();
}

async function toggleRecycleActive(id, current) {
  await sb.from('recycle_items').update({ active: !current }).eq('id', id);
  await renderRecycleAdminList();
}

// 그룹 일괄 토글
async function toggleRecycleGroup(ids, allActive) {
  await sb.from('recycle_items').update({ active: !allActive }).in('id', ids);
  await renderRecycleAdminList();
}

// 그룹 가격 수정
async function editRecycleGroup(ids, currentPrice) {
  showModal(`
    <div class="text-center">
      <div style="font-size:2.5rem;margin-bottom:8px">✏️</div>
      <h2 class="text-lg font-black text-gray-800 mb-4">매입 가격 수정</h2>
      <div class="text-left mb-4">
        <label class="text-xs font-bold text-gray-500 mb-1 block">새 매입 가격 🌰</label>
        <input class="field" type="number" id="editRecyclePrice" value="${currentPrice}" min="1" placeholder="도토리 수량">
      </div>
      <div class="flex gap-2">
        <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
        <button class="btn btn-green flex-1 py-2 font-black" onclick="confirmEditRecycleGroup(${JSON.stringify(ids).replace(/"/g,'&quot;')})">✅ 저장</button>
      </div>
    </div>`);
  setTimeout(() => document.getElementById('editRecyclePrice')?.focus(), 100);
}

async function confirmEditRecycleGroup(ids) {
  const price = parseInt(document.getElementById('editRecyclePrice')?.value || 0);
  if (!price || price < 1) { toast('❌', '가격을 1 이상으로 입력해주세요'); return; }
  closeModal();
  await sb.from('recycle_items').update({ recycle_price: price }).in('id', ids);
  toast('✅', `매입 가격 ${price}🌰로 수정!`);
  await renderRecycleAdminList();
}

// 그룹 삭제
async function deleteRecycleGroup(ids) {
  showModal(`<div class="text-center">
    <div style="font-size:2.5rem;margin-bottom:8px">🗑️</div>
    <h2 class="text-lg font-black text-gray-800 mb-2">매입 항목 삭제</h2>
    <p class="text-sm text-gray-500 mb-4">삭제하면 사용자가 해당 아이템을 재활용센터에서 판매할 수 없어요.</p>
    <div class="flex gap-2">
      <button class="btn btn-gray flex-1 py-2" onclick="closeModal()">취소</button>
      <button class="btn flex-1 py-2 font-black" style="background:#fee2e2;color:#b91c1c" onclick="confirmDeleteRecycleGroup(${JSON.stringify(ids).replace(/"/g,'&quot;')})">삭제</button>
    </div>
  </div>`);
}

async function confirmDeleteRecycleGroup(ids) {
  closeModal();
  await sb.from('recycle_items').delete().in('id', ids);
  toast('🗑️', '삭제 완료');
  await renderRecycleAdminList();
}

// 하위 호환용 단일 함수 유지
async function deleteRecycleItem(id) { deleteRecycleGroup([id]); }
async function confirmDeleteRecycle(id) { confirmDeleteRecycleGroup([id]); }
