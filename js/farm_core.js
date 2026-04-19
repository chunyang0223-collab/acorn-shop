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

// ── 관리자: DB 실제 연산 결과 미리보기 (서버) ──
async function farmLoadPreview() {
  const { data, error } = await sb.rpc('farm_preview_probabilities');
  if (error || !data) return;
  _farmRenderPreview(data);
}

// ── 미리보기 DOM 렌더링 (서버/로컬 공통) ──
function _farmRenderPreview(data) {
  const gradeMap = { uncommon: 'Rare', rare: 'Epic', epic: 'Unique', legendary: 'Legend' };
  for (const [grade, label] of Object.entries(gradeMap)) {
    const d = data[grade];
    if (!d) continue;
    const b = d.base;
    const n = d.nourished;
    const el = document.getElementById(`farmPreview_${label}`);
    if (el) el.innerHTML =
      `<span style="color:var(--cfg-desc-color)">등급만:</span> 풍작 ${b.bumper}% · 흉작 ${b.poor}% · 길냥이 ${b.catthief}% · 일반 ${b.normal}%` +
      `<br><span style="color:var(--cfg-desc-color)">+영양제:</span> 풍작 ${n.bumper}% · 흉작 ${n.poor}% · 길냥이 ${n.catthief}% · 일반 ${n.normal}%`;
  }
  const c = data.common;
  if (c) {
    const el = document.getElementById('farmPreview_Base');
    if (el) el.innerHTML =
      `<span style="color:var(--cfg-desc-color)">기본:</span> 풍작 ${c.base.bumper}% · 흉작 ${c.base.poor}% · 길냥이 ${c.base.catthief}% · 일반 ${c.base.normal}%` +
      `<br><span style="color:var(--cfg-desc-color)">+영양제:</span> 풍작 ${c.nourished.bumper}% · 흉작 ${c.nourished.poor}% · 길냥이 ${c.nourished.catthief}% · 일반 ${c.nourished.normal}%`;
  }
}

// ── 관리자: 클라이언트 측 실시간 미리보기 계산 ──
// farm_preview_probabilities SQL과 동일 로직, 입력 필드에서 직접 읽어 계산
function farmCalcPreviewLocal() {
  const v = (id, fb) => { const el = document.getElementById(id); return el ? (parseFloat(el.value) || fb) : fb; };
  const r = (n) => Math.round(n * 100) / 100;

  const baseBumper   = v('farmSet_harvestBumper', 20);
  const basePoor     = v('farmSet_harvestPoor', 25);
  const baseCatthief = v('farmSet_harvestCatthief', 5);
  const nutBoost     = v('farmSet_nutrientBumperBoost', 20);

  // JS UI등급 → DB등급 매핑 + 입력필드 매핑
  const grades = [
    { db: 'common',    label: 'Base',   bumper: 0, poor: 0, catthief: 0 },
    { db: 'uncommon',  label: 'Rare',   bumper: v('farmSet_gradeRareBumper', 0),   poor: -v('farmSet_gradeRarePoor', 12),   catthief: 0 },
    { db: 'rare',      label: 'Epic',   bumper: v('farmSet_gradeEpicBumper', 10),  poor: -v('farmSet_gradeEpicPoor', 20),   catthief: 0 },
    { db: 'epic',      label: 'Unique', bumper: v('farmSet_gradeUniqueBumper', 20), poor: -v('farmSet_gradeUniquePoor', 28), catthief: 0 },
    { db: 'legendary', label: 'Legend', bumper: v('farmSet_gradeLegendBumper', 35), poor: -v('farmSet_gradeLegendPoor', 40), catthief: 0 },
  ];

  const result = {};
  for (const g of grades) {
    // 1) 등급 버프 적용 (곱연산)
    let bumper   = baseBumper   * (1 + g.bumper / 100);
    let poor     = basePoor     * (1 + g.poor / 100);
    let catthief = baseCatthief * (1 + g.catthief / 100);
    if (poor < 0) poor = 0;
    if (catthief < 0) catthief = 0;
    let normal = 100 - bumper - poor - catthief;
    if (normal < 10) normal = 10;

    const baseResult = { bumper: r(bumper), poor: r(poor), catthief: r(catthief), normal: r(normal) };

    // 2) 등급 버프 + 영양제
    const remaining = poor + catthief;
    bumper += nutBoost;
    if (remaining > 0) {
      const newRemaining = Math.max(remaining - nutBoost, 0);
      const scale = newRemaining / remaining;
      poor     = poor * scale;
      catthief = catthief * scale;
    }
    normal = 100 - bumper - poor - catthief;
    if (normal < 10) normal = 10;

    const nourishedResult = { bumper: r(bumper), poor: r(poor), catthief: r(catthief), normal: r(normal) };
    result[g.db] = { base: baseResult, nourished: nourishedResult };
  }

  _farmRenderPreview(result);
}

