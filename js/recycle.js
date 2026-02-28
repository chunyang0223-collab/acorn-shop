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

  // ── 매입 목록 UI: 이름 기준 그룹핑 ──
  // 같은 이름이면서 가격도 같으면 → 하나로 합쳐 표시 (마크 없음)
  // 같은 이름이지만 가격이 다르면 → 각각 표시 + 🛍️/🎲 마크
  const shopEl = document.getElementById('recycleShopList');
  if (shopEl) {
    if (_recycleItems.length === 0) {
      shopEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">현재 매입 중인 아이템이 없어요</p>';
    } else {
      // 이름별로 그룹핑
      const groups = {};
      _recycleItems.forEach(ri => {
        const name = ri.products?.name || '아이템';
        if (!groups[name]) groups[name] = [];
        groups[name].push(ri);
      });

      shopEl.innerHTML = Object.values(groups).map(grp => {
        const sample = grp[0];
        const p = sample.products || {};
        // 그룹 내 가격이 모두 동일한지 확인
        const allSamePrice = grp.every(ri => ri.recycle_price === sample.recycle_price);

        if (allSamePrice) {
          // 가격 동일 → 하나로 합쳐서 표시
          const types = [...new Set(grp.map(ri => ri.products?.item_type || 'store'))];
          const hasBoth = types.includes('store') && types.includes('gacha');
          const typeLabel = hasBoth
            ? '<span class="text-xs font-bold" style="color:#7c6bbf;font-size:10px">🛍️ 상점 + 🎲 뽑기</span>'
            : types[0] === 'gacha'
              ? '<span class="it-gacha text-xs" style="font-size:10px">🎲 뽑기</span>'
              : '<span class="it-store text-xs" style="font-size:10px">🛍️ 상점</span>';
          return `<div class="recycle-item-card">
            <div class="flex items-center gap-3">
              <span style="font-size:2rem">${p.icon || '🎁'}</span>
              <div>
                <div class="mb-0.5">${typeLabel}</div>
                <p class="text-sm font-black text-gray-800">${p.name || '아이템'}</p>
                <p class="text-xs text-gray-500">보유 시 판매 가능</p>
              </div>
            </div>
            <div class="text-right">
              <p class="text-lg font-black text-amber-600">+${sample.recycle_price}🌰</p>
              <p class="text-xs text-green-600 font-bold">매입 중</p>
            </div>
          </div>`;
        } else {
          // 가격 다름 → 각각 표시 + 출처 마크
          return grp.map(ri => {
            const rp = ri.products || {};
            const typeLabel = rp.item_type === 'gacha'
              ? '<span class="it-gacha text-xs" style="font-size:10px">🎲 뽑기</span>'
              : '<span class="it-store text-xs" style="font-size:10px">🛍️ 상점</span>';
            return `<div class="recycle-item-card">
              <div class="flex items-center gap-3">
                <span style="font-size:2rem">${rp.icon || '🎁'}</span>
                <div>
                  <div class="flex items-center gap-1 mb-0.5">${typeLabel}</div>
                  <p class="text-sm font-black text-gray-800">${rp.name || '아이템'}</p>
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

  // 판매 가능한 product_id 목록
  const recyclableIds = new Set(_recycleItems.map(ri => ri.product_id));
  if (recyclableIds.size === 0) {
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

  // product_id로 매칭 + pending 아이템 제외
  const sellable = (items || []).filter(item => {
    if (pendingInvIds.has(item.id)) return false;  // 승인 대기중 제외
    const pid = item.product_id || item.product_snapshot?.id;
    return pid && recyclableIds.has(pid);
  });

  if (sellable.length === 0) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  el.innerHTML = sellable.map(item => {
    const p = item.products || item.product_snapshot || {};
    const pid = item.product_id || item.product_snapshot?.id;
    const ri = _recycleItems.find(r => r.product_id === pid);
    const price = ri?.recycle_price || 0;
    const isSelected = !!_recycleSelMap[item.id];
    return `<div class="recycle-inv-card ${isSelected ? 'selected' : ''}" onclick="toggleRecycleSel('${item.id}')" data-inv-id="${item.id}" data-price="${price}">
      <div class="check-badge">✓</div>
      <span style="font-size:2rem">${p.icon || '🎁'}</span>
      <p class="text-xs font-black text-gray-700 text-center leading-tight">${p.name || '아이템'}</p>
      <span class="text-xs font-black text-amber-600">+${price}🌰</span>
      <span class="text-xs ${item.from_gacha ? 'it-gacha' : 'it-store'}">${item.from_gacha ? '🎲 뽑기' : '🛍️ 상점'}</span>
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
  // 범위 버튼 초기화
  setRecycleScope('all');
  // 매입 목록 렌더
  await renderRecycleAdminList();
}

function setRecycleScope(scope) {
  document.getElementById('rc-scope').value = scope;
  document.querySelectorAll('.rc-scope-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scope === scope);
  });
}

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

    // 범위 표시
    const types = grp.map(ri => ri.products?.item_type || 'store');
    const hasStore = types.includes('store');
    const hasGacha = types.includes('gacha');
    const scopeLabel = (hasStore && hasGacha)
      ? '<span class="text-xs font-bold" style="background:rgba(192,132,252,0.15);color:#7c3aed;padding:2px 8px;border-radius:12px">🛍️+🎲 모두</span>'
      : hasGacha
        ? '<span class="it-gacha text-xs">🎲 뽑기</span>'
        : '<span class="it-store text-xs">🛍️ 상점</span>';

    const priceDisplay = allSamePrice
      ? `<p class="text-base font-black text-amber-600">+${sample.recycle_price}🌰</p>`
      : grp.map(ri => {
          const t = ri.products?.item_type === 'gacha' ? '🎲' : '🛍️';
          return `<span class="text-sm font-black text-amber-600">${t} +${ri.recycle_price}🌰</span>`;
        }).join(' · ');

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
            <div class="flex items-center gap-2 mb-0.5">${scopeLabel}</div>
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
  const scope = document.getElementById('rc-scope')?.value || 'all';
  const price = parseInt(document.getElementById('rc-price')?.value || 0);
  if (!productName) { toast('❌', '상품을 선택해주세요'); return; }
  if (!price || price < 1) { toast('❌', '매입 가격을 입력해주세요'); return; }

  // 선택한 이름 + scope에 해당하는 product들 조회
  let query = sb.from('products').select('id,name,icon,item_type').eq('name', productName);
  if (scope === 'store') query = query.eq('item_type', 'store');
  else if (scope === 'gacha') query = query.eq('item_type', 'gacha');
  const { data: targets } = await query;

  if (!targets || targets.length === 0) {
    toast('❌', '해당 범위에 맞는 상품이 없어요'); return;
  }

  // 이미 등록된 product_id 확인 — 배치 쿼리로 한 번에 조회
  const targetIds = targets.map(t => t.id);
  const { data: existItems } = await sb.from('recycle_items').select('product_id').in('product_id', targetIds);
  const existIds = new Set((existItems || []).map(e => e.product_id));
  const newTargets = targets.filter(t => !existIds.has(t.id));

  if (newTargets.length === 0) {
    toast('❌', '선택한 범위의 상품이 이미 모두 등록되어 있어요'); return;
  }

  // 등록
  const rows = newTargets.map(t => ({
    product_id: t.id,
    recycle_price: price,
    scope: scope === 'all' ? t.item_type : scope, // 실제 item_type 저장
    active: true
  }));
  const { error } = await sb.from('recycle_items').insert(rows);
  if (error) {
    toast('❌', '등록 실패: ' + (error.message || '')); return;
  }

  const scopeLabel = scope === 'all' ? '상점+뽑기 모두' : scope === 'store' ? '상점' : '뽑기';
  document.getElementById('rc-productSelect').value = '';
  document.getElementById('rc-price').value = '';
  toast('✅', `${productName} (${scopeLabel}) 등록 완료!`);
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
