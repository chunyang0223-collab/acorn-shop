/* ================================================================
   🛒 다람쥐 농장 — 상점 (farm_shop.js)
   예치금 모달 / 상점(구매·판매) / 인벤토리 확장 / 밭 확장
   ================================================================ */

// ================================================================
//  예치금 모달
// ================================================================
function farmShowDeposit() {
  const acorns = _farmData?.deposit_acorns || 0;
  const crumbs = _farmData?.deposit_crumbs || 0;
  const myAcorns = myProfile?.acorns ?? 0;

  showModal(`
    <div style="padding:4px 0">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:14px;font-weight:900;color:#1f2937">🌰 농장 예치금</div>
        <div style="margin:12px auto;display:inline-block;border:3px solid #d97706;border-radius:16px;padding:3px">
          <div style="border:2px solid #fbbf24;border-radius:12px;padding:10px 20px;background:linear-gradient(135deg,#fffbeb,#fef3c7)">
            <div style="font-size:22px;font-weight:900;color:#78350f">${acorns} <span style="font-size:12px">도토리</span></div>
            <div style="font-size:11px;color:#92400e">${crumbs} 부스러기</div>
          </div>
        </div>
        <div style="font-size:11px;color:#6b7280">보유 도토리: 🌰 ${myAcorns}</div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <div style="flex:1">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;font-weight:700">입금할 도토리</div>
          <input id="farmDepositAmt" type="number" min="1" max="${myAcorns}" value="10" style="width:100%;padding:8px 10px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;font-weight:700;text-align:center">
        </div>
        <button onclick="farmDoDeposit()" class="btn btn-primary" style="align-self:flex-end;padding:8px 16px;font-size:12px;font-weight:800">입금</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <div style="flex:1">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;font-weight:700">출금할 도토리 <span style="font-size:9px;color:#9ca3af">(정수 단위만)</span></div>
          <input id="farmWithdrawAmt" type="number" min="1" max="${acorns}" value="${Math.min(acorns, 10)}" style="width:100%;padding:8px 10px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;font-weight:700;text-align:center">
        </div>
        <button onclick="farmDoWithdraw()" class="btn" style="align-self:flex-end;padding:8px 16px;font-size:12px;font-weight:800;background:#f3f4f6;color:#6b7280">출금</button>
      </div>

      <button onclick="closeModal()" class="btn w-full" style="background:#f9fafb;color:#9ca3af;font-size:11px;font-weight:700">닫기</button>
    </div>
  `);
}

// ── 입금 ──
async function farmDoDeposit() {
  const amt = parseInt(document.getElementById('farmDepositAmt')?.value);
  if (!amt || amt <= 0) { toast('⚠️', '금액을 입력하세요'); return; }
  if (amt > (myProfile?.acorns ?? 0)) { toast('⚠️', '도토리가 부족해요'); return; }

  try {
    const { data, error } = await sb.rpc('farm_deposit', { p_user_id: myProfile.id, p_amount: amt });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }

    toast('🌰', `${amt} 도토리 입금 완료!`);
    if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    await _farmReloadAll();
    closeModal();
    farmRenderMain();
  } catch (e) {
    console.error('[farm deposit]', e);
    toast('❌', '입금 실패: ' + (e?.message || ''));
  }
}

// ── 출금 ──
async function farmDoWithdraw() {
  const amt = parseInt(document.getElementById('farmWithdrawAmt')?.value);
  if (!amt || amt <= 0) { toast('⚠️', '금액을 입력하세요'); return; }
  if (amt > (_farmData?.deposit_acorns || 0)) { toast('⚠️', '예치금이 부족해요'); return; }

  try {
    const { data, error } = await sb.rpc('farm_withdraw', { p_user_id: myProfile.id, p_amount: amt });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }

    toast('🌰', `${amt} 도토리 출금 완료!`);
    if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    await _farmReloadAll();
    closeModal();
    farmRenderMain();
  } catch (e) {
    console.error('[farm withdraw]', e);
    toast('❌', '출금 실패: ' + (e?.message || ''));
  }
}