// ── 관리자: 설정 입력 필드에 실시간 미리보기 이벤트 바인딩 ──
function farmBindPreviewEvents() {
  const ids = [
    'farmSet_harvestBumper', 'farmSet_harvestPoor', 'farmSet_harvestCatthief',
    'farmSet_nutrientBumperBoost',
    'farmSet_gradeRareBumper', 'farmSet_gradeRarePoor', 'farmSet_gradeRareGrow',
    'farmSet_gradeEpicBumper', 'farmSet_gradeEpicPoor', 'farmSet_gradeEpicGrow',
    'farmSet_gradeUniqueBumper', 'farmSet_gradeUniquePoor', 'farmSet_gradeUniqueGrow',
    'farmSet_gradeLegendBumper', 'farmSet_gradeLegendPoor', 'farmSet_gradeLegendGrow',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', farmCalcPreviewLocal);
  }
}

// ── 관리자: 농장 설정 UI 로드 ──
async function farmAdminLoadSettingsUI() {
  await farmLoadSettings();
  const s = _farmSettings;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('farmSet_harvestNormal', s.harvest_normal_pct ?? 50);
  set('farmSet_harvestBumper', s.harvest_bumper_pct ?? 20);
  set('farmSet_harvestPoor', s.harvest_poor_pct ?? 25);
  set('farmSet_harvestCatthief', s.harvest_catthief_pct ?? 5);
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
  // 등급별 버프
  set('farmSet_gradeRareBumper', s.grade_rare_bumper ?? 0);
  set('farmSet_gradeRarePoor', s.grade_rare_poor ?? 12);
  set('farmSet_gradeRareGrow', s.grade_rare_grow ?? 0);
  set('farmSet_gradeEpicBumper', s.grade_epic_bumper ?? 10);
  set('farmSet_gradeEpicPoor', s.grade_epic_poor ?? 20);
  set('farmSet_gradeEpicGrow', s.grade_epic_grow ?? 5);
  set('farmSet_gradeUniqueBumper', s.grade_unique_bumper ?? 20);
  set('farmSet_gradeUniquePoor', s.grade_unique_poor ?? 28);
  set('farmSet_gradeUniqueGrow', s.grade_unique_grow ?? 8);
  set('farmSet_gradeLegendBumper', s.grade_legend_bumper ?? 35);
  set('farmSet_gradeLegendPoor', s.grade_legend_poor ?? 40);
  set('farmSet_gradeLegendGrow', s.grade_legend_grow ?? 12);
  // 이벤트 바인딩 + 즉시 로컬 미리보기 계산 (서버 호출 불필요)
  farmBindPreviewEvents();
  farmCalcPreviewLocal();
}

