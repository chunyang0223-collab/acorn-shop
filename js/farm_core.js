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
  set('farmSet_inventoryBase', s.inventory_base ?? 10);
  set('farmSet_inventoryExpandCost', s.inventory_expand_cost ?? 5);
  set('farmSet_acceleratorCost', s.accelerator_cost ?? 100);
  set('farmSet_nutrientCost', s.nutrient_cost ?? 200);
  set('farmSet_depositFee', s.deposit_withdraw_fee ?? 20);
  set('farmSet_disasterChance', s.disaster_chance_pct ?? 7);
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
    inventory_base:        get('farmSet_inventoryBase', 10),
    inventory_expand_cost: get('farmSet_inventoryExpandCost', 5),
    accelerator_cost:      get('farmSet_acceleratorCost', 100),
    nutrient_cost:         get('farmSet_nutrientCost', 200),
    deposit_withdraw_fee:  get('farmSet_depositFee', 20),
    disaster_chance_pct:   get('farmSet_disasterChance', 7),
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
//  농장 메인 화면
// ================================================================
function farmRenderMain() {
  const area = document.getElementById('sqFarmArea');
  if (!area) return;
  _farmClearTimer();

  const hasFarmer = !!_farmData?.active_farmer_id;

  let html = '';

  // ── 상단 바: 상점 아이콘 + 농부 다람쥐 슬롯 + 예치금 ──
  html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">`;
  html += `<div onclick="farmShowShop()" style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 3px 10px rgba(245,158,11,.3);flex-shrink:0;font-size:20px">🛒</div>`;
  html += farmRenderFarmerSlot();
  html += `<div style="flex:1"></div>`;
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
      if (!anyGrowing) _farmClearTimer();
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
//  밭 그리드 (3x3)
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
        gridHtml += `
          <div id="farm-cell-${i}" data-harvest="${plot.harvest_at || ''}" style="aspect-ratio:1;border-radius:16px;background:${ready ? 'linear-gradient(135deg,#fef9c3,#fef3c7)' : 'linear-gradient(135deg,#ecfdf5,#d1fae5)'};border:2px solid ${ready ? '#fbbf24' : '#86efac'};display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:${ready ? 'pointer' : 'default'};transition:background .3s,border .3s;position:relative" ${ready ? `onclick="farmHarvest(${i})"` : ''}>
            <div style="font-size:${ready ? '28' : '24'}px">${crop?.emoji || '🌱'}</div>
            <div id="farm-cell-label-${i}" style="font-size:9px;font-weight:700;color:${ready ? '#92400e' : '#16a34a'};margin-top:2px">${ready ? '수확!' : (crop?.name || '')}</div>
            <div id="farm-cell-timer-${i}" style="font-size:7px;color:#6b7280;font-weight:600;margin-top:1px">${!ready && remainStr ? remainStr : ''}</div>
            ${myProfile?.is_admin ? `<div id="farm-cell-skip-${i}" onclick="event.stopPropagation();farmAdminSkipGrow(${i})" style="position:absolute;top:3px;right:3px;font-size:7px;background:#ef4444;color:white;border-radius:6px;padding:1px 4px;cursor:pointer;font-weight:800;opacity:0.8;display:${ready ? 'none' : 'block'}">⏩</div>` : ''}
          </div>`;
      } else {
        gridHtml += `
          <div style="aspect-ratio:1;border-radius:16px;background:linear-gradient(135deg,#fefce8,#fef9c3);border:2px dashed #d1d5db;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:${hasFarmer ? 'pointer' : 'default'};transition:all .15s" ${hasFarmer ? `onclick="farmShowPlantModal(${i})"` : ''}>
            <div style="font-size:22px;opacity:0.4">🌱</div>
            <div style="font-size:9px;color:#9ca3af;margin-top:2px">${hasFarmer ? '심기' : '농부 필요'}</div>
          </div>`;
      }
    } else if (i === plotCount + 1 && i <= maxPlots) {
      const expandCost = (_farmSettings.plot_base_cost || 10) + (_farmSettings.plot_cost_increment || 10) * (plotCount - 1);
      gridHtml += `
        <div style="aspect-ratio:1;border-radius:16px;background:#f9fafb;border:2px dashed #d1d5db;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s" onclick="farmShowExpandPlot(${expandCost})">
          <div style="font-size:18px;opacity:0.5">🔒</div>
          <div style="font-size:9px;color:#9ca3af;margin-top:2px">🌰${expandCost}</div>
        </div>`;
    } else {
      gridHtml += `
        <div style="aspect-ratio:1;border-radius:16px;background:#f3f4f6;border:2px solid #e5e7eb;display:flex;align-items:center;justify-content:center;opacity:0.3">
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
//  농부 슬롯 (상단 인라인)
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

  if (_farmFarmers.length > 0) {
    return `
      <div onclick="farmShowChangeFarmer()" style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:12px;background:#f9fafb;border:2px dashed #d1d5db;cursor:pointer;flex-shrink:0">
        <div style="font-size:16px;opacity:0.4">🐿️</div>
        <div style="font-size:9px;color:#9ca3af;font-weight:700">농부 장착</div>
      </div>`;
  }

  return `
    <div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:12px;background:#f9fafb;border:2px dashed #d1d5db;flex-shrink:0;opacity:0.5">
      <div style="font-size:16px">🐿️</div>
      <div style="font-size:9px;color:#9ca3af">농부 없음</div>
    </div>`;
}

// ================================================================
//  인벤토리 (슬롯당 최대 10개 스택)
// ================================================================
function farmRenderInventory() {
  const capacity = _farmData?.inventory_capacity || 3;
  const STACK_MAX = 10;
  const items = _farmInventory || [];

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
        <div style="width:48px;height:48px;border-radius:12px;background:#f9fafb;border:2px dashed #e5e7eb;display:flex;align-items:center;justify-content:center">
          <div style="font-size:14px;opacity:0.2">📦</div>
        </div>`;
    }
  }

  gridHtml += `
    <div onclick="farmExpandInventory()" style="width:48px;height:48px;border-radius:12px;background:#f3f4f6;border:2px dashed #d1d5db;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s" title="인벤토리 확장 (🌰${expandCost})">
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