// ================================================================
//  상점 모달 (탭: 구매 / 판매)
// ================================================================
async function farmShowShop(tab) {
  if (tab) _farmShopTab = tab;
  if (_farmShopTab === 'sell') {
    try {
      const { data } = await sb.rpc('farm_get_sell_status', { p_user_id: myProfile.id });
      _farmSellStatus = data?.sales || {};
    } catch(e) { console.warn('[farm sell status]', e); }
  }

  const depositAcorns = _farmData?.deposit_acorns || 0;
  const depositCrumbs = _farmData?.deposit_crumbs || 0;

  let timeLeftStr = '';
  if (_farmPrices.length > 0) {
    const endTime = new Date(_farmPrices[0].period_end);
    const diff = endTime - Date.now();
    if (diff > 0) {
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      timeLeftStr = `${h}시간 ${m}분 후 시세 변경`;
    }
  }

  const isBuy = _farmShopTab === 'buy';
  const tabStyle = (active) => `padding:6px 16px;border-radius:8px;border:none;font-size:11px;font-weight:800;cursor:pointer;${active ? 'background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white' : 'background:#f3f4f6;color:#9ca3af'}`;
  let contentHtml = isBuy ? _farmRenderBuyTab() : _farmRenderSellTab();

  showModal(`
    <div style="padding:4px 0">
      <div style="font-size:15px;font-weight:900;color:#1f2937;text-align:center;margin-bottom:4px">🛒 농장 상점</div>
      <div style="font-size:10px;color:#6b7280;text-align:center;margin-bottom:4px">예치금: 🌰 ${depositAcorns} + ${depositCrumbs}부스러기</div>
      ${timeLeftStr ? `<div style="font-size:9px;color:#f59e0b;text-align:center;margin-bottom:8px">⏰ ${timeLeftStr}</div>` : ''}
      <div style="display:flex;gap:6px;margin-bottom:10px;justify-content:center">
        <button onclick="farmShowShop('buy')" style="${tabStyle(isBuy)}">🌱 구매</button>
        <button onclick="farmShowShop('sell')" style="${tabStyle(!isBuy)}">💰 판매</button>
      </div>
      <div style="max-height:340px;overflow-y:auto;padding:2px">
        ${contentHtml}
      </div>
      <button onclick="closeModal()" class="btn w-full" style="background:#f9fafb;color:#9ca3af;font-size:11px;font-weight:700;margin-top:10px">닫기</button>
    </div>
  `);
}

// ── 구매 탭 렌더링 ──
function _farmRenderBuyTab() {
  const depositTotal = (_farmData?.deposit_acorns || 0) * 100 + (_farmData?.deposit_crumbs || 0);
  let html = '';
  _farmCrops.forEach(crop => {
    const priceRow = _farmPrices.find(p => p.crop_id === crop.id);
    const currentPrice = priceRow ? priceRow.current_price : crop.base_price * 100;
    const changePct = priceRow ? priceRow.price_change_pct : 0;
    const priceStr = _farmFmtPrice(currentPrice);
    let changeColor = '#6b7280', changeIcon = '';
    if (changePct > 0) { changeColor = '#ef4444'; changeIcon = '▲'; }
    else if (changePct < 0) { changeColor = '#3b82f6'; changeIcon = '▼'; }
    const canBuy = depositTotal >= currentPrice;

    html += `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:12px;background:${canBuy ? 'white' : '#f9fafb'};border:1.5px solid ${canBuy ? '#e5e7eb' : '#f3f4f6'};${canBuy ? '' : 'opacity:0.6'}">
        <div style="font-size:24px;flex-shrink:0;width:32px;text-align:center">${crop.emoji}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:900;color:#1f2937">${crop.name} 씨앗</div>
          <div style="font-size:9px;color:#6b7280">재배 ${crop.grow_min_hours}~${crop.grow_max_hours}시간</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:12px;font-weight:900;color:#78350f">🌰 ${priceStr}</div>
          <div style="font-size:8px;font-weight:700;color:${changeColor}">${changeIcon} ${Math.abs(changePct).toFixed(1)}%</div>
        </div>
        <button onclick="${canBuy ? `farmBuySeed('${crop.id}')` : `toast('⚠️','예치금이 부족해요! (필요: ${priceStr})')`}" style="padding:4px 10px;border-radius:8px;border:none;background:${canBuy ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : '#e5e7eb'};color:${canBuy ? 'white' : '#9ca3af'};font-size:10px;font-weight:800;cursor:pointer;flex-shrink:0">구매</button>
      </div>`;
  });
  return `<div style="display:flex;flex-direction:column;gap:6px">${html}</div>`;
}

