// ──────────────────────────────────────────────
//  SHOP
// ──────────────────────────────────────────────
async function renderShop(force = false) {
  const grid = document.getElementById('shopGrid');
  if (!force && window._shopCache) {
    storeProducts = window._shopCache;
  } else {
    grid.innerHTML = '<p class="text-sm text-gray-400 col-span-2 text-center py-4">로딩 중...</p>';
    const { data: products } = await sb.from('products').select('*').eq('active', true).eq('item_type', 'store').order('sort_order');
    storeProducts = products || [];
    window._shopCache = storeProducts;
  }
  const products = storeProducts;
  const evtStoreDiscount = getActiveEventDiscount('store');
  if (!products?.length) { grid.innerHTML = '<p class="text-sm text-gray-400 col-span-2 text-center py-8">상품이 없어요</p>'; renderShopEventBanner(); return; }
  grid.innerHTML = products.map((p,i) => {
    const unlimited = p.stock === null || p.stock === undefined || p.stock < 0;
    const soldOut   = !unlimited && p.stock <= 0;
    const stockLabel = unlimited ? '' : soldOut
      ? '<span class="badge-soldout">품절</span>'
      : `<span class="badge-stock">남은수량 ${p.stock}개</span>`;
    const discountedPrice = evtStoreDiscount > 0 ? Math.floor(p.price * (1 - evtStoreDiscount/100)) : p.price;
    const priceHtml = evtStoreDiscount > 0
      ? `<div class="text-center mb-2">
           <span class="text-xs text-gray-400 line-through">🌰 ${p.price}</span>
           <span class="font-black text-green-600 ml-1">🌰 ${discountedPrice}</span>
           <span class="text-xs text-green-700 font-bold ml-1">(-${evtStoreDiscount}%)</span>
         </div>`
      : `<div class="text-center font-black text-amber-600 mb-2">🌰 ${p.price}</div>`;
    return `
    <div class="clay-card p-4 flex flex-col bounce-in ${soldOut?'opacity-60':''}" style="animation-delay:${i*.06}s">
      <div class="text-4xl text-center mb-2">${p.icon}</div>
      <h3 class="font-black text-gray-800 text-center text-sm mb-1">${p.name}</h3>
      <p class="text-xs text-gray-400 font-semibold text-center mb-2">${p.description||''}</p>
      <div class="flex justify-center gap-1 mb-3 flex-wrap">
        <span class="${p.reward_type==='AUTO_ACORN'||p.reward_type==='ACORN_TICKET'?'rt-auto':p.reward_type==='COUPON'?'rt-coupon':p.reward_type==='GACHA_TICKET'?'rt-coupon':'rt-manual'}">${
          p.reward_type==='AUTO_ACORN'?'⚡ 즉시지급':
          p.reward_type==='ACORN_TICKET'?'🌰 도토리 티켓':
          p.reward_type==='GACHA_TICKET'?'🎫 뽑기 티켓':
          p.reward_type==='COUPON'?'🎟️ 쿠폰':'📬 승인필요'}</span>
        ${stockLabel}
      </div>
      <div class="mt-auto">
        ${priceHtml}
        ${soldOut
          ? '<button class="btn btn-gray w-full py-2 text-sm" disabled>품절</button>'
          : `<button class="btn btn-primary w-full py-2 text-sm" onclick="requestProduct('${p.id}')">구매하기</button>`
        }
      </div>
    </div>`;
  }).join('');
  renderShopEventBanner();
}

