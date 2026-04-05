/* ================================================================
   🌾 다람쥐 농장 시스템 (farm.js) v4
   ================================================================
   - 농장 메인 레이아웃 (상점/밭/농부/예치금/인벤토리)
   - 농부 전직 (수습 농부 시스템) — 언제든 수습 가능
   - 농부 슬롯 (장착/해제/교체) — 상단 영역
   - 예치금 입출금
   - 상점 (씨앗 구매, 시세 기반)
   - 인벤토리 (밭 아래, 기본 3칸, 확장 가능)
   - 밭 관리 / 파종 / 수확
   ================================================================ */

// ── 전역 상태 ──
var _farmData = null;      // farm_data 레코드
var _farmFarmers = [];     // farm_farmers 목록 (농부 자격 다람쥐들)
var _farmSettings = {};    // farm_settings
var _farmCrops = [];       // farm_crops 목록
var _farmPrices = [];      // 현재 시세
var _farmPlots = [];       // 내 밭 목록
var _farmInventory = [];   // 내 인벤토리
var _farmSellStatus = {};  // 현재 기간 판매 추적
var _farmShopTab = 'buy';  // 상점 현재 탭
var _farmTimer = null;     // 수습/수확 타이머 인터벌

// ── 설정 로드 ──
async function farmLoadSettings() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'farm_settings').maybeSingle();
  _farmSettings = data?.value || {};
}

// ── 농장 탭 진입 ──
async function sqFarmInit() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;
  area.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">로딩 중...</div>';

  try {
    await farmLoadSettings();

    const { data: crops } = await sb.from('farm_crops').select('*').eq('enabled', true).order('sort_order');
    _farmCrops = crops || [];

    const { data: farmData } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
    _farmData = farmData;

    const { data: farmers } = await sb.from('farm_farmers').select('*').eq('user_id', myProfile.id);
    _farmFarmers = farmers || [];
    window._farmDataLoaded = true;

    const { data: plots } = await sb.from('farm_plots').select('*').eq('user_id', myProfile.id).order('slot');
    _farmPlots = plots || [];

    const { data: inv } = await sb.from('farm_inventory').select('*').eq('user_id', myProfile.id);
    _farmInventory = inv || [];

    // 시세 갱신 시도 후 로드
    try { await sb.rpc('farm_refresh_prices'); } catch(e) { console.warn('[farm] price refresh skip', e); }
    const now = new Date().toISOString();
    const { data: prices } = await sb.from('farm_prices').select('*').lte('period_start', now).gt('period_end', now);
    _farmPrices = prices || [];

    farmRenderMain();
  } catch (e) {
    console.error('[farm]', e);
    area.innerHTML = '<div class="text-center py-8 text-red-400 text-sm">농장 로딩 실패</div>';
  }
}

// ================================================================
//  농장 메인 화면
// ================================================================
function farmRenderMain() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;
  _farmClearTimer();

  const hasFarmer = !!_farmData?.active_farmer_id;
  const activeSq = hasFarmer ? _sqSquirrels.find(s => s.id === _farmData.active_farmer_id) : null;

  let html = '';

  // ── 상단 바: 상점 아이콘 + 농부 다람쥐 슬롯 + 예치금 ──
  html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">`;
  // 상점 버튼
  html += `<div onclick="farmShowShop()" style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 3px 10px rgba(245,158,11,.3);flex-shrink:0;font-size:20px">🛒</div>`;
  // 농부 다람쥐 슬롯 (상점 아이콘 오른쪽)
  html += farmRenderFarmerSlot();
  // 여백
  html += `<div style="flex:1"></div>`;
  // 예치금
  html += farmRenderDepositBadge();
  html += `</div>`;

  // ── 밭 그리드 ──
  html += farmRenderFieldGrid();

  // ── 하단: 인벤토리 ──
  html += farmRenderInventory();

  area.innerHTML = html;

  // ── 밭 타이머 실시간 업데이트 ──
  const growingPlots = _farmPlots.filter(p => p.crop_id && p.harvest_at);
  if (growingPlots.length > 0) {
    _farmTimer = setInterval(() => {
      let anyGrowing = false;
      growingPlots.forEach(plot => {
        const slot = plot.slot;
        const cell = document.getElementById(`farm-cell-${slot}`);
        const labelEl = document.getElementById(`farm-cell-label-${slot}`);
        const timerEl = document.getElementById(`farm-cell-timer-${slot}`);
        const skipEl = document.getElementById(`farm-cell-skip-${slot}`);
        if (!cell || !labelEl || !timerEl) return;

        const remaining = Math.max(0, new Date(plot.harvest_at) - Date.now());

        if (remaining <= 0) {
          // 수확 가능 상태로 전환
          cell.style.background = 'linear-gradient(135deg,#fef9c3,#fef3c7)';
          cell.style.border = '2px solid #fbbf24';
          cell.style.cursor = 'pointer';
          cell.setAttribute('onclick', `farmHarvest(${slot})`);
          labelEl.style.color = '#92400e';
          labelEl.textContent = '수확!';
          timerEl.textContent = '';
          if (skipEl) skipEl.style.display = 'none';
        } else {
          anyGrowing = true;
          timerEl.textContent = _farmFmtTime(remaining);
        }
      });
      if (!anyGrowing) {
        _farmClearTimer();
      }
    }, 1000);
  }
}