// ── 판매 탭 렌더링 ──
function _farmRenderSellTab() {
  const seeds = (_farmInventory || []).filter(i => i.item_type === 'seed' && i.quantity > 0);
  const crops = (_farmInventory || []).filter(i => i.item_type === 'crop' && i.quantity > 0);
  let html = '';

  html += `<div style="font-size:10px;font-weight:900;color:#1f2937;margin-bottom:6px">🌱 씨앗 되팔기 <span style="font-size:8px;color:#9ca3af;font-weight:700">(현재 시세의 70%)</span></div>`;
  if (seeds.length === 0) {
    html += `<div style="font-size:10px;color:#9ca3af;padding:8px;text-align:center">보유 씨앗이 없어요</div>`;
  } else {
    seeds.forEach(inv => {
      const crop = _farmCrops.find(c => c.id === inv.crop_id);
      if (!crop) return;
      const priceRow = _farmPrices.find(p => p.crop_id === inv.crop_id);
      const marketPrice = priceRow ? priceRow.current_price : crop.base_price * 100;
      const sellPrice = Math.round(marketPrice * 0.7);
      const priceStr = _farmFmtPrice(sellPrice);
      html += `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:12px;background:white;border:1.5px solid #e5e7eb;margin-bottom:4px">
          <div style="font-size:20px;flex-shrink:0">${crop.emoji}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;font-weight:900;color:#1f2937">${crop.name} 씨앗 <span style="font-size:9px;color:#6b7280">×${inv.quantity}</span></div>
            <div style="font-size:9px;color:#ef4444">개당 🌰 ${priceStr}</div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            <button onclick="_farmSellSeedQty('${inv.crop_id}',-1)" style="width:22px;height:22px;border-radius:6px;border:1px solid #d1d5db;background:white;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">◀</button>
            <span id="farmSeedQty_${inv.crop_id}" style="font-size:12px;font-weight:900;min-width:20px;text-align:center">1</span>
            <button onclick="_farmSellSeedQty('${inv.crop_id}',1)" style="width:22px;height:22px;border-radius:6px;border:1px solid #d1d5db;background:white;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">▶</button>
            <button onclick="_farmSellSeedQty('${inv.crop_id}',999)" style="padding:2px 6px;border-radius:6px;border:1px solid #d1d5db;background:white;font-size:8px;font-weight:800;cursor:pointer;color:#6b7280">ALL</button>
            <button onclick="farmSellSeed('${inv.crop_id}')" style="padding:4px 8px;border-radius:8px;border:none;background:linear-gradient(135deg,#f87171,#ef4444);color:white;font-size:9px;font-weight:800;cursor:pointer">판매</button>
          </div>
        </div>`;
    });
  }

  html += `<div style="font-size:10px;font-weight:900;color:#1f2937;margin-top:12px;margin-bottom:6px">🥕 작물 판매 <span style="font-size:8px;color:#9ca3af;font-weight:700">(단계별 가격)</span></div>`;
  if (crops.length === 0) {
    html += `<div style="font-size:10px;color:#9ca3af;padding:8px;text-align:center">보유 작물이 없어요</div>`;
  } else {
    crops.forEach(inv => {
      const crop = _farmCrops.find(c => c.id === inv.crop_id);
      if (!crop) return;
      const alreadySold = _farmSellStatus[inv.crop_id] || 0;
      const tierLimits = [_farmSettings.sell_tier1_limit||10, _farmSettings.sell_tier2_limit||10, _farmSettings.sell_tier3_limit||10];
      const tierPcts = [_farmSettings.sell_tier1_pct||100, _farmSettings.sell_tier2_pct||80, _farmSettings.sell_tier3_pct||60];
      const tierColors = ['#16a34a', '#f59e0b', '#ef4444'];
      const tierBgs = ['#f0fdf4', '#fefce8', '#fef2f2'];

      let tierStart = 0, currentTier = -1, tierRemaining = 0, tierSold = 0, tierLimit = 0;
      let tierPct = 60, tierColor = '#ef4444', tierBg = '#fef2f2';
      for (let t = 0; t < 3; t++) {
        const tEnd = tierStart + tierLimits[t];
        if (alreadySold < tEnd) {
          currentTier = t; tierSold = alreadySold - tierStart; tierLimit = tierLimits[t];
          tierRemaining = tierLimit - tierSold; tierPct = tierPcts[t];
          tierColor = tierColors[t]; tierBg = tierBgs[t]; break;
        }
        tierStart = tEnd;
      }
      if (currentTier === -1) {
        currentTier = 2; tierPct = tierPcts[2]; tierColor = tierColors[2]; tierBg = tierBgs[2];
        tierSold = 0; tierLimit = 999; tierRemaining = 999;
      }

      const baseCropPrice = Math.round(crop.base_price * 100 * (_farmSettings.sell_rate_pct||110) / 100 / 3);
      const tierPrice = Math.round(baseCropPrice * tierPct / 100);
      const priceStr = _farmFmtPrice(tierPrice);
      const maxSellable = Math.min(inv.quantity, tierRemaining);

      html += `
        <div style="padding:12px 14px;border-radius:14px;background:${tierBg};border:1.5px solid ${tierColor}30;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span style="font-size:28px">${crop.emoji}</span>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:900;color:#1f2937">${crop.name} <span style="font-size:12px;color:#6b7280;font-weight:700">×${inv.quantity}</span></div>
              <div style="font-size:12px;font-weight:700;color:${tierColor};margin-top:2px">${currentTier+1}단계 (${tierPct}%) ${tierLimit<999?`· ${tierSold}/${tierLimit}`:''}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:9px;color:#6b7280;font-weight:700">개당</div>
              <div style="font-size:14px;font-weight:900;color:${tierColor}">🌰 ${priceStr}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end">
            <button onclick="_farmSellCropQty('${inv.crop_id}',-1)" style="width:28px;height:28px;border-radius:8px;border:1px solid #d1d5db;background:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center">◀</button>
            <span id="farmCropQty_${inv.crop_id}" style="font-size:15px;font-weight:900;min-width:28px;text-align:center">0</span>
            <button onclick="_farmSellCropQty('${inv.crop_id}',1)" style="width:28px;height:28px;border-radius:8px;border:1px solid #d1d5db;background:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center">▶</button>
            <button onclick="_farmSellCropQty('${inv.crop_id}',${maxSellable})" style="padding:4px 10px;border-radius:8px;border:1px solid #d1d5db;background:white;font-size:10px;font-weight:800;cursor:pointer;color:#6b7280">ALL</button>
            <button onclick="farmSellCrop('${inv.crop_id}')" style="padding:6px 14px;border-radius:10px;border:none;background:linear-gradient(135deg,${tierColor},${tierColor}dd);color:white;font-size:12px;font-weight:800;cursor:pointer">판매</button>
          </div>
        </div>`;
    });
  }
  return html;
}