function requestProduct(id) {
  // storeProducts 캐시에서 즉시 조회 → DB 쿼리 없이 모달 즉시 오픈
  const p = storeProducts.find(x => x.id === id);
  if (!p) return;
  const unlimited = p.stock === null || p.stock === undefined || p.stock < 0;
  if (!unlimited && p.stock <= 0) { toast('❌', '품절된 상품이에요!'); renderShop(true); return; }
  // 도토리 부족 체크는 confirmRequest에서 최종 할인가 기준으로 처리
  // (쿠폰/이벤트 할인 적용 후 구매 가능할 수 있으므로 여기서 차단하지 않음)

  // 이벤트 할인 계산
  const evtDiscount = getActiveEventDiscount('store');
  const evtDiscountedPrice = evtDiscount > 0 ? Math.floor(p.price * (1 - evtDiscount/100)) : p.price;

  // 보유 쿠폰 확인
  const coupons = (window._invCache || []).filter(i => i.status === 'held' && (i.products?.reward_type || i.product_snapshot?.reward_type) === 'COUPON');
  const couponOptions = coupons.length > 0
    ? `<div class="mt-3 p-3 rounded-xl" style="background:rgba(254,249,195,0.7);border:1.5px solid rgba(251,191,36,0.4)">
        <p class="text-xs font-black text-yellow-800 mb-2">🎟️ 보유 쿠폰 선택 (선택 사항)</p>
        <select class="field text-xs" id="couponSelect" onchange="updatePurchasePrice(${p.price}, ${evtDiscountedPrice})">
          <option value="">쿠폰 사용 안 함</option>
          ${coupons.map(c => { const cp = c.products || c.product_snapshot || {}; return `<option value="${c.id}" data-pct="${cp.discount_pct||0}">${cp.icon||'🎟️'} ${cp.name} (${cp.discount_pct||0}% 할인)</option>`; }).join('')}
        </select>
      </div>`
    : '';

  const evtNotice = evtDiscount > 0
    ? `<div class="text-xs font-black text-green-700 bg-green-50 rounded-lg px-3 py-1.5 mb-2">🎉 이벤트 할인 ${evtDiscount}% 적용 중!</div>`
    : '';

  const myAcorns = myProfile.acorns || 0;
  const canAffordNow = myAcorns >= evtDiscountedPrice;
  const acornStatusHtml = `<p class="text-xs font-bold mt-2" style="color:${canAffordNow ? '#6b7280' : '#dc2626'}">
    보유 도토리: 🌰 ${myAcorns}${!canAffordNow ? ' (쿠폰 할인 후 구매 가능할 수 있어요)' : ''}
  </p>`;

  showModal(`
    <div class="text-center">
      <div style="font-size:3rem;margin-bottom:8px">${p.icon}</div>
      <h2 class="text-xl font-black text-gray-800" style="margin-bottom:6px">${p.name}</h2>
      <p class="text-sm text-gray-400" style="margin-bottom:14px">${p.description}</p>
      ${evtNotice}
      <div class="modal-notice-box">
        <p class="modal-notice-text">🌰 원가: ${p.price}
          ${evtDiscount > 0 ? `→ <span style="color:#16a34a;font-weight:900">${evtDiscountedPrice}</span> (이벤트 ${evtDiscount}% 할인)` : ''}
        </p>
        <p class="text-xs font-bold mt-1" id="finalPriceLabel" style="color:#059669">최종 결제: 🌰 ${evtDiscountedPrice}</p>
        ${acornStatusHtml}
        ${p.reward_type==='AUTO_ACORN'?`<p class="modal-notice-sub">✨ 즉시 +${p.acorn_amt} 도토리!</p>`:''}
      </div>
      ${couponOptions}
      <div class="flex gap-3" style="margin-top:12px">
        <button class="btn btn-gray flex-1 py-3" onclick="closeModal()">취소</button>
        <button class="btn btn-primary flex-1 py-3" onclick="confirmRequest('${p.id}')">구매하기!</button>
      </div>
    </div>`);
  // 초기 가격 표시를 이벤트 할인 적용 가격으로 세팅
  window._purchaseBasePrice = evtDiscountedPrice;
  window._purchaseOriginalPrice = p.price;
  window._evtDiscount = evtDiscount;
}

function updatePurchasePrice(originalPrice, evtDiscountedBase) {
  const sel = document.getElementById('couponSelect');
  const pct = sel ? parseInt(sel.options[sel.selectedIndex]?.dataset?.pct || 0) : 0;
  const finalPrice = pct > 0 ? Math.floor(evtDiscountedBase * (1 - pct/100)) : evtDiscountedBase;
  const label = document.getElementById('finalPriceLabel');
  const myAcorns = myProfile?.acorns || 0;
  const canAfford = myAcorns >= finalPrice;
  if (label) {
    label.textContent = `최종 결제: 🌰 ${finalPrice}${pct > 0 ? ` (쿠폰 ${pct}% 추가 할인)` : ''}`;
    label.style.color = canAfford ? '#059669' : '#dc2626';
  }
  // 보유 도토리 상태 텍스트 업데이트
  const acornStatus = label?.nextElementSibling;
  if (acornStatus && acornStatus.tagName === 'P') {
    acornStatus.textContent = `보유 도토리: 🌰 ${myAcorns}`;
    acornStatus.style.color = canAfford ? '#6b7280' : '#dc2626';
  }
  window._purchaseBasePrice = finalPrice;
  window._selectedCouponId = (sel && sel.value) ? sel.value : null;
  window._couponDiscountPct = pct;
}