// ================================================================
//  예치금 뱃지 (상단 오른쪽)
// ================================================================
function farmRenderDepositBadge() {
  const acorns = _farmData?.deposit_acorns || 0;
  const crumbs = _farmData?.deposit_crumbs || 0;
  return `
    <div onclick="farmShowDeposit()" style="margin-left:auto;cursor:pointer;flex-shrink:0">
      <div style="border:3px solid #d97706;border-radius:14px;padding:2px">
        <div style="border:2px solid #fbbf24;border-radius:11px;padding:6px 12px;background:linear-gradient(135deg,#fffbeb,#fef3c7)">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:14px">🌰</span>
            <div>
              <div style="font-size:13px;font-weight:900;color:#78350f;line-height:1.1">${acorns}</div>
              <div style="font-size:9px;color:#92400e;line-height:1">${crumbs} 부스러기</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ================================================================
//  밭 그리드 (3x3, 보유 수만큼 활성)
// ================================================================
function farmRenderFieldGrid() {
  const plotCount = _farmData?.plot_count || 1;
  const maxPlots = _farmSettings.max_plots || 9;
  const hasFarmer = !!_farmData?.active_farmer_id;

  let gridHtml = '';
  for (let i = 1; i <= 9; i++) {
    const plot = _farmPlots.find(p => p.slot === i);
    if (i <= plotCount) {
      // 활성 밭
      if (plot?.crop_id) {
        // 작물 심어짐
        const crop = _farmCrops.find(c => c.id === plot.crop_id);
        const harvestAt = plot.harvest_at ? new Date(plot.harvest_at) : null;
        const ready = harvestAt && harvestAt <= Date.now();
        const remaining = harvestAt ? Math.max(0, harvestAt - Date.now()) : 0;
        const remainStr = remaining > 0 ? _farmFmtTime(remaining) : '';
        gridHtml += `
          <div id="farm-cell-${i}" data-harvest="${plot.harvest_at || ''}" style="aspect-ratio:1;border-radius:16px;background:${ready ? 'linear-gradient(135deg,#fef9c3,#fef3c7)' : 'linear-gradient(135deg,#ecfdf5,#d1fae5)'};border:2px solid ${ready ? '#fbbf24' : '#86efac'};display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:${ready ? 'pointer' : 'default'};transition:background .3s,border .3s;position:relative" ${ready ? `onclick="farmHarvest(${i})"` : ''}>
            <div style="font-size:${ready ? '28' : '24'}px">${crop?.emoji || '🌱'}</div>
            <div id="farm-cell-label-${i}" style="font-size:9px;font-weight:700;color:${ready ? '#92400e' : '#16a34a'};margin-top:2px">${ready ? '수확!' : (crop?.name || '')}</div>
            <div id="farm-cell-timer-${i}" style="font-size:7px;color:#6b7280;font-weight:600;margin-top:1px">${!ready && remainStr ? remainStr : ''}</div>
            ${myProfile?.is_admin ? `<div id="farm-cell-skip-${i}" onclick="event.stopPropagation();farmAdminSkipGrow(${i})" style="position:absolute;top:3px;right:3px;font-size:7px;background:#ef4444;color:white;border-radius:6px;padding:1px 4px;cursor:pointer;font-weight:800;opacity:0.8;display:${ready ? 'none' : 'block'}">⏩</div>` : ''}
          </div>`;
      } else {
        // 빈 밭
        gridHtml += `
          <div style="aspect-ratio:1;border-radius:16px;background:linear-gradient(135deg,#fefce8,#fef9c3);border:2px dashed var(--qty-btn-border);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:${hasFarmer ? 'pointer' : 'default'};transition:all .15s" ${hasFarmer ? `onclick="farmShowPlantModal(${i})"` : ''}>
            <div style="font-size:22px;opacity:0.4">🌱</div>
            <div style="font-size:9px;color:#9ca3af;margin-top:2px">${hasFarmer ? '심기' : '농부 필요'}</div>
          </div>`;
      }
    } else if (i === plotCount + 1 && i <= maxPlots) {
      // 다음 확장 가능 슬롯
      const expandCost = (_farmSettings.plot_base_cost || 10) + (_farmSettings.plot_cost_increment || 10) * (plotCount - 1);
      gridHtml += `
        <div style="aspect-ratio:1;border-radius:16px;background:var(--surface-50);border:2px dashed var(--qty-btn-border);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s" onclick="farmShowExpandPlot(${expandCost})">
          <div style="font-size:18px;opacity:0.5">🔒</div>
          <div style="font-size:9px;color:#9ca3af;margin-top:2px">🌰${expandCost}</div>
        </div>`;
    } else {
      // 잠긴 슬롯
      gridHtml += `
        <div style="aspect-ratio:1;border-radius:16px;background:var(--progress-track-bg);border:2px solid var(--list-item-border);display:flex;align-items:center;justify-content:center;opacity:0.3">
          <div style="font-size:18px">🔒</div>
        </div>`;
    }
  }

  return `
    <div class="clay-card p-3 mb-3">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${gridHtml}
      </div>
    </div>`;
}

// ================================================================
//  농부 슬롯 (상단 인라인, 상점 아이콘 옆)
// ================================================================
function farmRenderFarmerSlot() {
  const activeSq = _farmData?.active_farmer_id
    ? _sqSquirrels.find(s => s.id === _farmData.active_farmer_id)
    : null;

  if (activeSq) {
    const grade = _sqCalcGrade(activeSq);
    const gs = _sqGradeStyle(grade);
    const spriteFile = activeSq.sprite || 'sq_acorn';
    return `
      <div onclick="farmShowChangeFarmer()" style="display:flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:12px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:2px solid #86efac;cursor:pointer;flex-shrink:0">
        <div style="border-radius:8px;${gs.border};padding:1px;background:${gs.bg}">
          <img src="images/squirrels/${spriteFile}.png" style="width:28px;height:28px;object-fit:contain;border-radius:6px;display:block" onerror="this.outerHTML='<div style=\\'font-size:20px;line-height:28px;text-align:center\\'>🐱</div>'">
        </div>
        <div style="min-width:0">
          <div style="font-size:10px;font-weight:900;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px">${activeSq.name} 🌾</div>
          <div style="font-size:8px;font-weight:700;color:${gs.color}">${gs.label}</div>
        </div>
      </div>`;
  }

  // 미장착
  if (_farmFarmers.length > 0) {
    return `
      <div onclick="farmShowChangeFarmer()" style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:12px;background:var(--surface-50);border:2px dashed var(--qty-btn-border);cursor:pointer;flex-shrink:0">
        <div style="font-size:16px;opacity:0.4">🐿️</div>
        <div style="font-size:9px;color:#9ca3af;font-weight:700">농부 장착</div>
      </div>`;
  }

  return `
    <div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:12px;background:var(--surface-50);border:2px dashed var(--qty-btn-border);flex-shrink:0;opacity:0.5">
      <div style="font-size:16px">🐿️</div>
      <div style="font-size:9px;color:#9ca3af">농부 없음</div>
    </div>`;
}

// ================================================================
//  인벤토리 (밭 아래, 기본 3칸, 확장 가능)
//  씨앗: 초록 테두리 + "씨" 뱃지  /  작물: 주황 테두리
// ================================================================
function farmRenderInventory() {
  const capacity = _farmData?.inventory_capacity || 3;
  const STACK_MAX = 10; // 슬롯당 최대 스택
  const items = _farmInventory || [];

  // 슬롯 목록 생성: 같은 (crop_id, item_type) 묶음을 STACK_MAX 단위로 슬롯 분할
  let slots = [];
  items.forEach(inv => {
    const crop = _farmCrops.find(c => c.id === inv.crop_id);
    let remaining = inv.quantity;
    while (remaining > 0) {
      const stackQty = Math.min(remaining, STACK_MAX);
      slots.push({
        crop_id: inv.crop_id,
        emoji: crop?.emoji || '📦',
        name: crop?.name || inv.crop_id,
        type: inv.item_type || 'seed',
        qty: stackQty
      });
      remaining -= stackQty;
    }
  });

  const expandCost = (capacity - 3 + 1) * 10;
  let gridHtml = '';

  for (let i = 0; i < capacity; i++) {
    if (i < slots.length) {
      const s = slots[i];
      const isSeed = s.type === 'seed';
      const borderColor = isSeed ? '#86efac' : '#fbbf24';
      const bgGrad = isSeed ? 'linear-gradient(135deg,#ecfdf5,#d1fae5)' : 'linear-gradient(135deg,#fef9c3,#fef3c7)';
      const labelColor = isSeed ? '#16a34a' : '#92400e';
      gridHtml += `
        <div style="width:48px;height:48px;border-radius:12px;background:${bgGrad};border:2px solid ${borderColor};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">
          <div style="font-size:20px">${s.emoji}</div>
          <div style="font-size:7px;font-weight:700;color:${labelColor};margin-top:1px;white-space:nowrap">${isSeed ? s.name + ' 씨앗' : s.name}</div>
          <div style="position:absolute;bottom:-4px;right:-4px;min-width:14px;height:14px;border-radius:7px;background:${isSeed ? '#16a34a' : '#d97706'};color:white;font-size:7px;font-weight:900;display:flex;align-items:center;justify-content:center;border:1px solid white;padding:0 2px">${s.qty}</div>
        </div>`;
    } else {
      gridHtml += `
        <div style="width:48px;height:48px;border-radius:12px;background:var(--surface-50);border:2px dashed var(--list-item-border);display:flex;align-items:center;justify-content:center">
          <div style="font-size:14px;opacity:0.2">📦</div>
        </div>`;
    }
  }

  // 확장 버튼
  gridHtml += `
    <div onclick="farmExpandInventory()" style="width:48px;height:48px;border-radius:12px;background:var(--progress-track-bg);border:2px dashed var(--qty-btn-border);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s" title="인벤토리 확장 (🌰${expandCost})">
      <div style="font-size:16px;color:#9ca3af">+</div>
      <div style="font-size:7px;color:#9ca3af;font-weight:700">🌰${expandCost}</div>
    </div>`;

  const usedSlots = slots.length;
  const totalItems = items.reduce((sum, inv) => sum + inv.quantity, 0);

  return `
    <div class="clay-card p-3" style="margin-top:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:11px;font-weight:900;color:#1f2937">📦 인벤토리</div>
        <div style="font-size:9px;color:#6b7280;font-weight:700">${usedSlots} / ${capacity} 칸 · 총 ${totalItems}개</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${gridHtml}
      </div>
    </div>`;
}

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
          <input id="farmDepositAmt" type="number" min="1" max="${myAcorns}" value="10" style="width:100%;padding:8px 10px;border:2px solid var(--list-item-border);border-radius:10px;font-size:14px;font-weight:700;text-align:center">
        </div>
        <button onclick="farmDoDeposit()" class="btn btn-primary" style="align-self:flex-end;padding:8px 16px;font-size:12px;font-weight:800">입금</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <div style="flex:1">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;font-weight:700">출금할 도토리 <span style="font-size:9px;color:#9ca3af">(정수 단위만)</span></div>
          <input id="farmWithdrawAmt" type="number" min="1" max="${acorns}" value="${Math.min(acorns, 10)}" style="width:100%;padding:8px 10px;border:2px solid var(--list-item-border);border-radius:10px;font-size:14px;font-weight:700;text-align:center">
        </div>
        <button onclick="farmDoWithdraw()" class="btn" style="align-self:flex-end;padding:8px 16px;font-size:12px;font-weight:800;background:var(--btn-cancel-bg);color:var(--btn-cancel-text)">출금</button>
      </div>

      <button onclick="closeModal()" class="btn w-full" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:11px;font-weight:700">닫기</button>
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
  // 판매 탭이면 판매 상태 로드
  if (_farmShopTab === 'sell') {
    try {
      const { data } = await sb.rpc('farm_get_sell_status', { p_user_id: myProfile.id });
      _farmSellStatus = data?.sales || {};
    } catch(e) { console.warn('[farm sell status]', e); }
  }

  const depositAcorns = _farmData?.deposit_acorns || 0;
  const depositCrumbs = _farmData?.deposit_crumbs || 0;

  // 시세 남은 시간
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
  const tabStyle = (active) => `padding:6px 16px;border-radius:8px;border:none;font-size:11px;font-weight:800;cursor:pointer;${active ? 'background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white' : 'background:var(--progress-track-bg);color:var(--text-muted)'}`;

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

      <button onclick="closeModal()" class="btn w-full" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:11px;font-weight:700;margin-top:10px">닫기</button>
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
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:12px;background:${canBuy ? 'var(--list-item-bg)' : 'var(--surface-50)'};border:1.5px solid ${canBuy ? 'var(--list-item-border)' : 'var(--progress-track-bg)'};${canBuy ? '' : 'opacity:0.6'}">
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

  // ─ 씨앗 되팔기 섹션 ─
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
        <div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:12px;background:var(--list-item-bg);border:1.5px solid var(--list-item-border);margin-bottom:4px">
          <div style="font-size:20px;flex-shrink:0">${crop.emoji}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;font-weight:900;color:#1f2937">${crop.name} 씨앗 <span style="font-size:9px;color:#6b7280">×${inv.quantity}</span></div>
            <div style="font-size:9px;color:#ef4444">개당 🌰 ${priceStr}</div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            <button onclick="_farmSellSeedQty('${inv.crop_id}',-1)" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--qty-btn-border);background:var(--qty-btn-bg);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">◀</button>
            <span id="farmSeedQty_${inv.crop_id}" style="font-size:12px;font-weight:900;min-width:20px;text-align:center">1</span>
            <button onclick="_farmSellSeedQty('${inv.crop_id}',1)" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--qty-btn-border);background:var(--qty-btn-bg);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">▶</button>
            <button onclick="_farmSellSeedQty('${inv.crop_id}',999)" style="padding:2px 6px;border-radius:6px;border:1px solid var(--qty-btn-border);background:var(--qty-btn-bg);font-size:8px;font-weight:800;cursor:pointer;color:var(--qty-btn-text)">ALL</button>
            <button onclick="farmSellSeed('${inv.crop_id}')" style="padding:4px 8px;border-radius:8px;border:none;background:linear-gradient(135deg,#f87171,#ef4444);color:white;font-size:9px;font-weight:800;cursor:pointer">판매</button>
          </div>
        </div>`;
    });
  }

  // ─ 작물 판매 섹션 ─
  html += `<div style="font-size:10px;font-weight:900;color:#1f2937;margin-top:12px;margin-bottom:6px">🥕 작물 판매 <span style="font-size:8px;color:#9ca3af;font-weight:700">(단계별 가격)</span></div>`;
  if (crops.length === 0) {
    html += `<div style="font-size:10px;color:#9ca3af;padding:8px;text-align:center">보유 작물이 없어요</div>`;
  } else {
    crops.forEach(inv => {
      const crop = _farmCrops.find(c => c.id === inv.crop_id);
      if (!crop) return;
      const alreadySold = _farmSellStatus[inv.crop_id] || 0;
      const tierLimits = [
        _farmSettings.sell_tier1_limit || 10,
        _farmSettings.sell_tier2_limit || 10,
        _farmSettings.sell_tier3_limit || 10
      ];
      const tierPcts = [
        _farmSettings.sell_tier1_pct || 100,
        _farmSettings.sell_tier2_pct || 80,
        _farmSettings.sell_tier3_pct || 60
      ];
      const tierColors = ['#16a34a', '#f59e0b', '#ef4444'];
      const tierBgs = ['#f0fdf4', '#fefce8', '#fef2f2'];

      // 현재 활성 단계 찾기
      let tierStart = 0;
      let currentTier = -1;
      let tierRemaining = 0;
      let tierSold = 0;
      let tierLimit = 0;
      let tierPct = 60;
      let tierColor = '#ef4444';
      let tierBg = '#fef2f2';

      for (let t = 0; t < 3; t++) {
        const tEnd = tierStart + tierLimits[t];
        if (alreadySold < tEnd) {
          currentTier = t;
          tierSold = alreadySold - tierStart;
          tierLimit = tierLimits[t];
          tierRemaining = tierLimit - tierSold;
          tierPct = tierPcts[t];
          tierColor = tierColors[t];
          tierBg = tierBgs[t];
          break;
        }
        tierStart = tEnd;
      }
      if (currentTier === -1) {
        // 모든 단계 소진 → 3단계 가격
        currentTier = 2;
        tierPct = tierPcts[2];
        tierColor = tierColors[2];
        tierBg = tierBgs[2];
        tierSold = 0;
        tierLimit = 999;
        tierRemaining = 999;
      }

      // 작물 1개 기본 판매가 (부스러기)
      const baseCropPrice = Math.round(crop.base_price * 100 * (_farmSettings.sell_rate_pct || 110) / 100 / 3);
      const tierPrice = Math.round(baseCropPrice * tierPct / 100);
      const priceStr = _farmFmtPrice(tierPrice);

      const maxSellable = Math.min(inv.quantity, tierRemaining);

      html += `
        <div style="padding:10px;border-radius:12px;background:${tierBg};border:1.5px solid ${tierColor}30;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:20px">${crop.emoji}</span>
            <div style="flex:1">
              <div style="font-size:11px;font-weight:900;color:#1f2937">${crop.name} <span style="font-size:9px;color:#6b7280">×${inv.quantity}</span></div>
              <div style="font-size:9px;font-weight:700;color:${tierColor}">${currentTier + 1}단계 (${tierPct}%) ${tierLimit < 999 ? `: ${tierSold}/${tierLimit}` : ''}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:10px;font-weight:900;color:${tierColor}">개당 🌰 ${priceStr}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
            <button onclick="_farmSellCropQty('${inv.crop_id}',-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--qty-btn-border);background:var(--qty-btn-bg);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">◀</button>
            <span id="farmCropQty_${inv.crop_id}" style="font-size:13px;font-weight:900;min-width:24px;text-align:center">0</span>
            <button onclick="_farmSellCropQty('${inv.crop_id}',1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--qty-btn-border);background:var(--qty-btn-bg);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">▶</button>
            <button onclick="_farmSellCropQty('${inv.crop_id}',${maxSellable})" style="padding:3px 8px;border-radius:6px;border:1px solid var(--qty-btn-border);background:var(--qty-btn-bg);font-size:9px;font-weight:800;cursor:pointer;color:var(--qty-btn-text)">ALL</button>
            <button onclick="farmSellCrop('${inv.crop_id}')" style="padding:5px 10px;border-radius:8px;border:none;background:linear-gradient(135deg,${tierColor},${tierColor}dd);color:white;font-size:10px;font-weight:800;cursor:pointer">판매</button>
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
  // 단계 한도 계산
  const alreadySold = _farmSellStatus[cropId] || 0;
  const tierLimits = [
    _farmSettings.sell_tier1_limit || 10,
    _farmSettings.sell_tier2_limit || 10,
    _farmSettings.sell_tier3_limit || 10
  ];
  let tierStart = 0;
  let tierRemaining = max;
  for (let t = 0; t < 3; t++) {
    const tEnd = tierStart + tierLimits[t];
    if (alreadySold < tEnd) {
      tierRemaining = Math.min(max, tEnd - alreadySold);
      break;
    }
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
      p_user_id: myProfile.id,
      p_crop_id: cropId,
      p_quantity: 1
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }

    const unitPrice = data.unit_price || 0;
    const pa = Math.floor(unitPrice / 100);
    const pc = unitPrice % 100;
    const priceStr = pc > 0 ? `${pa}.${String(pc).padStart(2,'0')}` : `${pa}`;
    toast(crop.emoji, `${crop.name} 씨앗 구매! (🌰${priceStr})`);

    await _farmReloadAll();
    // 상점 모달 갱신
    await farmShowShop('buy');
    // 메인 화면도 갱신 (인벤토리 표시)
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
      <div style="font-size:12px;color:#6b7280;margin-bottom:8px">
        현재 ${cap}칸 → ${cap + 1}칸
      </div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-bottom:16px">🌰 ${cost} 도토리</div>
      <div style="font-size:10px;color:#9ca3af;margin-bottom:12px">예치금에서 차감됩니다</div>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-weight:800">취소</button>
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
  } catch (e) {
    console.error('[farm expand inv]', e);
    toast('❌', '확장 실패: ' + (e?.message || ''));
  }
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
      <div style="font-size:12px;color:#6b7280;margin-bottom:8px">
        현재 ${plotCount}칸 → ${plotCount + 1}칸
      </div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-bottom:8px">🌰 ${cost} 도토리</div>
      <div style="font-size:10px;color:#9ca3af;margin-bottom:${depositAcorns < cost ? '8' : '16'}px">예치금에서 차감됩니다 (보유: 🌰${depositAcorns})</div>
      ${depositAcorns < cost ? `<div style="font-size:11px;color:#ef4444;font-weight:700;margin-bottom:12px">⚠️ 예치금이 부족해요! (🌰${cost - depositAcorns} 더 필요)</div>` : ''}
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-weight:800">취소</button>
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
  } catch (e) {
    console.error('[farm expand plot]', e);
    toast('❌', '확장 실패: ' + (e?.message || ''));
  }
}

// ================================================================
//  수습 농부 보내기 모달
// ================================================================
// ── 수습 시작 확인 (내 다람쥐 탭에서 호출) ──
async function farmStartApprentice(squirrelId) {
  const sq = _sqSquirrels.find(s => s.id === squirrelId);
  if (!sq) return;

  showModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="font-size:40px;margin-bottom:8px">🌾</div>
      <div style="font-size:16px;font-weight:900;color:#1f2937;margin-bottom:8px">수습 농부 보내기</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px">
        <strong>${sq.name}</strong>을(를) 수습 농부로 보낼까요?<br>
        ${_farmSettings.apprentice_hours || 4}시간 후 결과를 확인할 수 있어요.
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-weight:800">취소</button>
        <button onclick="closeModal();farmConfirmApprentice('${squirrelId}')" class="btn btn-primary flex-1">보내기!</button>
      </div>
    </div>
  `);
}

async function farmConfirmApprentice(squirrelId) {
  try {
    const { data, error } = await sb.rpc('farm_start_apprentice', {
      p_user_id: myProfile.id,
      p_squirrel_id: squirrelId
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }

    toast('🌾', '수습 농부로 출발했어요!');
    await _farmReloadAll();
    // 농장 탭이 열려있으면 리렌더
    if (document.getElementById('sqFarmArea')) farmRenderMain();
    // 내 다람쥐 탭 카드도 갱신 (버튼 상태 반영)
    if (typeof sqRenderGrid === 'function') sqRenderGrid();
  } catch (e) {
    console.error('[farm]', e);
    toast('❌', '수습 시작 실패: ' + (e?.message || JSON.stringify(e)));
  }
}

// ── 결과 공개 연출 ──
async function farmRevealResult() {
  showModal(`
    <div id="farmRevealAnim" style="text-align:center;padding:20px 0">
      <div id="farmRevealIcon" style="font-size:56px;animation:sqCardShake 0.5s ease infinite">🌾</div>
      <div style="font-size:16px;font-weight:900;color:#78350f;margin-top:16px">결과 확인 중...</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:4px">두근두근</div>
    </div>
  `);

  _playTone(220, 'sine', 0.12, 0.18);
  setTimeout(() => _playTone(220, 'sine', 0.12, 0.18), 200);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 400);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 600);
  setTimeout(() => _playTone(310, 'triangle', 0.2, 0.15), 800);
  setTimeout(() => _playTone(370, 'triangle', 0.2, 0.15), 1000);
  setTimeout(() => _playTone(440, 'triangle', 0.25, 0.15), 1200);
  setTimeout(() => _playTone(523, 'triangle', 0.3, 0.12), 1400);

  setTimeout(() => {
    const icon = document.getElementById('farmRevealIcon');
    if (icon) icon.style.animation = 'sqCardShake 0.2s ease infinite';
  }, 1000);

  setTimeout(() => {
    const el = document.getElementById('farmRevealAnim');
    if (el) {
      const r = el.getBoundingClientRect();
      _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, true, 15);
    }
  }, 1600);

  let result;
  try {
    const { data, error } = await sb.rpc('farm_check_apprentice', { p_user_id: myProfile.id });
    if (error) throw error;
    result = data;
  } catch (e) {
    console.error('[farm]', e);
    setTimeout(() => { closeModal(); toast('❌', '결과 확인 실패: ' + (e?.message || '')); }, 2000);
    return;
  }

  setTimeout(() => {
    const success = result?.success === true;
    const sq = _sqSquirrels.find(s => s.id === _farmData?.apprentice_squirrel_id);
    const sqName = sq?.name || '다람쥐';
    const spriteFile = sq?.sprite || 'sq_acorn';

    if (success) {
      _sqPlayGrowSound();
      setTimeout(() => {
        const modal = document.querySelector('.modal-box') || document.querySelector('[class*="modal"]');
        if (modal) { const r = modal.getBoundingClientRect(); _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 25); }
      }, 200);
    } else {
      _playTone(200, 'sine', 0.15, 0.3);
      setTimeout(() => _playTone(160, 'sine', 0.15, 0.4), 200);
    }

    closeModal();
    setTimeout(() => {
      showModal(`
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:48px;margin-bottom:12px">${success ? '🎉' : '😅'}</div>
          <div style="font-size:18px;font-weight:900;color:${success ? '#16a34a' : '#9ca3af'};margin-bottom:8px">
            ${success ? '농부 전직 성공!' : '아쉽지만 실패...'}
          </div>
          <div style="display:inline-block;border-radius:16px;border:3px solid ${success ? '#22c55e' : '#d1d5db'};padding:3px;background:${success ? '#f0fdf4' : 'var(--surface-50)'};margin:8px 0">
            <img src="images/squirrels/${spriteFile}.png" style="width:64px;height:64px;object-fit:contain;border-radius:12px;display:block" onerror="this.outerHTML='<div style=\\'font-size:48px;line-height:64px\\'>🐱</div>'">
          </div>
          <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:4px">${sqName}</div>
          ${success ? `
            <div style="font-size:13px;color:#16a34a;margin-bottom:16px">훌륭한 농부가 되었어요! 🌾</div>
          ` : `
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px">농사가 아직 어려웠나봐요...</div>
            <div style="font-size:12px;color:#f59e0b;font-weight:700;margin-bottom:16px">🌰 보상으로 도토리 ${result?.reward_acorns || 5}개를 가져왔어요!</div>
          `}
          <button onclick="closeModal();farmAfterReveal(${success})" class="btn btn-primary w-full">
            ${success ? '확인' : '다시 도전하기'}
          </button>
        </div>
      `);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const img = document.querySelector('.modal-box img');
        if (img) { img.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)'; img.style.transform = 'scale(1.05)'; }
      }));
    }, 150);
  }, 2000);
}