// ── 가격 포맷팅 헬퍼 ──
function _farmFmtPrice(crumbs) {
  const a = Math.floor(crumbs / 100);
  const c = crumbs % 100;
  return c > 0 ? `${a}.${String(c).padStart(2, '0')}` : `${a}`;
}

// ── 씨앗 판매 수량 조절 ──
function _farmSellSeedQty(cropId, delta) {
  const el = document.getElementById(`farmSeedQty_${cropId}`);
  if (!el) return;
  const inv = (_farmInventory || []).find(i => i.crop_id === cropId && i.item_type === 'seed');
  const max = inv?.quantity || 0;
  let cur = parseInt(el.textContent) || 0;
  if (delta === 999) cur = max;
  else cur = Math.max(0, Math.min(max, cur + delta));
  el.textContent = cur;
}

// ── 작물 판매 수량 조절 ──
function _farmSellCropQty(cropId, delta) {
  const el = document.getElementById(`farmCropQty_${cropId}`);
  if (!el) return;
  const inv = (_farmInventory || []).find(i => i.crop_id === cropId && i.item_type === 'crop');
  const max = inv?.quantity || 0;
  const alreadySold = _farmSellStatus[cropId] || 0;
  const tierLimits = [_farmSettings.sell_tier1_limit||10, _farmSettings.sell_tier2_limit||10, _farmSettings.sell_tier3_limit||10];
  let tierStart = 0, tierRemaining = max;
  for (let t = 0; t < 3; t++) {
    const tEnd = tierStart + tierLimits[t];
    if (alreadySold < tEnd) { tierRemaining = Math.min(max, tEnd - alreadySold); break; }
    tierStart = tEnd;
  }
  const maxSellable = Math.min(max, tierRemaining);
  let cur = parseInt(el.textContent) || 0;
  if (delta >= maxSellable) cur = maxSellable;
  else cur = Math.max(0, Math.min(maxSellable, cur + delta));
  el.textContent = cur;
}