async function farmSaveSettings() {
  const get = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseFloat(el.value) || fallback) : fallback;
  };
  const merged = Object.assign({}, _farmSettings, {
    harvest_normal_pct:    get('farmSet_harvestNormal', 50),
    harvest_bumper_pct:    get('farmSet_harvestBumper', 20),
    harvest_poor_pct:      get('farmSet_harvestPoor', 25),
    harvest_catthief_pct:  get('farmSet_harvestCatthief', 5),
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
    // 등급별 버프 (평탄 키 — UI용)
    grade_rare_bumper:     get('farmSet_gradeRareBumper', 0),
    grade_rare_poor:       get('farmSet_gradeRarePoor', 12),
    grade_rare_grow:       get('farmSet_gradeRareGrow', 0),
    grade_epic_bumper:     get('farmSet_gradeEpicBumper', 10),
    grade_epic_poor:       get('farmSet_gradeEpicPoor', 20),
    grade_epic_grow:       get('farmSet_gradeEpicGrow', 5),
    grade_unique_bumper:   get('farmSet_gradeUniqueBumper', 20),
    grade_unique_poor:     get('farmSet_gradeUniquePoor', 28),
    grade_unique_grow:     get('farmSet_gradeUniqueGrow', 8),
    grade_legend_bumper:   get('farmSet_gradeLegendBumper', 35),
    grade_legend_poor:     get('farmSet_gradeLegendPoor', 40),
    grade_legend_grow:     get('farmSet_gradeLegendGrow', 12),
    // 등급별 버프 (중첩 JSON — farm_harvest_plot이 실제로 읽는 구조)
    // JS등급 → DB등급 매핑: rare(레어)→uncommon(120+), epic(희귀)→rare(200+), unique(유일)→epic(280+), legend(레전드)→legendary(350+)
    grade_bonus: {
      common:    { bumper: 0, poor: 0, catthief: 0 },
      uncommon:  { bumper: get('farmSet_gradeRareBumper', 0),  poor: -get('farmSet_gradeRarePoor', 12),  catthief: 0 },
      rare:      { bumper: get('farmSet_gradeEpicBumper', 10), poor: -get('farmSet_gradeEpicPoor', 20),  catthief: 0 },
      epic:      { bumper: get('farmSet_gradeUniqueBumper', 20), poor: -get('farmSet_gradeUniquePoor', 28), catthief: 0 },
      legendary: { bumper: get('farmSet_gradeLegendBumper', 35), poor: -get('farmSet_gradeLegendPoor', 40), catthief: 0 },
    },
  });
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'farm_settings', value: merged, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (!error) {
    _farmSettings = merged;
    toast('✅', '농장 설정이 저장되었어요');
    farmCalcPreviewLocal();
  } else {
    toast('❌', '저장 실패: ' + error.message);
  }
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
  html += `<div class="farm-shop-btn" onclick="farmShowShop()"><div class="farm-shop-btn-face"><span>🛒</span><span class="farm-shop-btn-label">상점</span></div></div>`;
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
  const sign = (acorns > 0 || crumbs > 0) ? '+' : '';
  const display = `${sign}${acorns}.${String(crumbs).padStart(2, '0')}`;
  return `
    <div onclick="farmShowDeposit()" style="cursor:pointer;flex:1;display:flex">
      <div class="farm-deposit-outer" style="flex:1;display:flex">
        <div class="farm-deposit-inner" style="flex:1">
          <div class="farm-deposit-acorns">${display}</div>
        </div>
      </div>
    </div>`;
}

// ================================================================
//  밭 그리드 (3x3) — 픽셀아트
// ================================================================
// 작물별 풀잎 색상 클래스 매핑 (5가지 돌려가며 사용)
const _farmCropColorClasses = ['crop-green', 'crop-lime', 'crop-deep', 'crop-olive', 'crop-teal'];
function _farmGetCropColorClass(cropId) {
  if (!cropId) return 'crop-green';
  return _farmCropColorClasses[(cropId - 1) % _farmCropColorClasses.length];
}

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
        // 촉진제/영양제 상태를 data attribute로 저장 (팝업에서 사용)
        const cropColor = _farmGetCropColorClass(plot.crop_id);
        const cellClass = ready ? 'farm-cell farm-cell-ready farm-cell-clickable' : `farm-cell farm-cell-growing ${cropColor} farm-cell-clickable`;
        const growingClick = isGrowing ? `onclick="farmShowCropPopup(${i})"` : '';
        gridHtml += `
          <div id="farm-cell-${i}" class="${cellClass}" data-harvest="${plot.harvest_at || ''}" data-acc="${alreadyAccelerated?1:0}" data-nut="${alreadyNourished?1:0}" data-has-acc="${hasAcc?1:0}" data-has-nut="${hasNut?1:0}" ${ready ? `onclick="farmHarvest(${i})"` : growingClick}>
            <div class="farm-cell-emoji">${crop?.emoji || '🌱'}</div>
            <div id="farm-cell-label-${i}" class="farm-cell-label ${ready ? 'farm-txt-gold' : 'farm-txt-green'}">${ready ? '수확!' : (crop?.name || '')}</div>
            <div id="farm-cell-timer-${i}" class="farm-cell-timer">${!ready && remainStr ? remainStr : ''}</div>
            ${myProfile?.is_admin ? `<div id="farm-cell-skip-${i}" onclick="event.stopPropagation();farmAdminSkipGrow(${i})" style="position:absolute;top:1px;right:1px;font-size:7px;background:var(--p-red-500);color:white;border-radius:4px;padding:1px 3px;cursor:pointer;font-weight:800;opacity:0.8;display:${ready ? 'none' : 'block'}">⏩</div>` : ''}
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
    <div class="farm-field-wrap">
      <div class="farm-field-label">🌱 나의 밭</div>
      <div class="farm-field-grid">
        ${gridHtml}
      </div>
    </div>`;
}