async function confirmRequest(productId) {
  await withLock('purchase_'+productId, async () => { await _confirmRequestInner(productId); });
}
async function _confirmRequestInner(productId) {
  closeModal();
  if (window._buyLock) return;
  window._buyLock = true;

  try {
    const { data: p } = await sb.from('products').select('*').eq('id', productId).single();
    if (!p) { toast('❌', '상품을 찾을 수 없어요'); return; }

    // 최종 가격 결정 (이벤트 할인 + 쿠폰 할인 순차 적용)
    const couponId = window._selectedCouponId || null;
    const couponPct = window._couponDiscountPct || 0;
    const evtDiscount = window._evtDiscount || 0;

    let finalPrice = p.price;
    if (evtDiscount > 0) finalPrice = Math.floor(finalPrice * (1 - evtDiscount/100));
    if (couponPct > 0) finalPrice = Math.floor(finalPrice * (1 - couponPct/100));

    // 잔액 확인
    if ((myProfile.acorns || 0) < finalPrice) { toast('❌', '도토리 부족!'); return; }

    const unlimited = p.stock === null || p.stock === undefined || p.stock < 0;
    if (!unlimited && p.stock <= 0) { toast('❌', '품절된 상품이에요!'); renderShop(true); return; }

    // 이미 pending 신청이 있으면 중복 방지 (상점 구매 신청끼리만 체크 — 인벤토리 사용신청과 구분)
    if (p.reward_type !== 'AUTO_ACORN') {
      const { data: existingReq } = await sb.from('product_requests')
        .select('id').eq('user_id', myProfile.id).eq('product_id', productId)
        .eq('status', 'pending').eq('from_gacha', false).neq('price', 0).limit(1);
      if (existingReq && existingReq.length > 0) {
        toast('⏳', '이미 승인 대기 중인 신청이 있어요!'); return;
      }
    }

    // 쿠폰 소모 (먼저 처리 — 중복 사용 방지)
    if (couponId) {
      await sb.from('inventory').update({ status: 'used' }).eq('id', couponId);
      // 캐시에서도 제거
      if (window._invCache) window._invCache = window._invCache.filter(i => i.id !== couponId);
    }

    const reasonSuffix = (evtDiscount > 0 || couponPct > 0)
      ? ` (할인: ${evtDiscount > 0 ? '이벤트 ' + evtDiscount + '%' : ''}${evtDiscount > 0 && couponPct > 0 ? ' + ' : ''}${couponPct > 0 ? '쿠폰 ' + couponPct + '%' : ''})`
      : '';
    const res = await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: -finalPrice, p_reason: `상품 구매 — ${p.icon} ${p.name}${reasonSuffix}` });
    if (!res.data?.success) { toast('❌', '처리 실패: ' + (res.data?.error || '')); return; }
    myProfile.acorns = res.data.balance;

    if (!unlimited) {
      await sb.from('products').update({ stock: p.stock - 1 }).eq('id', productId);
    }

    // 구매 완료 후 전역 변수 초기화
    window._selectedCouponId = null;
    window._couponDiscountPct = 0;
    window._evtDiscount = 0;

    if (p.reward_type === 'MANUAL_ITEM') {
      await sb.from('inventory').insert({
        user_id: myProfile.id, product_id: p.id, product_snapshot: p, from_gacha: false, status: 'held'
      });
      await pushNotif(myProfile.id, 'request', '아이템 획득! 🎁', `${p.icon} ${p.name} 획득! 인벤토리에서 확인하세요.`);
      playSound('reward');
      toast('🎒', `${p.icon} ${p.name} 인벤토리에 추가됐어요!`);
      updateAcornDisplay();
      renderShop(true);
      return;
    }

    await sb.from('product_requests').insert({
      user_id: myProfile.id, product_id: p.id,
      product_snapshot: p, price: finalPrice, status: 'approved',
      reward_type: p.reward_type, from_gacha: false
    });

    if (p.reward_type === 'AUTO_ACORN') {
      await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: p.acorn_amt, p_reason: `자동 보상 — ${p.name}` });
      myProfile.acorns += p.acorn_amt;
      await pushNotif(myProfile.id, 'reward', '보상 지급! ⚡', `${p.name} 교환으로 +${p.acorn_amt}🌰!`);
      toast('⚡', `즉시 +${p.acorn_amt} 도토리!`);
    } else {
      await pushNotif(myProfile.id, 'request', '신청 완료!', `${p.name} 신청 완료. 관리자 승인 대기 중이에요.`);
      toast('✅', `${p.name} 신청 완료!`);
    }
    playSound('reward');
    updateAcornDisplay();
    renderShop(true);
    triggerAutoQuest('itemBuy');
  } finally {
    window._buyLock = false;
  }
}