async function farmAfterReveal(success) {
  if (!success && typeof updateAcornDisplay === 'function') updateAcornDisplay();
  if (window._sqApprenticeTimer) { clearInterval(window._sqApprenticeTimer); window._sqApprenticeTimer = null; }
  await _farmReloadAll();
  if (document.getElementById('sqFarmArea')) farmRenderMain();
  if (typeof sqRenderGrid === 'function') sqRenderGrid();
}

// ================================================================
//  농부 교체/해제 모달
// ================================================================
function farmShowChangeFarmer() {
  const hasGrowingCrop = (_farmPlots || []).some(p => p.crop_id != null);
  const canUnequip = _farmData?.active_farmer_id && !hasGrowingCrop;
  showModal(`
    <div style="padding:4px 0">
      <div style="font-size:15px;font-weight:900;color:#1f2937;margin-bottom:12px;text-align:center">🌾 농부 교체/해제</div>
      ${_farmRenderFarmerList()}
      ${_farmData?.active_farmer_id ? (canUnequip
        ? `<button onclick="farmUnequipFarmer()" class="btn w-full mt-3" style="background:#fef2f2;color:#ef4444;font-weight:800;font-size:11px">농부 해제하기</button>`
        : `<div class="w-full mt-3 text-center" style="font-size:10px;color:#9ca3af;font-weight:700;padding:8px 0">🌱 작물이 자라는 중에는 해제할 수 없어요</div>`
      ) : ''}
      <button onclick="closeModal()" class="btn w-full mt-2" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:11px;font-weight:700">닫기</button>
    </div>
  `);
}