// ================================================================
//  농부 슬롯 (상단 인라인) — 픽셀아트
// ================================================================
function _farmGradeBuff(grade) {
  const s = _farmSettings;

  if (grade === 'normal') return { isDefault: true, lines: [] };

  const bm = s[`grade_${grade}_bumper`] ?? { rare:0, epic:10, unique:20, legend:35 }[grade] ?? 0;
  const pm = s[`grade_${grade}_poor`]   ?? { rare:12, epic:20, unique:28, legend:40 }[grade] ?? 0;
  const gm = s[`grade_${grade}_grow`]   ?? { rare:0, epic:5, unique:8, legend:12 }[grade] ?? 0;

  const lines = [];
  if (bm > 0) lines.push(`풍작 확률 +${bm}%`);
  if (pm > 0) lines.push(`흉작 확률 -${pm}%`);
  if (gm > 0) lines.push(`작물 성장 시간 -${gm}%`);

  return { isDefault: false, lines };
}

function farmRenderFarmerSlot() {
  const activeSq = _farmData?.active_farmer_id
    ? _sqSquirrels.find(s => s.id === _farmData.active_farmer_id)
    : null;

  if (activeSq) {
    const grade = _sqCalcGrade(activeSq);
    const gs = _sqGradeStyle(grade);
    const buff = _farmGradeBuff(grade);
    const spriteFile = activeSq.sprite || 'sq_acorn';

    let buffHtml;
    if (buff.isDefault) {
      buffHtml = `<div class="fc-buff fc-buff-default">🌱 기본 농부</div>`;
    } else {
      buffHtml = `<div class="fc-buff">${buff.lines.map(l => `<span class="fc-buff-line">${l}</span>`).join('')}</div>`;
    }

    return `
      <div class="fc-card fc-grade-${grade}" onclick="farmShowChangeFarmer()">
        <div class="fc-zone1">
          <img src="images/squirrels/${spriteFile}.png" alt="" onerror="this.outerHTML='<div class=\\'fc-emoji-fb\\'>🐿️</div>'">
        </div>
        <div class="fc-zone2"><div class="fc-name">${activeSq.name}</div></div>
        <div class="fc-zone3"><div class="fc-grade">${gs.label}</div></div>
        <div class="fc-zone4">${buffHtml}</div>
      </div>`;
  }

  if (_farmFarmers.length > 0) {
    return `
      <div class="fc-card-empty" onclick="farmShowChangeFarmer()">
        <div class="fc-empty-emoji">🐿️</div>
        <div class="fc-empty-label">농부 장착</div>
      </div>`;
  }

  return `
    <div class="fc-card-empty fc-card-none">
      <div class="fc-empty-emoji" style="opacity:0.4">🐿️</div>
      <div class="fc-empty-label">농부 없음</div>
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

// ================================================================
//  작물 클릭 팝업 (촉진제/영양제 사용)
// ================================================================
function farmShowCropPopup(slot) {
  const plot = _farmPlots.find(p => p.slot === slot);
  if (!plot || !plot.crop_id) return;
  const crop = _farmCrops.find(c => c.id === plot.crop_id);
  const accInv = (_farmInventory || []).find(iv => iv.item_type === 'accelerator');
  const nutInv = (_farmInventory || []).find(iv => iv.item_type === 'nutrient');
  const hasAcc = accInv && accInv.quantity > 0;
  const hasNut = nutInv && nutInv.quantity > 0;
  const alreadyAcc = !!plot.accelerated;
  const alreadyNut = !!plot.nourished;

  // 촉진제 버튼
  let accBtn = '';
  if (alreadyAcc) {
    accBtn = `<div class="farm-crop-popup-btn farm-crop-popup-btn-used">
      <span class="farm-crop-popup-btn-icon">⚡</span>
      <span class="farm-crop-popup-btn-label">촉진제</span>
      <span class="farm-crop-popup-btn-qty">사용 완료</span>
    </div>`;
  } else if (hasAcc) {
    accBtn = `<div class="farm-crop-popup-btn farm-crop-popup-btn-acc" onclick="event.stopPropagation();farmCloseCropPopup();farmUseAccelerator(${slot})">
      <span class="farm-crop-popup-btn-icon">⚡</span>
      <span class="farm-crop-popup-btn-label">촉진제</span>
      <span class="farm-crop-popup-btn-qty">보유 ${accInv.quantity}개</span>
    </div>`;
  } else {
    accBtn = `<div class="farm-crop-popup-btn farm-crop-popup-btn-used">
      <span class="farm-crop-popup-btn-icon">⚡</span>
      <span class="farm-crop-popup-btn-label">촉진제</span>
      <span class="farm-crop-popup-btn-qty">없음</span>
    </div>`;
  }

  // 영양제 버튼
  let nutBtn = '';
  if (alreadyNut) {
    nutBtn = `<div class="farm-crop-popup-btn farm-crop-popup-btn-used">
      <span class="farm-crop-popup-btn-icon">🧪</span>
      <span class="farm-crop-popup-btn-label">영양제</span>
      <span class="farm-crop-popup-btn-qty">사용 완료</span>
    </div>`;
  } else if (hasNut) {
    nutBtn = `<div class="farm-crop-popup-btn farm-crop-popup-btn-nut" onclick="event.stopPropagation();farmCloseCropPopup();farmUseNutrient(${slot})">
      <span class="farm-crop-popup-btn-icon">🧪</span>
      <span class="farm-crop-popup-btn-label">영양제</span>
      <span class="farm-crop-popup-btn-qty">보유 ${nutInv.quantity}개</span>
    </div>`;
  } else {
    nutBtn = `<div class="farm-crop-popup-btn farm-crop-popup-btn-used">
      <span class="farm-crop-popup-btn-icon">🧪</span>
      <span class="farm-crop-popup-btn-label">영양제</span>
      <span class="farm-crop-popup-btn-qty">없음</span>
    </div>`;
  }

  const remaining = plot.harvest_at ? Math.max(0, new Date(plot.harvest_at) - Date.now()) : 0;
  const remainStr = _farmFmtTime(remaining);

  const overlay = document.createElement('div');
  overlay.className = 'farm-crop-popup-overlay';
  overlay.id = 'farmCropPopupOverlay';
  overlay.onclick = (e) => { if (e.target === overlay) farmCloseCropPopup(); };
  overlay.innerHTML = `
    <div class="farm-crop-popup">
      <div class="farm-crop-popup-title">${crop?.emoji || '🌱'} ${crop?.name || '작물'}</div>
      <div class="farm-crop-popup-sub">남은 시간: ${remainStr}</div>
      <div class="farm-crop-popup-btns">
        ${accBtn}
        ${nutBtn}
      </div>
      <button class="farm-crop-popup-close" onclick="farmCloseCropPopup()">닫기</button>
    </div>`;
  document.body.appendChild(overlay);
}

function farmCloseCropPopup() {
  const overlay = document.getElementById('farmCropPopupOverlay');
  if (overlay) overlay.remove();
}
