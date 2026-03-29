/* ================================================================
   🌾 다람쥐 농장 — 코어 (farm_core.js)
   상태관리 / 초기화 / 메인렌더링 / 밭그리드 / 농부슬롯
   / 예치금뱃지 / 인벤토리 / 타이머 / 유틸
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
var _farmTimer = null;     // 수확 타이머 인터벌

// ── 설정 로드 ──
async function farmLoadSettings() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'farm_settings').maybeSingle();
  _farmSettings = data?.value || {};
}

// ── 관리자: 농장 설정 UI 로드 ──
async function farmAdminLoadSettingsUI() {
  await farmLoadSettings();
  const s = _farmSettings;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('farmSet_harvestNormal', s.harvest_normal_pct ?? 55);
  set('farmSet_harvestBumper', s.harvest_bumper_pct ?? 20);
  set('farmSet_harvestPoor', s.harvest_poor_pct ?? 17);
  set('farmSet_harvestCatthief', s.harvest_catthief_pct ?? 8);
  set('farmSet_normalHarvest', s.normal_harvest ?? 3);
  set('farmSet_priceVariance', s.price_variance_pct ?? 30);
  set('farmSet_bumperMin', s.bumper_min ?? 4);
  set('farmSet_bumperMax', s.bumper_max ?? 5);
  set('farmSet_poorMin', s.poor_min ?? 1);
  set('farmSet_poorMax', s.poor_max ?? 2);
  set('farmSet_plotBaseCost', s.plot_base_cost ?? 10);
  set('farmSet_plotIncrement', s.plot_cost_increment ?? 10);
  set('farmSet_maxPlots', s.max_plots ?? 9);
  set('farmSet_sellRatePct', s.sell_rate_pct ?? 110);
  set('farmSet_seedResellPct', s.seed_resell_pct ?? 70);
  set('farmSet_tier1Limit', s.sell_tier1_limit ?? 10);
  set('farmSet_tier2Limit', s.sell_tier2_limit ?? 10);
  set('farmSet_tier3Limit', s.sell_tier3_limit ?? 10);
  set('farmSet_tier1Pct', s.sell_tier1_pct ?? 100);
  set('farmSet_tier2Pct', s.sell_tier2_pct ?? 80);
  set('farmSet_tier3Pct', s.sell_tier3_pct ?? 60);
  set('farmSet_apprenticeHours', s.apprentice_hours ?? 4);
  set('farmSet_apprenticeSuccess', s.apprentice_success_pct ?? 50);
  set('farmSet_apprenticeFailReward', s.apprentice_fail_reward ?? 500);
  set('farmSet_inventoryBase', s.inventory_base ?? 3);
  set('farmSet_inventoryExpandCost', s.inventory_expand_cost ?? 10);
  set('farmSet_inventoryMax', s.inventory_max ?? 20);
  set('farmSet_acceleratorCost', s.accelerator_cost ?? 3);
  set('farmSet_acceleratorPct', s.accelerator_pct ?? 50);
  set('farmSet_nutrientCost', s.nutrient_cost ?? 5);
  set('farmSet_nutrientBumperBoost', s.nutrient_bumper_boost ?? 20);
}

async function farmSaveSettings() {
  const get = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseFloat(el.value) || fallback) : fallback;
  };
  const merged = Object.assign({}, _farmSettings, {
    harvest_normal_pct:    get('farmSet_harvestNormal', 55),
    harvest_bumper_pct:    get('farmSet_harvestBumper', 20),
    harvest_poor_pct:      get('farmSet_harvestPoor', 17),
    harvest_catthief_pct:  get('farmSet_harvestCatthief', 8),
    normal_harvest:        get('farmSet_normalHarvest', 3),
    price_variance_pct:    get('farmSet_priceVariance', 30),
    bumper_min:            get('farmSet_bumperMin', 4),
    bumper_max:            get('farmSet_bumperMax', 5),
    poor_min:              get('farmSet_poorMin', 1),
    poor_max:              get('farmSet_poorMax', 2),
    plot_base_cost:        get('farmSet_plotBaseCost', 10),
    plot_cost_increment:   get('farmSet_plotIncrement', 10),
    max_plots:             get('farmSet_maxPlots', 9),
    sell_rate_pct:         get('farmSet_sellRatePct', 110),
    seed_resell_pct:       get('farmSet_seedResellPct', 70),
    sell_tier1_limit:      get('farmSet_tier1Limit', 10),
    sell_tier2_limit:      get('farmSet_tier2Limit', 10),
    sell_tier3_limit:      get('farmSet_tier3Limit', 10),
    sell_tier1_pct:        get('farmSet_tier1Pct', 100),
    sell_tier2_pct:        get('farmSet_tier2Pct', 80),
    sell_tier3_pct:        get('farmSet_tier3Pct', 60),
    apprentice_hours:      get('farmSet_apprenticeHours', 4),
    apprentice_success_pct:get('farmSet_apprenticeSuccess', 50),
    apprentice_fail_reward:get('farmSet_apprenticeFailReward', 500),
    inventory_base:        get('farmSet_inventoryBase', 3),
    inventory_expand_cost: get('farmSet_inventoryExpandCost', 10),
    inventory_max:         get('farmSet_inventoryMax', 20),
    accelerator_cost:      get('farmSet_acceleratorCost', 3),
    accelerator_pct:       get('farmSet_acceleratorPct', 50),
    nutrient_cost:         get('farmSet_nutrientCost', 5),
    nutrient_bumper_boost: get('farmSet_nutrientBumperBoost', 20),
  });
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'farm_settings', value: merged, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (!error) { _farmSettings = merged; toast('✅', '농장 설정이 저장되었어요'); }
  else toast('❌', '저장 실패: ' + error.message);
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
//  농장 메인 화면 (픽셀아트 UI)
// ================================================================
function farmRenderMain() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;
  _farmClearTimer();

  let html = '';

  // ── 상단 바: 농부 카드 + 우측(예치금/상점) — D7 닌텐도 스위치 ──
  html += `<div class="farm-topbar">`;
  html += farmRenderFarmerSlot();
  html += `<div class="farm-right-col">`;
  html += farmRenderDepositBadge();
  html += `<div class="farm-shop-btn" onclick="farmShowShop()"><span class="farm-shop-lbl" style="font-size:11px;font-weight:800;color:#fff">상점</span></div>`;
  html += `</div>`;
  html += `</div>`;

  // ── 밭 그리드 ──
  html += farmRenderFieldGrid();

  // ── 인벤토리 (소비아이템 태그 포함) ──
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
          cell.className = 'farm-cell farm-cell-ready farm-cell-clickable';
          cell.setAttribute('onclick', `farmHarvest(${slot})`);
          labelEl.className = 'farm-cell-label farm-txt-gold';
          labelEl.textContent = '수확!';
          timerEl.textContent = '';
          if (skipEl) skipEl.style.display = 'none';
        } else {
          anyGrowing = true;
          timerEl.textContent = _farmFmtTime(remaining);
        }
      });
      if (!anyGrowing) _farmClearTimer();
    }, 1000);
  }
}

// ================================================================
//  예치금 뱃지 (상단 오른쪽) — 픽셀아트
// ================================================================
function farmRenderDepositBadge() {
  const acorns = _farmData?.deposit_acorns || 0;
  const crumbs = _farmData?.deposit_crumbs || 0;
  return `
    <div class="farm-deposit-badge" onclick="farmShowDeposit()">
      <div style="font-size:14px">🌰</div>
      <div class="farm-dep-num" style="font-size:18px;font-weight:900;line-height:1;font-family:'Pretendard',sans-serif">${acorns}</div>
      <div class="farm-dep-sub" style="font-size:10px;font-weight:700;font-family:'Pretendard',sans-serif">+${crumbs}조각</div>
    </div>`;
}

// ================================================================
//  밭 그리드 (3x3) — 픽셀아트
// ================================================================
function farmRenderFieldGrid() {
  const plotCount = _farmData?.plot_count || 1;
  const maxPlots = _farmSettings.max_plots || 9;
  const hasFarmer = !!_farmData?.active_farmer_id;

  let gridHtml = '';
  for (let i = 1; i <= 9; i++) {
    const plot = _farmPlots.find(p => p.slot === i);
    if (i <= plotCount) {
      if (plot?.crop_id) {
        const crop = _farmCrops.find(c => c.id === plot.crop_id);
        const harvestAt = plot.harvest_at ? new Date(plot.harvest_at) : null;
        const ready = harvestAt && harvestAt <= Date.now();
        const remaining = harvestAt ? Math.max(0, harvestAt - Date.now()) : 0;
        const remainStr = remaining > 0 ? _farmFmtTime(remaining) : '';
        const accInv = (_farmInventory || []).find(iv => iv.item_type === 'accelerator');
        const nutInv = (_farmInventory || []).find(iv => iv.item_type === 'nutrient');
        const hasAcc = accInv && accInv.quantity > 0;
        const hasNut = nutInv && nutInv.quantity > 0;
        const isGrowing = !ready && remaining > 0;
        const alreadyAccelerated = !!plot.accelerated;
        const alreadyNourished = !!plot.nourished;
        let itemBtns = '';
        if (isGrowing) {
          itemBtns += `<div class="farm-cell-item-btns">`;
          if (hasAcc && !alreadyAccelerated) {
            itemBtns += `<div onclick="event.stopPropagation();farmUseAccelerator(${i})" class="farm-cell-item-btn farm-cell-item-btn-acc" title="촉진제">⚡</div>`;
          } else if (alreadyAccelerated) {
            itemBtns += `<div class="farm-cell-item-btn farm-cell-item-btn-used" title="이미 사용됨">⚡</div>`;
          }
          if (hasNut && !alreadyNourished) {
            itemBtns += `<div onclick="event.stopPropagation();farmUseNutrient(${i})" class="farm-cell-item-btn farm-cell-item-btn-nut" title="영양제">🧪</div>`;
          } else if (alreadyNourished) {
            itemBtns += `<div class="farm-cell-item-btn farm-cell-item-btn-used" title="이미 사용됨">🧪</div>`;
          }
          itemBtns += `</div>`;
        }
        const cellClass = ready ? 'farm-cell farm-cell-ready farm-cell-clickable' : 'farm-cell farm-cell-growing';
        gridHtml += `
          <div id="farm-cell-${i}" class="${cellClass}" data-harvest="${plot.harvest_at || ''}" ${ready ? `onclick="farmHarvest(${i})"` : ''}>
            <div class="farm-cell-emoji">${crop?.emoji || '🌱'}</div>
            <div id="farm-cell-label-${i}" class="farm-cell-label ${ready ? 'farm-txt-gold' : 'farm-txt-green'}">${ready ? '수확!' : (crop?.name || '')}</div>
            <div id="farm-cell-timer-${i}" class="farm-cell-timer">${!ready && remainStr ? remainStr : ''}</div>
            ${myProfile?.is_admin ? `<div id="farm-cell-skip-${i}" onclick="event.stopPropagation();farmAdminSkipGrow(${i})" style="position:absolute;top:1px;right:1px;font-size:7px;background:#ef4444;color:white;border-radius:4px;padding:1px 3px;cursor:pointer;font-weight:800;opacity:0.8;display:${ready ? 'none' : 'block'}">⏩</div>` : ''}
            ${itemBtns}
          </div>`;
      } else {
        gridHtml += `
          <div class="farm-cell farm-cell-empty ${hasFarmer ? 'farm-cell-clickable' : ''}" ${hasFarmer ? `onclick="farmShowPlantModal(${i})"` : ''}>
            <div class="farm-cell-emoji" style="opacity:0.35">🌱</div>
            <div class="farm-cell-label farm-txt-muted">${hasFarmer ? '심기' : '농부 필요'}</div>
          </div>`;
      }
    } else if (i === plotCount + 1 && i <= maxPlots) {
      const expandCost = (_farmSettings.plot_base_cost || 10) + (_farmSettings.plot_cost_increment || 10) * (plotCount - 1);
      gridHtml += `
        <div class="farm-cell farm-cell-expand" onclick="farmShowExpandPlot(${expandCost})">
          <div class="farm-cell-emoji" style="opacity:0.5">🔒</div>
          <div class="farm-cell-label farm-txt-gold">🌰${expandCost}</div>
        </div>`;
    } else {
      gridHtml += `
        <div class="farm-cell farm-cell-locked">
          <div class="farm-cell-emoji" style="opacity:0.3">🔒</div>
        </div>`;
    }
  }

  return `
    <div class="farm-field-grid">
      ${gridHtml}
    </div>`;
}

// ================================================================
//  농부 슬롯 (상단 인라인) — 픽셀아트
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
      <div class="farm-farmer-slot" onclick="farmShowChangeFarmer()">
        <div class="farm-farmer-avatar">
          <img src="images/squirrels/${spriteFile}.png" style="width:34px;height:34px;object-fit:contain;display:block" onerror="this.outerHTML='<div style=\\'font-size:24px;line-height:34px;text-align:center\\'>🐱</div>'">
        </div>
        <div style="min-width:0;position:relative;z-index:1">
          <div class="farm-txt-brown farm-txt-bold" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;font-family:'Pretendard',sans-serif">${activeSq.name} 🌾</div>
          <div style="font-size:11px;font-weight:700;color:${gs.color};font-family:'Pretendard',sans-serif">${gs.label}</div>
        </div>
      </div>`;
  }

  if (_farmFarmers.length > 0) {
    return `
      <div class="farm-farmer-slot" onclick="farmShowChangeFarmer()">
        <div class="farm-farmer-avatar" style="opacity:0.5">🐿️</div>
        <div class="farm-txt-muted farm-txt-xs farm-txt-bold" style="position:relative;z-index:1">농부 장착</div>
      </div>`;
  }

  return `
    <div class="farm-farmer-slot farm-farmer-slot-empty">
      <div class="farm-farmer-avatar" style="opacity:0.4;background:rgba(0,0,0,.03);border-color:#d1d5db">🐿️</div>
      <div class="farm-txt-muted farm-txt-xs" style="position:relative;z-index:1">농부 없음</div>
    </div>`;
}

// ================================================================
//  소비 아이템 바 (촉진제/영양제) — 밭과 인벤토리 사이
// ================================================================
// 소비아이템을 인벤토리 헤더에 인라인 태그로 표시 (프리뷰 D7 원본 방식)
function _farmRenderConsumableTags() {
  const items = _farmInventory || [];
  const accItem = items.find(i => i.item_type === 'accelerator');
  const nutItem = items.find(i => i.item_type === 'nutrient');
  const accQty = accItem?.quantity || 0;
  const nutQty = nutItem?.quantity || 0;
  let tags = '';
  if (accQty > 0) tags += `<span class="farm-csm-tag farm-csm-acc">⚡${accQty}</span>`;
  if (nutQty > 0) tags += `<span class="farm-csm-tag farm-csm-nut">🧪${nutQty}</span>`;
  return tags;
}

// ================================================================
//  인벤토리 (슬롯당 최대 10개 스택) — 픽셀아트
// ================================================================
function farmRenderInventory() {
  const capacity = _farmData?.inventory_capacity || 3;
  const STACK_MAX = 10;
  const items = _farmInventory || [];

  const cropItems = items.filter(i => i.item_type !== 'accelerator' && i.item_type !== 'nutrient');

  let slots = [];
  cropItems.forEach(inv => {
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
      const slotClass = isSeed ? 'farm-inv-slot farm-inv-slot-seed' : 'farm-inv-slot farm-inv-slot-harvest';
      gridHtml += `
        <div class="${slotClass}">
          <div style="font-size:22px">${s.emoji}</div>
          <div class="${isSeed ? 'farm-txt-green' : 'farm-txt-gold'}" style="font-size:9px;font-weight:700;margin-top:1px;white-space:nowrap;font-family:'Pretendard',sans-serif">${isSeed ? s.name + ' 씨앗' : s.name}</div>
          <div class="farm-inv-qty">${s.qty}</div>
        </div>`;
    } else {
      gridHtml += `
        <div class="farm-inv-slot farm-inv-slot-empty">
          <div style="font-size:16px;opacity:0.25">📦</div>
        </div>`;
    }
  }

  gridHtml += `
    <div class="farm-inv-slot farm-inv-slot-expand" onclick="farmExpandInventory()" title="인벤토리 확장 (🌰${expandCost})">
      <div style="font-size:18px;opacity:0.6">+</div>
      <div class="farm-txt-gold" style="font-size:10px;font-weight:700;font-family:'Pretendard',sans-serif">🌰${expandCost}</div>
    </div>`;

  const usedSlots = slots.length;
  const totalItems = cropItems.reduce((sum, inv) => sum + inv.quantity, 0);

  const csmTags = _farmRenderConsumableTags();

  return `
    <div class="farm-inv-wrap">
      <div class="farm-inv-header">
        <div class="farm-section-title">📦 인벤토리</div>
        <div class="farm-inv-header-right">${usedSlots}/${capacity}칸 ${csmTags}</div>
      </div>
      <div class="farm-inv-grid">
        ${gridHtml}
      </div>
    </div>`;
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
  const now = new Date().toISOString();
  const { data: prices } = await sb.from('farm_prices').select('*').lte('period_start', now).gt('period_end', now);
  _farmPrices = prices || [];
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