function _farmRenderFarmerList() {
  const farmerSquirrels = _farmFarmers
    .map(f => _sqSquirrels.find(s => s.id === f.squirrel_id))
    .filter(Boolean);

  if (farmerSquirrels.length === 0) return '<div class="text-center py-4 text-xs text-gray-400">농부 자격이 있는 다람쥐가 없어요.</div>';

  return `<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">${farmerSquirrels.map(sq => {
    const grade = _sqCalcGrade(sq);
    const gs = _sqGradeStyle(grade);
    const spriteFile = sq.sprite || 'sq_acorn';
    const isActive = _farmData?.active_farmer_id === sq.id;
    return `
      <div onclick="${isActive ? '' : `farmEquipFarmer('${sq.id}')`}" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;background:${isActive ? '#f0fdf4' : 'white'};border:2px solid ${isActive ? '#22c55e' : '#e5e7eb'};cursor:${isActive ? 'default' : 'pointer'}">
        <div style="border-radius:8px;${gs.border};padding:2px;background:${gs.bg};flex-shrink:0">
          <img src="images/squirrels/${spriteFile}.png" style="width:30px;height:30px;object-fit:contain;border-radius:6px;display:block" onerror="this.outerHTML='<div style=\\'font-size:22px;line-height:30px;text-align:center\\'>🐱</div>'">
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:900;color:#1f2937">${sq.name}</div>
          <div style="font-size:9px;font-weight:700;color:${gs.color}">${gs.label}</div>
        </div>
        <div style="font-size:10px;font-weight:800;color:${isActive ? '#16a34a' : '#f59e0b'}">${isActive ? '장착 중' : '장착'}</div>
      </div>`;
  }).join('')}</div>`;
}