// ── 씨앗 판매 실행 ──
async function farmSellSeed(cropId) {
  const el = document.getElementById(`farmSeedQty_${cropId}`);
  const qty = parseInt(el?.textContent) || 0;
  if (qty <= 0) { toast('⚠️', '판매할 수량을 선택하세요'); return; }
  const crop = _farmCrops.find(c => c.id === cropId);
  try {
    const { data, error } = await sb.rpc('farm_sell_item', {
      p_user_id: myProfile.id, p_crop_id: cropId, p_item_type: 'seed', p_quantity: qty
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast(crop?.emoji || '🌱', `${crop?.name || ''} 씨앗 ${qty}개 판매! (+🌰${_farmFmtPrice(data.revenue)})`);
    await _farmReloadAll();
    farmShowShop('sell');
    farmRenderMain();
  } catch(e) { console.error('[farm sell seed]', e); toast('❌', '판매 실패'); }
}

// ── 작물 판매 실행 ──
async function farmSellCrop(cropId) {
  const el = document.getElementById(`farmCropQty_${cropId}`);
  const qty = parseInt(el?.textContent) || 0;
  if (qty <= 0) { toast('⚠️', '판매할 수량을 선택하세요'); return; }
  const crop = _farmCrops.find(c => c.id === cropId);
  try {
    const { data, error } = await sb.rpc('farm_sell_item', {
      p_user_id: myProfile.id, p_crop_id: cropId, p_item_type: 'crop', p_quantity: qty
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast(crop?.emoji || '🥕', `${crop?.name || ''} ${qty}개 판매! (+🌰${_farmFmtPrice(data.revenue)})`);
    await _farmReloadAll();
    farmShowShop('sell');
    farmRenderMain();
  } catch(e) { console.error('[farm sell crop]', e); toast('❌', '판매 실패'); }
}

// ── 씨앗 구매 실행 ──
async function farmBuySeed(cropId) {
  const crop = _farmCrops.find(c => c.id === cropId);
  if (!crop) return;
  try {
    const { data, error } = await sb.rpc('farm_buy_seed', {
      p_user_id: myProfile.id, p_crop_id: cropId, p_quantity: 1
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    const unitPrice = data.unit_price || 0;
    const pa = Math.floor(unitPrice / 100), pc = unitPrice % 100;
    const priceStr = pc > 0 ? `${pa}.${String(pc).padStart(2,'0')}` : `${pa}`;
    toast(crop.emoji, `${crop.name} 씨앗 구매! (🌰${priceStr})`);
    await _farmReloadAll();
    await farmShowShop('buy');
    farmRenderMain();
  } catch (e) {
    console.error('[farm buy]', e);
    toast('❌', '구매 실패: ' + (e?.message || ''));
  }
}

// ── 인벤토리 확장 ──
async function farmExpandInventory() {
  const cap = _farmData?.inventory_capacity || 3;
  const cost = (cap - 3 + 1) * 10;
  showModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:12px">📦 인벤토리 확장</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:8px">현재 ${cap}칸 → ${cap+1}칸</div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-bottom:16px">🌰 ${cost} 도토리</div>
      <div style="font-size:10px;color:#9ca3af;margin-bottom:12px">예치금에서 차감됩니다</div>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:#f3f4f6;color:#6b7280;font-weight:800">취소</button>
        <button onclick="closeModal();farmDoExpandInventory()" class="btn btn-primary flex-1">확장!</button>
      </div>
    </div>
  `);
}

async function farmDoExpandInventory() {
  try {
    const { data, error } = await sb.rpc('farm_expand_inventory', { p_user_id: myProfile.id });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('📦', `인벤토리 ${data.new_capacity}칸으로 확장! (🌰${data.cost} 사용)`);
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm expand inv]', e); toast('❌', '확장 실패: ' + (e?.message || '')); }
}

// ================================================================
//  밭 확장 모달
// ================================================================
function farmShowExpandPlot(cost) {
  const plotCount = _farmData?.plot_count || 1;
  const depositAcorns = _farmData?.deposit_acorns || 0;
  showModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:12px">🌾 밭 확장</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:8px">현재 ${plotCount}칸 → ${plotCount+1}칸</div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-bottom:8px">🌰 ${cost} 도토리</div>
      <div style="font-size:10px;color:#9ca3af;margin-bottom:${depositAcorns < cost ? '8' : '16'}px">예치금에서 차감됩니다 (보유: 🌰${depositAcorns})</div>
      ${depositAcorns < cost ? `<div style="font-size:11px;color:#ef4444;font-weight:700;margin-bottom:12px">⚠️ 예치금이 부족해요! (🌰${cost - depositAcorns} 더 필요)</div>` : ''}
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:#f3f4f6;color:#6b7280;font-weight:800">취소</button>
        <button onclick="${depositAcorns >= cost ? "closeModal();farmDoExpandPlot()" : "toast('⚠️','예치금이 부족해요! 입금 후 다시 시도하세요')"}" class="btn btn-primary flex-1" style="${depositAcorns < cost ? 'opacity:0.5;cursor:not-allowed' : ''}">확장!</button>
      </div>
    </div>
  `);
}

async function farmDoExpandPlot() {
  try {
    const { data, error } = await sb.rpc('farm_expand_plot', { p_user_id: myProfile.id });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('🌾', `밭 ${data.new_plot_count}칸으로 확장! (🌰${data.cost} 사용)`);
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm expand plot]', e); toast('❌', '확장 실패: ' + (e?.message || '')); }
}