async function farmEquipFarmer(squirrelId) {
  try {
    const { data, error } = await sb.rpc('farm_set_active_farmer', { p_user_id: myProfile.id, p_squirrel_id: squirrelId });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('🌾', '농부를 장착했어요!');
    closeModal();
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm equip]', e); toast('❌', '장착 실패'); }
}

async function farmUnequipFarmer() {
  try {
    const { data, error } = await sb.rpc('farm_set_active_farmer', { p_user_id: myProfile.id, p_squirrel_id: null });
    if (error) throw error;
    toast('🌾', '농부를 해제했어요');
    closeModal();
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm unequip]', e); toast('❌', '해제 실패'); }
}

// ================================================================
//  [관리자] 수습 시간 스킵
// ================================================================
async function farmSkipApprentice() {
  if (!myProfile?.is_admin) return;
  try {
    const { error } = await sb.from('farm_data')
      .update({ apprentice_until: new Date().toISOString() })
      .eq('user_id', myProfile.id);
    if (error) throw error;
    toast('⏩', '수습 시간 스킵!');
    _farmClearTimer();
    if (window._sqApprenticeTimer) { clearInterval(window._sqApprenticeTimer); window._sqApprenticeTimer = null; }
    await _farmReloadAll();
    if (document.getElementById('sqFarmArea')) farmRenderMain();
    if (typeof sqRenderGrid === 'function') sqRenderGrid();
  } catch (e) { console.error('[farm skip]', e); toast('❌', '스킵 실패'); }
}

// ================================================================
//  [관리자] 작물 성장 시간 스킵
// ================================================================
async function farmAdminSkipGrow(slot) {
  if (!myProfile?.is_admin) return;
  try {
    const { data, error } = await sb.rpc('farm_admin_skip_grow', {
      p_admin_id: myProfile.id, p_slot: slot
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }
    toast('⏩', `${slot}번 밭 성장 스킵!`);
    await _farmReloadAll();
    farmRenderMain();
  } catch (e) { console.error('[farm admin skip grow]', e); toast('❌', '스킵 실패'); }
}

// ================================================================
//  파종 모달 (인벤토리 씨앗 선택 → 밭에 심기)
// ================================================================
function farmShowPlantModal(slot) {
  // 농부 장착 체크
  if (!_farmData?.active_farmer_id) {
    toast('⚠️', '농부가 장착되어 있어야 씨앗을 심을 수 있어요');
    return;
  }

  const seeds = (_farmInventory || []).filter(i => i.item_type === 'seed' && i.quantity > 0);

  if (seeds.length === 0) {
    toast('🌱', '심을 씨앗이 없어요! 상점에서 구매하세요');
    return;
  }

  let listHtml = '';
  seeds.forEach(inv => {
    const crop = _farmCrops.find(c => c.id === inv.crop_id);
    if (!crop) return;
    listHtml += `
      <div onclick="farmDoPlant(${slot},'${inv.crop_id}')" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;background:var(--list-item-bg);border:1.5px solid var(--list-item-border);cursor:pointer;transition:all .15s">
        <div style="font-size:28px;flex-shrink:0">${crop.emoji}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:900;color:#1f2937">${crop.name} 씨앗 <span style="font-size:10px;color:#6b7280">×${inv.quantity}</span></div>
          <div style="font-size:9px;color:#6b7280">재배 ${crop.grow_min_hours}~${crop.grow_max_hours}시간</div>
        </div>
        <div style="font-size:10px;color:#16a34a;font-weight:800">심기 →</div>
      </div>`;
  });

  showModal(`
    <div style="padding:4px 0">
      <div style="font-size:14px;font-weight:900;color:#1f2937;text-align:center;margin-bottom:4px">🌱 씨앗 심기</div>
      <div style="font-size:10px;color:#6b7280;text-align:center;margin-bottom:12px">${slot}번 밭에 심을 씨앗을 선택하세요</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
        ${listHtml}
      </div>
      <button onclick="closeModal()" class="btn w-full" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:11px;font-weight:700;margin-top:10px">취소</button>
    </div>
  `);
}

async function farmDoPlant(slot, cropId) {
  const crop = _farmCrops.find(c => c.id === cropId);
  closeModal();
  try {
    const { data, error } = await sb.rpc('farm_plant_seed', {
      p_user_id: myProfile.id, p_slot: slot, p_crop_id: cropId
    });
    if (error) throw error;
    if (data?.error) { toast('⚠️', data.error); return; }

    toast(crop?.emoji || '🌱', `${crop?.name || ''} 씨앗을 심었어요!`);
    await _farmReloadAll();
    farmRenderMain();
  } catch(e) {
    console.error('[farm plant]', e);
    toast('❌', '심기 실패: ' + (e?.message || ''));
  }
}

// ================================================================
//  수확 (이벤트 연출 포함)
// ================================================================
async function farmHarvest(slot) {
  const plot = _farmPlots.find(p => p.slot === slot);
  if (!plot?.crop_id) return;

  // 농부 장착 체크
  if (!_farmData?.active_farmer_id) {
    toast('⚠️', '농부가 장착되어 있어야 수확할 수 있어요');
    return;
  }

  const crop = _farmCrops.find(c => c.id === plot.crop_id);

  // 수확 연출
  showModal(`
    <div id="farmHarvestAnim" style="text-align:center;padding:20px 0">
      <div style="font-size:48px;animation:sqCardShake 0.5s ease infinite">${crop?.emoji || '🌾'}</div>
      <div style="font-size:14px;font-weight:900;color:#78350f;margin-top:12px">수확 중...</div>
    </div>
  `);

  _playTone(330, 'sine', 0.1, 0.15);
  setTimeout(() => _playTone(392, 'sine', 0.1, 0.15), 150);
  setTimeout(() => _playTone(523, 'triangle', 0.15, 0.12), 300);

  let result;
  try {
    const { data, error } = await sb.rpc('farm_harvest_plot', {
      p_user_id: myProfile.id, p_slot: slot
    });
    if (error) throw error;
    if (data?.error) { closeModal(); toast('⚠️', data.error); return; }
    result = data;
  } catch(e) {
    console.error('[farm harvest]', e);
    closeModal();
    toast('❌', '수확 실패');
    return;
  }

  // 1.5초 후 결과 표시
  setTimeout(() => {
    const ev = result.event;
    const qty = result.actual_qty;
    const lost = result.lost_qty || 0;
    let icon, title, desc, color;

    if (ev === 'catthief') {
      icon = '🐱';
      title = '길냥이 도둑!';
      desc = '길냥이가 작물을 몽땅 훔쳐갔어요...!';
      color = '#6b7280';
      _playTone(200, 'sine', 0.15, 0.3);
      setTimeout(() => _playTone(160, 'sine', 0.15, 0.4), 200);
    } else if (ev === 'poor') {
      icon = '😥';
      title = '흉작...';
      desc = `${crop?.name || '작물'} ${qty}개만 수확했어요`;
      color = '#f59e0b';
      _playTone(260, 'sine', 0.12, 0.2);
    } else if (ev === 'bumper') {
      icon = '🎉';
      title = '풍작!';
      desc = `${crop?.name || '작물'} ${qty}개 대풍작이에요!`;
      color = '#16a34a';
      _sqPlayGrowSound();
      setTimeout(() => {
        const modal = document.querySelector('.modal-box');
        if (modal) { const r = modal.getBoundingClientRect(); _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 20); }
      }, 200);
    } else {
      icon = crop?.emoji || '🌾';
      title = '수확 완료!';
      desc = `${crop?.name || '작물'} ${qty}개를 수확했어요`;
      color = '#16a34a';
      _playTone(440, 'triangle', 0.12, 0.15);
    }

    closeModal();
    setTimeout(() => {
      showModal(`
        <div style="text-align:center;padding:12px 0">
          <div style="font-size:52px;margin-bottom:8px">${icon}</div>
          <div style="font-size:18px;font-weight:900;color:${color};margin-bottom:6px">${title}</div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:${lost > 0 ? '6' : '16'}px">${desc}</div>
          ${lost > 0 ? `<div style="font-size:10px;color:#ef4444;margin-bottom:16px">⚠️ 인벤토리 부족으로 ${lost}개 소실!</div>` : ''}
          <button onclick="closeModal()" class="btn btn-primary w-full">확인</button>
        </div>
      `);
    }, 150);

    // 데이터 갱신
    _farmReloadAll().then(() => farmRenderMain());
  }, 1500);
}

// ================================================================
//  유틸리티
// ================================================================
async function _farmReloadAll() {
  const { data: farmData } = await sb.from('farm_data').select('*').eq('user_id', myProfile.id).maybeSingle();
  _farmData = farmData;
  const { data: farmers } = await sb.from('farm_farmers').select('*').eq('user_id', myProfile.id);
  _farmFarmers = farmers || [];
  window._farmDataLoaded = true;
  const { data: plots } = await sb.from('farm_plots').select('*').eq('user_id', myProfile.id).order('slot');
  _farmPlots = plots || [];
  const { data: inv } = await sb.from('farm_inventory').select('*').eq('user_id', myProfile.id);
  _farmInventory = inv || [];
  // 시세 갱신
  const now = new Date().toISOString();
  const { data: prices } = await sb.from('farm_prices').select('*').lte('period_start', now).gt('period_end', now);
  _farmPrices = prices || [];
  // 판매 상태
  try {
    const { data: ss } = await sb.rpc('farm_get_sell_status', { p_user_id: myProfile.id });
    _farmSellStatus = ss?.sales || {};
  } catch(e) { /* 아직 함수 없을 수 있음 */ }
}

function _farmFmtTime(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
}

function _farmClearTimer() {
  if (_farmTimer) { clearInterval(_farmTimer); _farmTimer = null; }
}
