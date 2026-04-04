/* ================================================================
   🗺️ 탐험 시스템 (expedition.js)
   ================================================================
   탐험 맵 UI + 전투 시스템 통합
   - sqContinueExpedition(expId) 호출로 진입
   - 타일 노드 이동 → 이벤트 분기 (빈칸/보물/몬스터/보스)
   - 전투 씬 인라인 렌더
   - 완료/귀환 시 DB 업데이트 + 탭 복귀
   ================================================================ */

// ── 등급 테두리 스타일 (squirrel.js와 동일) ──
function _expGradeStyle(grade) {
  switch(grade) {
    case 'legend': return { border:'border:3px solid #ef4444', shadow:'0 0 10px rgba(239,68,68,.4)', color:'#dc2626' };
    case 'unique': return { border:'border:3px solid #eab308', shadow:'0 0 8px rgba(234,179,8,.3)', color:'#ca8a04' };
    case 'epic':   return { border:'border:3px solid #3b82f6', shadow:'0 0 6px rgba(59,130,246,.3)', color:'#2563eb' };
    case 'rare':   return { border:'border:3px solid #22c55e', shadow:'0 0 6px rgba(34,197,94,.2)', color:'#16a34a' };
    default:       return { border:'border:3px solid #788796', shadow:'0 0 4px rgba(120,135,150,.3)', color:'#9ca3af' };
  }
}

// ── 탐험 설정 (기본값, DB에서 덮어씀) ──
var _expConfig = {
  chance_empty: 25,
  chance_treasure: 30,
  chance_monster: 45,
  sp_min: 1,
  sp_max: 5,
  treasure_acorn_min: 3,
  treasure_acorn_max: 12,
  // 레벨 기반 스탯 시스템
  lv_base_hp: 30,   lv_base_atk: 8,   lv_base_def: 3,
  lv_grow_hp: 12,   lv_grow_atk: 2,   lv_grow_def: 1.5,
  boss_stat_mult: 1.4,
  // 몬스터 (이름, 이모지, 최소~최대 레벨)
  monsters: [
    { name: '그림자 박쥐', emoji: '🦇', lvMin: 1, lvMax: 3 },
    { name: '독 거미', emoji: '🕷️', lvMin: 2, lvMax: 4 },
    { name: '숲의 늑대', emoji: '🐺', lvMin: 3, lvMax: 6 },
    { name: '야생 멧돼지', emoji: '🐗', lvMin: 5, lvMax: 8 },
  ],
  bosses: [
    { name: '숲의 수호자', emoji: '🐻', lvMin: 7, lvMax: 10 },
    { name: '고대 뱀', emoji: '🐍', lvMin: 8, lvMax: 11 },
  ],
  // 보상 카드
  reward_weights: { C: 65, B: 28, A: 7 },
  boss_reward_weights: { C: 30, B: 45, A: 25 },
  reward_C: { acorns: [5, 10], itemChance: 0.15, items: ['🍄 버섯', '🌿 풀잎', '🪨 돌멩이'] },
  reward_B: { acorns: [10, 20], itemChance: 0.45, items: ['🍎 사과', '🔮 마석', '🪵 나무'] },
  reward_A: { acorns: [20, 40], itemChance: 0.85, items: ['💎 보석', '⚗️ 비약', '🗡️ 단검'] },
  // 전투 계수
  skill_multiplier: 1.65,
  skill_swing: 5,
  atk_swing: 3,
  mon_swing: 3,
  mon_def_effect: 38,
  sq_def_effect: 48,
  heal_percent: 40,
  escape_fail_pct: 30          // 도망 실패 확률 (%)
};

// ── 레벨로 스탯 계산 ──
function _expCalcStats(lv, isBoss) {
  var c = _expConfig;
  var hp  = Math.round(c.lv_base_hp  + lv * c.lv_grow_hp);
  var atk = Math.round(c.lv_base_atk + lv * c.lv_grow_atk);
  var def = Math.round(c.lv_base_def + lv * c.lv_grow_def);
  if (isBoss) {
    var m = c.boss_stat_mult || 1.4;
    hp  = Math.round(hp * m);
    atk = Math.round(atk * m);
    def = Math.round(def * m);
  }
  return { hp: hp, atk: atk, def: def };
}

// ── 몬스터 생성 (레벨 랜덤 → 스탯 계산) ──
function _expSpawnMonster(template, isBoss) {
  var lv = Math.floor(Math.random() * (template.lvMax - template.lvMin + 1)) + template.lvMin;
  var stats = _expCalcStats(lv, isBoss);
  return {
    name: template.name, emoji: template.emoji, lv: lv,
    hp: stats.hp, atk: stats.atk, def: stats.def
  };
}

// ── 탐험 설정 DB 로드 ──
async function expLoadSettings() {
  try {
    var res = await sb.from('app_settings').select('value').eq('key', 'expedition_settings').maybeSingle();
    if (res.data?.value) {
      var v = res.data.value;
      // 기본값에 DB값을 덮어씌움 (없는 필드는 기본값 유지)
      if (v.chance_empty !== undefined) _expConfig.chance_empty = v.chance_empty;
      if (v.chance_treasure !== undefined) _expConfig.chance_treasure = v.chance_treasure;
      if (v.chance_monster !== undefined) _expConfig.chance_monster = v.chance_monster;
      if (v.sp_min !== undefined) _expConfig.sp_min = v.sp_min;
      if (v.sp_max !== undefined) _expConfig.sp_max = v.sp_max;
      if (v.treasure_acorn_min !== undefined) _expConfig.treasure_acorn_min = v.treasure_acorn_min;
      if (v.treasure_acorn_max !== undefined) _expConfig.treasure_acorn_max = v.treasure_acorn_max;
      if (v.reward_weights) _expConfig.reward_weights = v.reward_weights;
      if (v.boss_reward_weights) _expConfig.boss_reward_weights = v.boss_reward_weights;
      if (v.reward_C) _expConfig.reward_C = v.reward_C;
      if (v.reward_B) _expConfig.reward_B = v.reward_B;
      if (v.reward_A) _expConfig.reward_A = v.reward_A;
      if (v.monsters) _expConfig.monsters = v.monsters;
      if (v.bosses) _expConfig.bosses = v.bosses;
      if (v.lv_base_hp !== undefined) _expConfig.lv_base_hp = v.lv_base_hp;
      if (v.lv_base_atk !== undefined) _expConfig.lv_base_atk = v.lv_base_atk;
      if (v.lv_base_def !== undefined) _expConfig.lv_base_def = v.lv_base_def;
      if (v.lv_grow_hp !== undefined) _expConfig.lv_grow_hp = v.lv_grow_hp;
      if (v.lv_grow_atk !== undefined) _expConfig.lv_grow_atk = v.lv_grow_atk;
      if (v.lv_grow_def !== undefined) _expConfig.lv_grow_def = v.lv_grow_def;
      if (v.boss_stat_mult !== undefined) _expConfig.boss_stat_mult = v.boss_stat_mult;
      if (v.skill_multiplier !== undefined) _expConfig.skill_multiplier = v.skill_multiplier;
      if (v.skill_swing !== undefined) _expConfig.skill_swing = v.skill_swing;
      if (v.atk_swing !== undefined) _expConfig.atk_swing = v.atk_swing;
      if (v.mon_swing !== undefined) _expConfig.mon_swing = v.mon_swing;
      if (v.mon_def_effect !== undefined) _expConfig.mon_def_effect = v.mon_def_effect;
      if (v.sq_def_effect !== undefined) _expConfig.sq_def_effect = v.sq_def_effect;
      if (v.heal_percent !== undefined) _expConfig.heal_percent = v.heal_percent;
      if (v.escape_fail_pct !== undefined) _expConfig.escape_fail_pct = v.escape_fail_pct;
    }
  } catch(e) {}
}

// ── 관리자: 탐험 설정 UI 로드 ──
var _expProductsCache = []; // products 테이블 캐시

async function expAdminLoadUI() {
  var c = _expConfig;
  var el = function(id) { return document.getElementById(id); };
  if (el('expSet_chanceEmpty')) el('expSet_chanceEmpty').value = c.chance_empty;
  if (el('expSet_chanceTreasure')) el('expSet_chanceTreasure').value = c.chance_treasure;
  if (el('expSet_chanceMonster')) el('expSet_chanceMonster').value = c.chance_monster;
  if (el('expSet_spMin')) el('expSet_spMin').value = c.sp_min;
  if (el('expSet_spMax')) el('expSet_spMax').value = c.sp_max;
  if (el('expSet_treasureMin')) el('expSet_treasureMin').value = c.treasure_acorn_min;
  if (el('expSet_treasureMax')) el('expSet_treasureMax').value = c.treasure_acorn_max;
  if (el('expSet_weightC')) el('expSet_weightC').value = c.reward_weights.C;
  if (el('expSet_weightB')) el('expSet_weightB').value = c.reward_weights.B;
  if (el('expSet_weightA')) el('expSet_weightA').value = c.reward_weights.A;
  var bw = c.boss_reward_weights || { C: 30, B: 45, A: 25 };
  if (el('expSet_bossWeightC')) el('expSet_bossWeightC').value = bw.C;
  if (el('expSet_bossWeightB')) el('expSet_bossWeightB').value = bw.B;
  if (el('expSet_bossWeightA')) el('expSet_bossWeightA').value = bw.A;
  if (el('expSet_cAcornMin')) el('expSet_cAcornMin').value = c.reward_C.acorns[0];
  if (el('expSet_cAcornMax')) el('expSet_cAcornMax').value = c.reward_C.acorns[1];
  if (el('expSet_cItemChance')) el('expSet_cItemChance').value = Math.round(c.reward_C.itemChance * 100);
  if (el('expSet_bAcornMin')) el('expSet_bAcornMin').value = c.reward_B.acorns[0];
  if (el('expSet_bAcornMax')) el('expSet_bAcornMax').value = c.reward_B.acorns[1];
  if (el('expSet_bItemChance')) el('expSet_bItemChance').value = Math.round(c.reward_B.itemChance * 100);
  if (el('expSet_aAcornMin')) el('expSet_aAcornMin').value = c.reward_A.acorns[0];
  if (el('expSet_aAcornMax')) el('expSet_aAcornMax').value = c.reward_A.acorns[1];
  if (el('expSet_aItemChance')) el('expSet_aItemChance').value = Math.round(c.reward_A.itemChance * 100);
  // 전투 계수
  if (el('expSet_skillMulti')) el('expSet_skillMulti').value = c.skill_multiplier;
  if (el('expSet_skillSwing')) el('expSet_skillSwing').value = c.skill_swing;
  if (el('expSet_atkSwing')) el('expSet_atkSwing').value = c.atk_swing;
  if (el('expSet_monSwing')) el('expSet_monSwing').value = c.mon_swing;
  if (el('expSet_monDefEffect')) el('expSet_monDefEffect').value = c.mon_def_effect;
  if (el('expSet_sqDefEffect')) el('expSet_sqDefEffect').value = c.sq_def_effect;
  if (el('expSet_healPct')) el('expSet_healPct').value = c.heal_percent;
  if (el('expSet_escapeFail')) el('expSet_escapeFail').value = c.escape_fail_pct;

  // 레벨 스탯 설정
  if (el('expSet_lvBaseHp')) el('expSet_lvBaseHp').value = c.lv_base_hp;
  if (el('expSet_lvBaseAtk')) el('expSet_lvBaseAtk').value = c.lv_base_atk;
  if (el('expSet_lvBaseDef')) el('expSet_lvBaseDef').value = c.lv_base_def;
  if (el('expSet_lvGrowHp')) el('expSet_lvGrowHp').value = c.lv_grow_hp;
  if (el('expSet_lvGrowAtk')) el('expSet_lvGrowAtk').value = c.lv_grow_atk;
  if (el('expSet_lvGrowDef')) el('expSet_lvGrowDef').value = c.lv_grow_def;
  if (el('expSet_bossStatMult')) el('expSet_bossStatMult').value = c.boss_stat_mult;

  // 몬스터/보스 목록 렌더
  _expRenderMonsterList('expSet_monsterList', c.monsters, false);
  _expRenderMonsterList('expSet_bossList', c.bosses, true);

  // products 테이블에서 상품 목록 로드
  try {
    var res = await sb.from('products').select('id,name,icon,item_type,reward_type').order('sort_order');
    // 도토리류/티켓류 제외 (인벤토리 아이템만 보상으로 선택 가능)
    _expProductsCache = (res.data || []).filter(function(p) {
      var rt = p.reward_type || '';
      return rt !== 'AUTO_ACORN' && rt !== 'ACORN_TICKET' && rt !== 'GACHA_TICKET';
    });
  } catch(e) { _expProductsCache = []; }

  // 각 등급별 아이템 칩 렌더
  _expRenderItemChips('expSet_cItemsWrap', c.reward_C.items || []);
  _expRenderItemChips('expSet_bItemsWrap', c.reward_B.items || []);
  _expRenderItemChips('expSet_aItemsWrap', c.reward_A.items || []);
}

// ── 아이템 칩 렌더 ──
function _expRenderItemChips(wrapId, selectedItems) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return;

  // 이름 기준 중복 제거 (같은 이름의 상점/뽑기 상품은 하나로)
  var seen = {};
  var unique = [];
  _expProductsCache.forEach(function(p) {
    if (!seen[p.name]) {
      seen[p.name] = true;
      unique.push(p);
    }
  });

  if (unique.length === 0) {
    wrap.innerHTML = '<div style="font-size:12px;color:#9ca3af;padding:8px">등록된 상품이 없어요</div>';
    return;
  }

  // selectedItems는 {name,icon} 객체 배열 또는 "아이콘 이름" 문자열 배열 (하위 호환)
  var selectedNames = new Set(selectedItems.map(function(s) {
    if (typeof s === 'object' && s.name) return s.name;
    // 문자열 하위 호환: "🍄 버섯" → "버섯"
    return (s + '').replace(/^\S+\s*/, '').trim() || s;
  }));

  wrap.innerHTML = unique.map(function(p) {
    var isSelected = selectedNames.has(p.name);
    return '<div class="exp-item-chip' + (isSelected ? ' selected' : '') + '" ' +
      'data-wrap="' + wrapId + '" data-name="' + p.name + '" data-icon="' + (p.icon || '🎁') + '" ' +
      'onclick="_expToggleItemChip(this)">' +
      '<span class="exp-item-chip-icon">' + (p.icon || '🎁') + '</span>' +
      '<span class="exp-item-chip-name">' + p.name + '</span>' +
      '<span class="exp-item-chip-type">' + (p.item_type === 'gacha' ? '🎲' : '🛍️') + '</span>' +
    '</div>';
  }).join('');
}

function _expToggleItemChip(el) {
  el.classList.toggle('selected');
}

// ── 선택된 아이템 읽기 ──
function _expGetSelectedItems(wrapId) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return [];
  var chips = wrap.querySelectorAll('.exp-item-chip.selected');
  var items = [];
  chips.forEach(function(chip) {
    items.push({ name: chip.dataset.name, icon: chip.dataset.icon || '🎁' });
  });
  return items;
}

// ── 몬스터/보스 목록 렌더 ──
function _expRenderMonsterList(containerId, list, isBoss) {
  var wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (!list || list.length === 0) {
    wrap.innerHTML = '<div style="font-size:12px;color:#9ca3af;padding:8px;text-align:center">등록된 ' + (isBoss ? '보스' : '몬스터') + '가 없어요</div>';
    return;
  }
  wrap.innerHTML = list.map(function(m, i) {
    var preview = _expCalcStats(m.lvMin, isBoss);
    var previewMax = _expCalcStats(m.lvMax, isBoss);
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.04);border-radius:10px;margin-bottom:4px">' +
      '<span style="font-size:22px">' + m.emoji + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:900;color:var(--text-primary,#374151)">' + m.name + '</div>' +
        '<div style="font-size:10px;color:#9ca3af">Lv.' + m.lvMin + '~' + m.lvMax +
          ' | HP ' + preview.hp + '~' + previewMax.hp +
          ' 공 ' + preview.atk + '~' + previewMax.atk +
          ' 방 ' + preview.def + '~' + previewMax.def + '</div>' +
      '</div>' +
      '<button onclick="_expRemoveMonster(\'' + containerId + '\',' + i + ',' + isBoss + ')" style="width:24px;height:24px;border-radius:6px;border:none;background:#fee2e2;color:#dc2626;font-size:12px;cursor:pointer;font-family:inherit">✕</button>' +
    '</div>';
  }).join('');
}

function _expAddMonster(isBoss) {
  var prefix = isBoss ? 'expBoss' : 'expMon';
  var name = document.getElementById(prefix + 'Name')?.value?.trim();
  var emoji = document.getElementById(prefix + 'Emoji')?.value?.trim() || '👾';
  var lvMin = parseInt(document.getElementById(prefix + 'LvMin')?.value) || 1;
  var lvMax = parseInt(document.getElementById(prefix + 'LvMax')?.value) || 5;
  if (!name) { toast('⚠️', '이름을 입력해주세요'); return; }
  if (lvMin > lvMax) { toast('⚠️', '최소 레벨이 최대보다 높습니다'); return; }

  var listId = isBoss ? 'expSet_bossList' : 'expSet_monsterList';
  var configKey = isBoss ? 'bosses' : 'monsters';
  _expConfig[configKey].push({ name: name, emoji: emoji, lvMin: lvMin, lvMax: lvMax });
  _expRenderMonsterList(listId, _expConfig[configKey], isBoss);

  // 입력 초기화
  if (document.getElementById(prefix + 'Name')) document.getElementById(prefix + 'Name').value = '';
  if (document.getElementById(prefix + 'Emoji')) document.getElementById(prefix + 'Emoji').value = '';
}

function _expRemoveMonster(containerId, index, isBoss) {
  var configKey = isBoss ? 'bosses' : 'monsters';
  _expConfig[configKey].splice(index, 1);
  _expRenderMonsterList(containerId, _expConfig[configKey], isBoss);
}

// ── 관리자: 탐험 설정 저장 ──
async function expSaveSettings() {
  var el = function(id) { return document.getElementById(id); };

  var chE = parseInt(el('expSet_chanceEmpty')?.value) || 0;
  var chT = parseInt(el('expSet_chanceTreasure')?.value) || 0;
  var chM = parseInt(el('expSet_chanceMonster')?.value) || 0;
  if (chE + chT + chM !== 100) {
    toast('⚠️', '타일 확률의 합이 100이 아닙니다 (현재: ' + (chE + chT + chM) + ')');
    return;
  }

  var wC = parseInt(el('expSet_weightC')?.value) || 0;
  var wB = parseInt(el('expSet_weightB')?.value) || 0;
  var wA = parseInt(el('expSet_weightA')?.value) || 0;
  if (wC + wB + wA !== 100) {
    toast('⚠️', '카드 등급 확률의 합이 100이 아닙니다 (현재: ' + (wC + wB + wA) + ')');
    return;
  }

  var bwC = parseInt(el('expSet_bossWeightC')?.value) || 0;
  var bwB = parseInt(el('expSet_bossWeightB')?.value) || 0;
  var bwA = parseInt(el('expSet_bossWeightA')?.value) || 0;
  if (bwC + bwB + bwA !== 100) {
    toast('⚠️', '보스 카드 등급 확률의 합이 100이 아닙니다 (현재: ' + (bwC + bwB + bwA) + ')');
    return;
  }

  function parseItems(str) {
    return (str || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
  }

  var settings = {
    chance_empty: chE,
    chance_treasure: chT,
    chance_monster: chM,
    sp_min: parseInt(el('expSet_spMin')?.value) || 1,
    sp_max: parseInt(el('expSet_spMax')?.value) || 5,
    treasure_acorn_min: parseInt(el('expSet_treasureMin')?.value) || 0,
    treasure_acorn_max: parseInt(el('expSet_treasureMax')?.value) || 1,
    reward_weights: { C: wC, B: wB, A: wA },
    boss_reward_weights: { C: bwC, B: bwB, A: bwA },
    reward_C: {
      acorns: [parseInt(el('expSet_cAcornMin')?.value) || 0, parseInt(el('expSet_cAcornMax')?.value) || 0],
      itemChance: (parseInt(el('expSet_cItemChance')?.value) || 0) / 100,
      items: _expGetSelectedItems('expSet_cItemsWrap')
    },
    reward_B: {
      acorns: [parseInt(el('expSet_bAcornMin')?.value) || 0, parseInt(el('expSet_bAcornMax')?.value) || 0],
      itemChance: (parseInt(el('expSet_bItemChance')?.value) || 0) / 100,
      items: _expGetSelectedItems('expSet_bItemsWrap')
    },
    reward_A: {
      acorns: [parseInt(el('expSet_aAcornMin')?.value) || 0, parseInt(el('expSet_aAcornMax')?.value) || 0],
      itemChance: (parseInt(el('expSet_aItemChance')?.value) || 0) / 100,
      items: _expGetSelectedItems('expSet_aItemsWrap')
    },
    // 전투 계수
    skill_multiplier: parseFloat(el('expSet_skillMulti')?.value) || 1.65,
    skill_swing: parseInt(el('expSet_skillSwing')?.value) || 5,
    atk_swing: parseInt(el('expSet_atkSwing')?.value) || 3,
    mon_swing: parseInt(el('expSet_monSwing')?.value) || 3,
    mon_def_effect: parseInt(el('expSet_monDefEffect')?.value) || 38,
    sq_def_effect: parseInt(el('expSet_sqDefEffect')?.value) || 48,
    heal_percent: parseInt(el('expSet_healPct')?.value) || 40,
    escape_fail_pct: parseInt(el('expSet_escapeFail')?.value) || 30,
    // 레벨 스탯
    lv_base_hp: parseFloat(el('expSet_lvBaseHp')?.value) || 30,
    lv_base_atk: parseFloat(el('expSet_lvBaseAtk')?.value) || 8,
    lv_base_def: parseFloat(el('expSet_lvBaseDef')?.value) || 3,
    lv_grow_hp: parseFloat(el('expSet_lvGrowHp')?.value) || 12,
    lv_grow_atk: parseFloat(el('expSet_lvGrowAtk')?.value) || 2,
    lv_grow_def: parseFloat(el('expSet_lvGrowDef')?.value) || 1.5,
    boss_stat_mult: parseFloat(el('expSet_bossStatMult')?.value) || 1.4,
    // 몬스터/보스 (현재 _expConfig에서 읽기 — UI에서 추가/삭제 시 이미 반영됨)
    monsters: _expConfig.monsters,
    bosses: _expConfig.bosses
  };

  var res = await sb.from('app_settings')
    .upsert({ key: 'expedition_settings', value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (!res.error) {
    Object.assign(_expConfig, settings);
    toast('✅', '탐험 보상 설정이 저장되었어요');
  } else {
    toast('❌', '저장 실패: ' + (res.error.message || ''));
  }
}

// ── 탐험 런타임 상태 ──
var _expState = null; // { expId, expedition, party, tiles, currentTile, sp, spTotal, loot, ... }

// ================================================================
//  진입점
// ================================================================
async function sqContinueExpedition(expId) {
  try {
    // 설정 로드
    await expLoadSettings();

    // DB에서 탐험 데이터 로드
    const { data } = await sb.from('expeditions')
      .select('*').eq('id', expId).single();
    if (!data) { toast('❌', '탐험 데이터를 찾을 수 없어요'); return; }

    // 파티 다람쥐 로드
    const { data: squirrels } = await sb.from('squirrels')
      .select('*').in('id', data.squirrel_ids);
    if (!squirrels?.length) { toast('❌', '파티 다람쥐를 찾을 수 없어요'); return; }

    // SP 부여 (탐험당 1회)
    const spTotal = Math.floor(Math.random() * (_expConfig.sp_max - _expConfig.sp_min + 1)) + _expConfig.sp_min;

    // loot에서 _meta 추출 (tiles, sp 복원용)
    var savedLoot = data.loot || [];
    var meta = null;
    var cleanLoot = [];
    savedLoot.forEach(function(l) {
      if (l.type === '_meta') meta = l;
      else cleanLoot.push(l);
    });

    // 타일 복원 또는 새로 생성
    const tiles = (meta && meta.tiles) ? meta.tiles : _expGenerateTiles(data.total_steps);
    // SP 복원 또는 새로 부여
    const restoredSp = (meta && meta.sp !== undefined) ? meta.sp : spTotal;
    const restoredSpTotal = (meta && meta.spTotal !== undefined) ? meta.spTotal : spTotal;

    // 상태 초기화
    _expState = {
      expId: expId,
      expedition: data,
      party: squirrels.map(sq => {
        var hp = sq.stats?.hp || 80, atk = sq.stats?.atk || 12, def = sq.stats?.def || 6;
        var maxHp = (_sqSettings && _sqSettings.stat_hp_max) || 150;
        var maxAtk = (_sqSettings && _sqSettings.stat_atk_max) || 20;
        var maxDef = (_sqSettings && _sqSettings.stat_def_max) || 20;
        var score = ((hp/maxHp) + (atk/maxAtk) + (def/maxDef)) / 3 * 100;
        var grade = score >= 90 ? 'legend' : score >= 80 ? 'unique' : score >= 70 ? 'epic' : score >= 60 ? 'rare' : 'normal';
        return {
          id: sq.id, name: sq.name, sprite: sq.sprite || 'sq_acorn',
          hp: sq.hp_current, maxHp: hp, atk: atk, def: def, grade: grade
        };
      }),
      tiles: tiles,
      currentTile: data.current_step || 0,
      sp: restoredSp,
      spTotal: restoredSpTotal,
      loot: cleanLoot,
      battleOver: false
    };

    // 최초 생성 시 즉시 저장 (재접속 시 복원 가능하도록)
    if (!meta) {
      _expSaveProgress();
    }

    // UI 렌더
    _expRenderMap();

  } catch (e) {
    console.error(e);
    toast('❌', '탐험 진입 실패');
  }
}

// ================================================================
//  타일 생성
// ================================================================
function _expGenerateTiles(total) {
  var tiles = [];
  for (var i = 0; i < total; i++) {
    if (i === total - 1) {
      // 마지막 칸: 보스
      var bossTemplate = _expConfig.bosses[Math.floor(Math.random() * _expConfig.bosses.length)];
      tiles.push({ type: 'boss', monster: _expSpawnMonster(bossTemplate, true), cleared: false });
    } else {
      var roll = Math.random() * 100;
      if (roll < _expConfig.chance_empty) {
        tiles.push({ type: 'empty', cleared: false });
      } else if (roll < _expConfig.chance_empty + _expConfig.chance_treasure) {
        var acorns = Math.floor(Math.random() * (_expConfig.treasure_acorn_max - _expConfig.treasure_acorn_min + 1)) + _expConfig.treasure_acorn_min;
        tiles.push({ type: 'treasure', acorns: acorns, cleared: false });
      } else {
        var monTemplate = _expConfig.monsters[Math.floor(Math.random() * _expConfig.monsters.length)];
        tiles.push({ type: 'monster', monster: _expSpawnMonster(monTemplate, false), cleared: false });
      }
    }
  }
  return tiles;
}

// ================================================================
//  맵 UI 렌더링
// ================================================================
function _expRenderMap() {
  var s = _expState;
  var container = document.getElementById('sqcontent-expedition');
  if (!container) return;

  var totalAcorns = 0;
  s.loot.forEach(function(l) { totalAcorns += (l.acorns || 0); });

  // 타일 노드
  var tilesHTML = '';
  // 0칸 완료 시 출발 칸 추가
  if (s.currentTile === 0) {
    tilesHTML += '<div class="exp-node exp-node-start">' +
      '<div class="exp-node-circle"><span>🐿️</span></div>' +
      '<div class="exp-node-label">출발</div>' +
    '</div>';
    tilesHTML += '<div class="exp-conn exp-conn-arrow"><span>›</span><span>›</span><span>›</span></div>';
  }

  for (var i = 0; i < s.tiles.length; i++) {
    var tile = s.tiles[i];
    var isPast = (i < s.currentTile);
    var isLastCleared = (i === s.currentTile - 1); // 마지막 완료 칸

    var icon = '❓';
    var label = '';
    var nodeClass = 'exp-node';
    var isBoss = (tile.type === 'boss') || (i === s.tiles.length - 1);

    if (isPast || tile.cleared) {
      if (isLastCleared && s.currentTile < s.tiles.length) {
        nodeClass += ' exp-node-here'; // 현위치 강조
      } else {
        nodeClass += ' exp-node-past';
      }
      if (tile.type === 'empty') { icon = '🍃'; label = isLastCleared ? '현위치' : '평화'; }
      else if (tile.type === 'treasure') { icon = '💰'; label = isLastCleared ? '현위치' : '보물'; }
      else if (tile.type === 'monster') { icon = '⚔️'; label = isLastCleared ? '현위치' : '승리'; }
      else if (tile.type === 'boss') { icon = '👑'; label = '격파'; }
    } else {
      nodeClass += ' exp-node-future';
      icon = isBoss ? '💀' : '❓';
      label = isBoss ? '보스' : (i + 1) + '칸';
    }
    if (isBoss) nodeClass += ' exp-node-boss';

    tilesHTML += '<div class="' + nodeClass + '">' +
      '<div class="exp-node-circle"><span>' + icon + '</span></div>' +
      '<div class="exp-node-label">' + label + '</div>' +
    '</div>';

    if (i < s.tiles.length - 1) {
      var connClass = 'exp-conn';
      if (isLastCleared && s.currentTile < s.tiles.length) {
        // 마지막 완료 칸 → 다음 칸: 깜빡이는 화살표
        connClass = 'exp-conn exp-conn-arrow';
        tilesHTML += '<div class="' + connClass + '"><span>›</span><span>›</span><span>›</span></div>';
      } else if (isPast) {
        connClass += ' exp-conn-past';
        tilesHTML += '<div class="' + connClass + '"></div>';
      } else {
        connClass += ' exp-conn-future';
        tilesHTML += '<div class="' + connClass + '"></div>';
      }
    }
  }

  // 파티 상태
  var partyHTML = s.party.map(function(p) {
    var hpPct = Math.max(0, Math.round(p.hp / p.maxHp * 100));
    var isDead = p.hp <= 0;
    var hpColor = isDead ? '#ef4444' : hpPct <= 30 ? 'linear-gradient(90deg,#eab308,#ca8a04)' : 'linear-gradient(90deg,#22c55e,#16a34a)';
    var gs = _expGradeStyle(p.grade || 'normal');
    return '<div class="exp-pc' + (isDead ? ' exp-pc-dead' : '') + '">' +
      '<div class="exp-pc-emoji"><div style="border-radius:14px;' + gs.border + ';box-shadow:' + gs.shadow + ';padding:2px;display:inline-block;background:rgba(255,255,255,0.06)"><img src="images/squirrels/' + (isDead ? ((p.sprite || 'sq_acorn') + '_defeat') : (p.sprite || 'sq_acorn')) + '.png" style="width:56px;height:56px;object-fit:contain;border-radius:12px;display:block"></div></div>' +
      '<div class="exp-pc-name">' + p.name + '</div>' +
      '<div class="exp-pc-hpwrap"><div class="exp-pc-hpbar" style="width:' + hpPct + '%;background:' + hpColor + '"></div></div>' +
      '<div class="exp-pc-stats">' +
        '<span>❤️ ' + Math.max(0, p.hp) + '/' + p.maxHp + '</span>' +
        '<span>⚔️ ' + p.atk + '</span>' +
        '<span>🛡️ ' + p.def + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  container.innerHTML =
    '<div class="exp-container">' +
      // 헤더
      '<div class="exp-header">' +
        '<div class="exp-header-top">' +
          '<div class="exp-header-title">📜 탐험 진행 중</div>' +
          '<div class="exp-header-step">' + s.currentTile + ' / ' + s.tiles.length + ' 칸</div>' +
        '</div>' +
        '<div class="exp-badges">' +
          '<div class="exp-badge exp-badge-acorn">🌰 ' + totalAcorns + '</div>' +
          '<div class="exp-badge exp-badge-sp">✨ SP ' + s.sp + '/' + s.spTotal + '</div>' +
        '</div>' +
      '</div>' +
      // 타일 맵
      '<div class="exp-map-wrap">' +
        '<div class="exp-map-path">' + tilesHTML + '</div>' +
      '</div>' +
      // 파티
      '<div class="exp-party-grid">' + partyHTML + '</div>' +
      // 행동 버튼
      '<div class="exp-btns">' +
        '<button class="exp-btn-advance" id="expAdvanceBtn" onclick="_expAdvance()">▶️ 다음 칸으로 이동</button>' +
        '<button class="exp-btn-retreat" onclick="_expRetreat()">🏳️ 귀환하기</button>' +
      '</div>' +
    '</div>';
}

// ================================================================
//  다음 칸 이동
// ================================================================
function _expAdvance() {
  var s = _expState;
  if (!s || s.currentTile >= s.tiles.length) return;

  // 버튼 비활성화 (연출 중 중복 클릭 방지)
  var advBtn = document.getElementById('expAdvanceBtn');
  if (advBtn) advBtn.disabled = true;

  // 이동 사운드
  _btlSound('cardFlip');

  var tile = s.tiles[s.currentTile];

  if (tile.type === 'empty') {
    // 빈 칸: 짧은 딜레이 + 바람 사운드
    setTimeout(function() {
      _btlSound('wind');
      _expHandleEmpty();
    }, 600);
  } else if (tile.type === 'treasure') {
    // 보물: 딜레이 후 처리
    setTimeout(function() {
      _btlSound('treasure');
      _expHandleTreasure(tile);
    }, 600);
  } else if (tile.type === 'monster' || tile.type === 'boss') {
    // 전투: 딜레이 → BGM 정지 → 경고 효과음 → 화면 흔들림 → 팝업
    var isBoss = tile.type === 'boss';
    setTimeout(function() {
      _sndStopBGM(); // 탐험 BGM 정지
      _btlSound('battleStart'); // battle_start.mp3
      _expShakeScreen();
      setTimeout(function() {
        _expShowBattlePopup(tile, isBoss);
      }, isBoss ? 600 : 400);
    }, isBoss ? 1000 : 700);
  }
}

// ── 탐험 전용 토스트 (B형 하단 슬라이드) ──
function _expToast(emoji, text) {
  var container = document.getElementById('sqcontent-expedition');
  if (!container) { toast(emoji, text); return; }

  // 파티 그리드 위에 겹쳐서 표시
  var partyGrid = container.querySelector('.exp-party-grid');
  if (!partyGrid) { toast(emoji, text); return; }

  // 기존 토스트 제거
  var prev = container.querySelector('.exp-toast');
  if (prev) prev.remove();

  var el = document.createElement('div');
  el.className = 'exp-toast';
  el.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);border:1px solid rgba(184,158,120,.15);border-radius:12px;backdrop-filter:blur(6px);animation:expToastIn .3s ease;pointer-events:none';
  el.innerHTML = '<span style="font-size:16px;font-weight:800;color:#e8d5b5;letter-spacing:0.5px">' + emoji + '  ' + text + '</span>';

  // 파티 그리드를 relative로 만들고 토스트 삽입
  partyGrid.style.position = 'relative';
  partyGrid.appendChild(el);

  setTimeout(function() {
    el.style.animation = 'expToastOut .3s ease forwards';
    setTimeout(function() { el.remove(); }, 350);
  }, 2000);
}

// ── 탐험 전용 오버레이 모달 (C형) ──
function _expShowOverlay(emoji, title, body, btn1Text, btn1Fn, btn2Text, btn2Fn) {
  // 기존 오버레이 제거
  var prev = document.getElementById('expOverlay');
  if (prev) prev.remove();

  var overlay = document.createElement('div');
  overlay.id = 'expOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);animation:expFadeIn .25s ease';

  var btn1Style = 'flex:1;padding:12px;border-radius:12px;border:none;font-family:inherit;font-size:14px;font-weight:900;cursor:pointer;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3);box-shadow:0 3px 0 #b45309';
  var btn2Style = 'flex:1;padding:12px;border-radius:12px;border:1.5px solid rgba(255,255,255,.1);font-family:inherit;font-size:14px;font-weight:900;cursor:pointer;background:transparent;color:#a5b4fc';

  overlay.innerHTML =
    '<div style="background:rgba(15,15,25,.92);border:1.5px solid rgba(99,102,241,.2);border-radius:20px;padding:28px 24px;box-shadow:0 0 40px rgba(99,102,241,.1);max-width:340px;width:90%;animation:expScaleIn .4s ease;text-align:center">' +
      '<div style="font-size:36px;margin-bottom:8px">' + emoji + '</div>' +
      '<div style="font-size:18px;font-weight:900;color:#e0e7ff;margin-bottom:6px">' + title + '</div>' +
      '<div style="font-size:12px;color:#818cf8;line-height:1.7;margin-bottom:18px">' + body + '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button id="expOvBtn1" style="' + btn1Style + '">' + btn1Text + '</button>' +
        (btn2Text ? '<button id="expOvBtn2" style="' + btn2Style + '">' + btn2Text + '</button>' : '') +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  document.getElementById('expOvBtn1').onclick = function() {
    overlay.remove();
    if (btn1Fn) btn1Fn();
  };
  if (btn2Text) {
    document.getElementById('expOvBtn2').onclick = function() {
      overlay.remove();
      if (btn2Fn) btn2Fn();
    };
  }
}

// ── 화면 흔들림 ──
function _expShakeScreen() {
  var el = document.getElementById('sqcontent-expedition');
  if (!el) return;
  el.style.animation = 'expShake 0.4s ease-in-out';
  setTimeout(function() { el.style.animation = ''; }, 500);
}

// ── 전투 진입 팝업 ──
function _expShowBattlePopup(tile, isBoss) {
  var mon = tile.monster;

  var overlayBg = isBoss ? 'rgba(60,0,0,.92)' : 'rgba(15,15,35,.92)';
  var borderColor = isBoss ? '#ef4444' : '#6366f1';
  var titleColor = isBoss ? '#fef2f2' : '#e0e7ff';
  var subColor = isBoss ? '#fca5a5' : '#a5b4fc';
  var btnBg = isBoss ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'linear-gradient(135deg,#ef4444,#dc2626)';
  var btnColor = isBoss ? '#78350f' : 'white';
  var btnShadow = isBoss ? '0 4px 0 #b45309' : '0 4px 0 #991b1b';
  var topLabel = isBoss
    ? '<div style="font-size:11px;color:#fca5a5;letter-spacing:4px;margin-bottom:8px;font-weight:900">⚡ BOSS BATTLE ⚡</div>'
    : '<div style="font-size:11px;color:#a5b4fc;letter-spacing:3px;margin-bottom:8px;font-weight:900">⚔️ BATTLE ⚔️</div>';
  var pulseStyle = isBoss ? 'animation:expPulse 1.5s ease-in-out infinite;' : '';
  var glowStyle = isBoss ? 'box-shadow:0 0 40px rgba(239,68,68,.3),inset 0 0 60px rgba(239,68,68,.1);' : 'box-shadow:0 0 40px rgba(99,102,241,.2),inset 0 0 60px rgba(99,102,241,.08);';
  var borderCSS = isBoss ? 'border:2px solid rgba(239,68,68,.4);' : 'border:2px solid rgba(99,102,241,.3);';

  // 전용 오버레이 생성
  var overlay = document.createElement('div');
  overlay.id = 'expBattleOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);animation:expFadeIn .25s ease';

  overlay.innerHTML =
    '<div style="background:' + overlayBg + ';' + borderCSS + glowStyle + 'border-radius:24px;padding:36px 28px;text-align:center;max-width:340px;width:90%;animation:expScaleIn .4s ease">' +
      '<div style="font-size:56px;margin-bottom:8px;animation:expBounceIn .5s ease">' + mon.emoji + '</div>' +
      topLabel +
      '<div style="font-size:22px;font-weight:900;color:' + titleColor + ';text-shadow:0 0 12px ' + borderColor + '60">' + mon.name + '</div>' +
      '<div style="font-size:12px;color:' + subColor + ';margin-top:6px">Lv.' + mon.lv + (isBoss ? ' — 최종 전투!' : '') + '</div>' +
      '<button onclick="document.getElementById(\'expBattleOverlay\').remove();_expDoBattle()" style="margin-top:22px;padding:13px 48px;border-radius:14px;border:none;background:' + btnBg + ';color:' + btnColor + ';font-size:16px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:' + btnShadow + ';' + pulseStyle + '">⚔️ 전투 시작!</button>' +
    '</div>';

  document.body.appendChild(overlay);

  // 전투 데이터를 임시 저장
  window._expPendingBattle = { tile: tile, isBoss: isBoss };
}

// ── 팝업 확인 후 실제 전투 시작 ──
function _expDoBattle() {
  var pending = window._expPendingBattle;
  if (!pending) return;
  window._expPendingBattle = null;
  _expHandleBattle(pending.tile);
}

// ── 빈 칸 ──
function _expHandleEmpty() {
  var s = _expState;
  s.tiles[s.currentTile].cleared = true;
  s.currentTile++;
  _expSaveProgress();

  if (s.currentTile >= s.tiles.length) {
    _expShowSummary();
  } else {
    _expRenderMap();
    _expToast('🍃', '아무 일도 일어나지 않았다...');
  }
}

// ── 보물 칸 ──
function _expHandleTreasure(tile) {
  var s = _expState;
  s.loot.push({ type: 'treasure', acorns: tile.acorns });
  s.tiles[s.currentTile].cleared = true;
  s.currentTile++;
  _expSaveProgress();

  if (s.currentTile >= s.tiles.length) {
    _expShowSummary();
  } else {
    _expRenderMap();
    _expToast('💰', '작년에 묻어둔 도토리를 발견했어요! 🌰 ' + tile.acorns + '개 획득!');
  }
}

// ── 몬스터/보스 전투 ──
function _expHandleBattle(tile) {
  var s = _expState;
  var container = document.getElementById('sqcontent-expedition');
  if (!container) return;

  var isBoss = tile.type === 'boss';

  // 전투 배경음 전환
  _sndPlayBGM(isBoss ? 'boss' : 'battle');

  // 전투용 몬스터 데이터 (HP 복사본)
  var mon = {
    name: tile.monster.name, emoji: tile.monster.emoji, lv: tile.monster.lv,
    hp: tile.monster.hp, maxHp: tile.monster.hp,
    atk: tile.monster.atk, def: tile.monster.def
  };

  // 전투 UI 렌더
  _expRenderBattle(container, mon, isBoss);
}

// ================================================================
//  전투 시스템 (battle_v12 로직 인라인)
// ================================================================
var _btl = {}; // 전투 런타임 상태

function _expRenderBattle(container, mon, isBoss) {
  var s = _expState;

  _btl = {
    mon: mon,
    party: s.party,
    sp: s.sp,
    spTotal: s.spTotal,
    attacker: null,
    busy: false,
    battleOver: false,
    isBoss: isBoss,
    loot: { acorns: 0, items: [] }
  };

  // 배경 랜덤
  var bgList = ['forest', 'night', 'dungeon', 'dark'];
  var bgKey = bgList[Math.floor(Math.random() * bgList.length)];

  container.innerHTML =
    '<div class="btl-wrap" id="btlWrap">' +
      '<div class="btl-scene btl-bg-' + bgKey + '" id="btlScene">' +
        '<div class="btl-screen-flash" id="btlFlash"></div>' +
        '<div class="btl-mon-center" id="btlMonCenter">' +
          '<span class="btl-mon-emoji" id="btlMonEmoji">' + mon.emoji + '</span>' +
        '</div>' +
        '<div class="btl-mon-hp-overlay">' +
          '<div class="btl-mon-row">' +
            '<span class="btl-mon-nm">' + mon.name + (isBoss ? ' ⭐BOSS' : '') + '</span>' +
            '<span class="btl-mon-lv">Lv.' + mon.lv + '</span>' +
          '</div>' +
          '<div class="btl-m-hptrack"><div class="btl-m-hpbar" id="btlMHpBar" style="width:100%"></div></div>' +
          '<div class="btl-m-hptxt" id="btlMHpTxt">' + mon.hp + '/' + mon.maxHp + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="btl-ui">' +
        '<div class="btl-party-grid" id="btlPartyGrid"></div>' +
        '<div class="btl-log-panel" id="btlLogPanel"></div>' +
        '<div class="btl-btn-row">' +
          '<button class="btl-act-btn" id="btlBtnAtk"  onclick="_btlAction(\'attack\')"><span class="btl-btn-icon">⚔️</span>공격</button>' +
          '<button class="btl-act-btn" id="btlBtnSkill" onclick="_btlAction(\'skill\')"><span class="btl-btn-icon">✨</span><span id="btlSpLabel">스킬</span></button>' +
          '<button class="btl-act-btn" id="btlBtnItem"  onclick="_btlAction(\'item\')"><span class="btl-btn-icon">🌰</span>회복</button>' +
          '<button class="btl-act-btn" id="btlBtnEsc"   onclick="_btlAction(\'escape\')"><span class="btl-btn-icon">💨</span>도망</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  _btlBuildParty();
  _btlRender();
  _btlUpdateSpBtn();
  _btlLog('⚠️ <b>' + mon.name + '</b>' + (isBoss ? ' (보스)' : '') + '가 나타났다!', 'em');
  _btlLog('✨ 스킬 포인트: <b>' + _btl.sp + '회</b> 사용 가능', '');
}

function _btlBuildParty() {
  var grid = document.getElementById('btlPartyGrid');
  if (!grid) return;
  grid.innerHTML = _btl.party.map(function(p, i) {
    var gs = _expGradeStyle(p.grade || 'normal');
    return '<div class="btl-p-card" id="btlPc' + i + '">' +
      '<div class="btl-p-emoji"><div style="border-radius:14px;' + gs.border + ';box-shadow:' + gs.shadow + ';padding:2px;display:inline-block;background:rgba(255,255,255,0.06)"><img src="images/squirrels/' + (p.hp > 0 ? (p.sprite || 'sq_acorn') : ((p.sprite || 'sq_acorn') + '_defeat')) + '.png" style="width:56px;height:56px;object-fit:contain;border-radius:12px;display:block"></div></div>' +
      '<div class="btl-p-name">' + p.name + '</div>' +
      '<div class="btl-p-stat"><span>⚔️' + p.atk + '</span><span>🛡️' + p.def + '</span></div>' +
      '<div class="btl-p-hptrack"><div class="btl-p-hpbar" id="btlPhp' + i + '" style="width:100%"></div></div>' +
      '<div class="btl-p-hptxt" id="btlPhp' + i + 'txt">' + p.hp + '/' + p.maxHp + '</div>' +
    '</div>';
  }).join('');
}

function _btlHpColor(pct) {
  return pct <= 20 ? 'linear-gradient(90deg,#d42020,#f03838)'
       : pct <= 50 ? 'linear-gradient(90deg,#c88c10,#ecc028)'
                   : 'linear-gradient(90deg,#1ea81e,#4edf4e)';
}

function _btlRender() {
  var b = _btl;
  // 몬스터 HP
  var mpct = b.mon.hp / b.mon.maxHp * 100;
  var mb = document.getElementById('btlMHpBar');
  if (mb) { mb.style.width = mpct + '%'; mb.style.background = _btlHpColor(mpct); }
  var mt = document.getElementById('btlMHpTxt');
  if (mt) mt.textContent = b.mon.hp + '/' + b.mon.maxHp;

  // 파티
  b.party.forEach(function(p, i) {
    var pct = Math.max(0, p.hp / p.maxHp * 100);
    var bar = document.getElementById('btlPhp' + i);
    if (bar) { bar.style.width = pct + '%'; bar.style.background = _btlHpColor(pct); }
    var txt = document.getElementById('btlPhp' + i + 'txt');
    if (txt) txt.textContent = Math.max(0, p.hp) + '/' + p.maxHp;
    var card = document.getElementById('btlPc' + i);
    if (card) {
      card.classList.toggle('btl-active-turn', b.attacker !== null && b.party[i] === b.attacker && p.hp > 0);
      card.classList.toggle('btl-dead', p.hp <= 0);
    }
  });
}

function _btlLog(txt, cls) {
  var panel = document.getElementById('btlLogPanel');
  if (!panel) return;
  var d = document.createElement('div');
  d.className = 'btl-log-row' + (cls ? ' btl-log-' + cls : '');
  d.innerHTML = txt;
  panel.appendChild(d);
  panel.scrollTop = panel.scrollHeight;
}

function _btlLockBtns(lock) {
  ['btlBtnAtk', 'btlBtnSkill', 'btlBtnItem', 'btlBtnEsc'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = lock;
  });
  if (_btl.sp <= 0) {
    var sk = document.getElementById('btlBtnSkill');
    if (sk) sk.disabled = true;
  }
}

function _btlUpdateSpBtn() {
  var lbl = document.getElementById('btlSpLabel');
  if (lbl) lbl.textContent = '스킬 (' + _btl.sp + '/' + _btl.spTotal + ')';
  if (_btl.sp <= 0) {
    var sk = document.getElementById('btlBtnSkill');
    if (sk) { sk.disabled = true; sk.title = '스킬 포인트를 모두 사용했습니다'; }
  }
}

function _btlFlash(col) {
  var f = document.getElementById('btlFlash');
  if (!f) return;
  f.style.background = col;
  f.style.opacity = '.55';
  setTimeout(function() { f.style.opacity = '0'; }, 90);
}

function _btlPopNum(txt, targetId, col) {
  var wrap = document.getElementById('btlWrap');
  var el = document.getElementById(targetId);
  if (!wrap || !el) return;
  var wr = wrap.getBoundingClientRect();
  var er = el.getBoundingClientRect();
  var d = document.createElement('div');
  d.className = 'btl-pop';
  d.style.left = (er.left - wr.left + er.width / 2 - 18) + 'px';
  d.style.top = (er.top - wr.top + 12) + 'px';
  d.style.color = col;
  d.textContent = txt;
  wrap.appendChild(d);
  setTimeout(function() { d.remove(); }, 1000);
}

function _btlShakeMonster() {
  var mc = document.getElementById('btlMonCenter');
  if (!mc) return;
  mc.classList.add('btl-mon-shaking');
  var me = document.getElementById('btlMonEmoji');
  if (me) me.style.filter = 'brightness(3) saturate(.1)';
  setTimeout(function() {
    mc.classList.remove('btl-mon-shaking');
    if (me) me.style.filter = '';
  }, 350);
}

// ── 사운드 시스템 (mp3 파일 기반) ──
var _sndBGM = null; // 현재 재생 중인 배경음
var _sndLastSFX = null; // 마지막 재생 SFX (정리용)
var _sndVolSFX = 0.7;
var _sndVolBGM = 0.3;
var _sndUnlocked = false; // 모바일 오디오 잠금 해제 여부
var _sndPendingBGM = null; // 잠금 해제 전 대기 중인 BGM 타입

// 모바일 오디오 잠금 해제 (첫 터치 시)
function _sndUnlock() {
  if (_sndUnlocked) return;
  var silent = new Audio();
  silent.play().then(function() {
    silent.pause();
    _sndUnlocked = true;
    // 대기 중이던 BGM이 있으면 재생
    if (_sndPendingBGM) {
      _sndPlayBGM(_sndPendingBGM);
      _sndPendingBGM = null;
    }
  }).catch(function(){});
}
['touchstart','touchend','click'].forEach(function(evt) {
  document.addEventListener(evt, _sndUnlock, { once: false, passive: true });
});

// 효과음 재생 (1회)
function _btlSound(type) {
  try {
    var fileMap = {
      'attack':      ['sounds/punch_small_hit.mp3'],
      'bigHit':      ['sounds/punch_big_hit.mp3'],
      'hit':         ['sounds/punch_small_hit.mp3'],
      'skill':       ['sounds/skill_1.mp3', 'sounds/skill_2.mp3'],
      'heal':        ['sounds/heal.mp3'],
      'victory':     ['sounds/explorer_complete_victory.mp3'],
      'defeat':      ['sounds/explorer_complete_defeat.mp3'],
      'reward':      ['sounds/explorer_card_reward.mp3'],
      'cardFlip':    ['sounds/button_normal.mp3'],
      'button':      ['sounds/button_normal.mp3'],
      'buy':         ['sounds/squirrel_buy.mp3'],
      'battleStart':  ['sounds/battle_start.mp3'],
      'wind':        ['sounds/explorer_empty.wav'],
      'treasure':    ['sounds/explorer_card_reward.mp3'],
      'raidPick':    ['sounds/raid_card_reward_pick.mp3']
    };
    var files = fileMap[type];
    if (!files || files.length === 0) {
      // 파일 없는 것은 기존 Web Audio 폴백
      _btlSoundFallback(type);
      return;
    }
    var file = files[Math.floor(Math.random() * files.length)];
    var audio = new Audio(file);
    audio.volume = _sndVolSFX;
    _sndLastSFX = audio;
    audio.play().catch(function(){});
  } catch(e) {}
}

// 배경음 재생 (루프)
function _sndPlayBGM(type) {
  _sndStopBGM();
  var bgmMap = {
    'my':       ['sounds/menu_bgm_my_squirrels.mp3'],
    'shop':     ['sounds/menu_bgm_squirrel_shop.mp3'],
    'explorer': ['sounds/menu_bgm_explorer.mp3'],
    'fuse':     ['sounds/menu_bgm_fuse.mp3'],
    'farm':     ['sounds/farm_bgm.mp3'],
    'battle':   ['sounds/battle_monster_1.mp3','sounds/battle_monster_2.mp3','sounds/battle_monster_3.mp3','sounds/battle_monster_4.mp3'],
    'boss':     ['sounds/battle_boss_1.mp3','sounds/battle_boss_2.mp3','sounds/battle_boss_3.mp3'],
    'defeat':   ['sounds/explorer_complete_defeat.mp3'],
    'victory':  ['sounds/explorer_complete_victory.mp3'],
    'raid_victory': ['sounds/raid_victory.mp3']
  };
  var files = bgmMap[type];
  if (!files || files.length === 0) return;
  var file = files[Math.floor(Math.random() * files.length)];
  _sndBGM = new Audio(file);
  _sndBGM.volume = _sndVolBGM;
  _sndBGM.loop = true;
  _sndBGM.play().then(function() {
    _sndUnlocked = true;
    _sndPendingBGM = null;
  }).catch(function() {
    // 모바일: 아직 잠금 해제 안 됐으면 다음 터치 때 재생되도록 대기
    _sndPendingBGM = type;
  });
}

// 배경음 정지
function _sndStopBGM() {
  _sndPendingBGM = null;
  if (_sndBGM) {
    _sndBGM.pause();
    _sndBGM.currentTime = 0;
    _sndBGM = null;
  }
}

// Web Audio 폴백 (파일 없는 사운드용)
var _btlAC = null;
function _btlGetAC() {
  if (!_btlAC) _btlAC = new (window.AudioContext || window.webkitAudioContext)();
  if (_btlAC.state === 'suspended') _btlAC.resume();
  return _btlAC;
}
function _btlSoundFallback(type) {
  try {
    var ctx = _btlGetAC();
    var g = ctx.createGain(); g.connect(ctx.destination);
    if (type === 'wind') {
      var bufLen = ctx.sampleRate * 0.6;
      var buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 1.5) * 0.3;
      var noise = ctx.createBufferSource(); noise.buffer = buf;
      var flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 800;
      g.gain.setValueAtTime(.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .6);
      noise.connect(flt); flt.connect(g); noise.start(); noise.stop(ctx.currentTime + .65);
    }
  } catch(e) {}
}

// ================================================================
//  전투 행동 처리
// ================================================================
function _btlAction(type) {
  var b = _btl;
  if (b.busy || b.battleOver) return;

  if (type === 'escape') {
    // 현재 전리품 계산 (팝업에 표시)
    var s = _expState;
    var previewAcorns = 0;
    s.loot.forEach(function(l) { previewAcorns += (l.acorns || 0); });
    var halfPreview = Math.floor(previewAcorns / 2);

    _expShowOverlay(
      '💨',
      '정말 포기하시겠어요?',
      '도망에 성공해도 전리품의 50%만 가지고<br>돌아갈 수 있어요.' +
      (halfPreview > 0 ? '<br><span style="color:#fbbf24;font-weight:800">🌰 ' + halfPreview + '개 획득 예상</span>' : ''),
      '도망친다!', function() { _btlDoEscape(); },
      '포기한다', null
    );
    return;
  }
  if (type === 'skill' && b.sp <= 0) {
    _btlLog('⚠️ 스킬 포인트가 부족하다!', 'em');
    return;
  }

  // 랜덤 다람쥐 선택
  var alive = b.party.filter(function(p) { return p.hp > 0; });
  b.attacker = alive[Math.floor(Math.random() * alive.length)];
  var atkIdx = b.party.indexOf(b.attacker);

  b.busy = true;
  _btlLockBtns(true);
  _btlRender();

  var cardEl = document.getElementById('btlPc' + atkIdx);

  if (type === 'attack' || type === 'skill') {
    if (cardEl) { cardEl.classList.add('btl-attacking'); setTimeout(function() { cardEl.classList.remove('btl-attacking'); }, 400); }

    var dmg;
    if (type === 'skill') {
      b.sp--;
      _btlUpdateSpBtn();
      _expState.sp = b.sp; // 탐험 상태 동기화
      var swing = _expConfig.skill_swing || 5;
      dmg = Math.floor(b.attacker.atk * (_expConfig.skill_multiplier || 1.65) + (Math.random() * swing * 2 - swing));
      _btlSound('skill');
      _btlFlash('rgba(255,220,50,.5)');
      _btlLog('✨ <b>' + b.attacker.name + '</b>의 필살기! <b style="color:#f0c030">' + dmg + ' 데미지!</b>', 'skill');
    } else {
      var aSwing = _expConfig.atk_swing || 3;
      dmg = Math.max(1, b.attacker.atk - Math.floor(b.mon.def * ((_expConfig.mon_def_effect || 38) / 100)) + Math.round(Math.random() * aSwing * 2 - aSwing));
      // big hit: 데미지가 공격력의 90% 이상이면
      var isBigHit = dmg >= b.attacker.atk * 0.9;
      _btlSound(isBigHit ? 'bigHit' : 'attack');
      _btlFlash(isBigHit ? 'rgba(255,200,50,.45)' : 'rgba(255,255,255,.38)');
      _btlLog(isBigHit
        ? '💥 <b>' + b.attacker.name + '</b>의 강타! <b style="color:#fbbf24">' + dmg + ' 데미지!</b>'
        : '⚔️ <b>' + b.attacker.name + '</b>의 공격! <b style="color:#68c568">' + dmg + ' 데미지!</b>', 'atk');
    }

    setTimeout(function() {
      b.mon.hp = Math.max(0, b.mon.hp - dmg);
      _btlRender();
      _btlShakeMonster();
      _btlSound('hit');
      _btlPopNum('-' + dmg, 'btlMonCenter', '#ff3838');

      if (b.mon.hp <= 0) {
        var mc = document.getElementById('btlMonCenter');
        if (mc) mc.classList.add('btl-mon-dead');
        b.attacker = null;
        _btlRender();
        setTimeout(function() {
          _btlLog('🎉 <b>' + b.mon.name + ' 격파!</b>', 'win');
          _sndStopBGM(); // 전투 배경음 정지
          _btlSound('victory');
          b.battleOver = true;
          _btlLockBtns(true);
          _btlShowVictory();
        }, 300);
        return;
      }

      // 몬스터 반격
      setTimeout(function() {
        var aliveNow = b.party.filter(function(p) { return p.hp > 0; });
        var target = aliveNow[Math.floor(Math.random() * aliveNow.length)];
        var tIdx = b.party.indexOf(target);
        var mSwing = _expConfig.mon_swing || 3;
        var eDmg = Math.max(1, b.mon.atk - Math.floor(target.def * ((_expConfig.sq_def_effect || 48) / 100)) + Math.round(Math.random() * mSwing * 2 - mSwing));

        var tCard = document.getElementById('btlPc' + tIdx);
        if (tCard) { tCard.classList.add('btl-hit'); setTimeout(function() { tCard.classList.remove('btl-hit'); }, 350); }
        _btlSound('hit');
        _btlFlash('rgba(255,60,60,.28)');
        _btlPopNum('-' + eDmg, 'btlPc' + tIdx, '#ff5050');
        target.hp = Math.max(0, target.hp - eDmg);
        _btlLog('🐺 <b>' + b.mon.name + '</b>의 반격! <b>' + target.name + '</b>에게 <b style="color:#de5e4e">' + eDmg + ' 데미지!</b>', 'em');

        b.attacker = null;
        _btlRender();

        var allDead = b.party.every(function(p) { return p.hp <= 0; });
        if (allDead) {
          setTimeout(function() {
            _btlLog('💀 <b>전원 쓰러짐... 패배</b>', 'lose');
            _sndStopBGM(); _btlSound('defeat');
            b.battleOver = true;
            _btlLockBtns(true);
            _btlShowDefeat();
          }, 300);
          return;
        }

        b.busy = false;
        _btlLockBtns(false);
      }, 600);
    }, 200);

  } else if (type === 'item') {
    // 도토리 1개 소모
    if (!canAfford(1)) {
      _btlLog('⚠️ 도토리가 부족해서 회복할 수 없다!', 'em');
      b.busy = false;
      _btlLockBtns(false);
      b.attacker = null;
      return;
    }
    spendAcorns(1, '탐험 전투 중 회복');

    var target = b.party.filter(function(p) { return p.hp > 0; }).reduce(function(a, bb) { return bb.hp / bb.maxHp < a.hp / a.maxHp ? bb : a; });
    var tIdx = b.party.indexOf(target);
    var heal = Math.floor(target.maxHp * ((_expConfig.heal_percent || 40) / 100));
    target.hp = Math.min(target.maxHp, target.hp + heal);
    _btlRender();
    _btlSound('heal');
    _btlFlash('rgba(60,220,120,.28)');
    _btlPopNum('+' + heal, 'btlPc' + tIdx, '#38dd88');
    _btlLog('🌰 도토리 1개로 회복! <b>' + target.name + '</b> <b style="color:#48cc88">+' + heal + ' HP</b>', 'heal');

    setTimeout(function() {
      var aliveNow = b.party.filter(function(p) { return p.hp > 0; });
      var rTarget = aliveNow[Math.floor(Math.random() * aliveNow.length)];
      var rIdx = b.party.indexOf(rTarget);
      var mSwing2 = _expConfig.mon_swing || 3;
      var eDmg = Math.max(1, b.mon.atk - Math.floor(rTarget.def * ((_expConfig.sq_def_effect || 48) / 100)) + Math.round(Math.random() * mSwing2 * 2 - mSwing2));
      var tCard = document.getElementById('btlPc' + rIdx);
      if (tCard) { tCard.classList.add('btl-hit'); setTimeout(function() { tCard.classList.remove('btl-hit'); }, 350); }
      _btlSound('hit');
      _btlFlash('rgba(255,60,60,.22)');
      _btlPopNum('-' + eDmg, 'btlPc' + rIdx, '#ff5050');
      rTarget.hp = Math.max(0, rTarget.hp - eDmg);
      _btlLog('🐺 <b>' + b.mon.name + '</b>의 반격! <b>' + rTarget.name + '</b>에게 <b style="color:#de5e4e">' + eDmg + ' 데미지!</b>', 'em');

      b.attacker = null;
      _btlRender();

      var allDead = b.party.every(function(p) { return p.hp <= 0; });
      if (allDead) {
        setTimeout(function() {
          _btlLog('💀 <b>전원 쓰러짐... 패배</b>', 'lose');
          _sndStopBGM(); _btlSound('defeat');
          b.battleOver = true;
          _btlLockBtns(true);
          _btlShowDefeat();
        }, 300);
        return;
      }

      b.busy = false;
      _btlLockBtns(false);
    }, 700);
  }
}

// ================================================================
//  전투 결과: 승리
// ================================================================
// 보상 테이블은 _expConfig에서 읽음
function _btlGetRewardTable() {
  return {
    weights: _expConfig.reward_weights || { C: 65, B: 28, A: 7 },
    C: _expConfig.reward_C || { acorns: [5, 10], itemChance: 0.15, items: ['🍄 버섯', '🌿 풀잎', '🪨 돌멩이'] },
    B: _expConfig.reward_B || { acorns: [10, 20], itemChance: 0.45, items: ['🍎 사과', '🔮 마석', '🪵 나무'] },
    A: _expConfig.reward_A || { acorns: [20, 40], itemChance: 0.85, items: ['💎 보석', '⚗️ 비약', '🗡️ 단검'] }
  };
}

function _btlPickGrade() {
  var table = _btlGetRewardTable();
  // 보스전이면 보스 전용 확률 사용
  var w = (_btl.isBoss && _expConfig.boss_reward_weights) ? _expConfig.boss_reward_weights : table.weights;
  var r = Math.random() * 100;
  if (r < w.A) return 'A';
  if (r < w.A + w.B) return 'B';
  return 'C';
}

function _btlGenReward(grade) {
  var table = _btlGetRewardTable();
  var t = table[grade];
  var acorns = Math.floor(Math.random() * (t.acorns[1] - t.acorns[0] + 1)) + t.acorns[0];
  var item = null;
  if (t.items && t.items.length > 0 && Math.random() < t.itemChance) {
    var picked = t.items[Math.floor(Math.random() * t.items.length)];
    // 객체 또는 문자열 하위 호환
    if (typeof picked === 'object' && picked.name) {
      item = { name: picked.name, icon: picked.icon || '🎁' };
    } else {
      // 문자열 "🍄 버섯" → 분리
      var parts = (picked + '').match(/^(\S+)\s+(.+)$/);
      item = parts ? { name: parts[2], icon: parts[1] } : { name: picked, icon: '🎁' };
    }
  }
  return { grade: grade, acorns: acorns, item: item };
}

function _btlRewardText(r) {
  var itemLabel = r.item ? (r.item.icon + ' ' + r.item.name) : null;
  if (itemLabel && r.acorns > 0) return '🌰 ' + r.acorns + '개 + ' + itemLabel;
  if (itemLabel) return itemLabel;
  return '🌰 ' + r.acorns + '개';
}

function _btlShowVictory() {
  var wrap = document.getElementById('btlWrap');
  if (!wrap) return;

  var cards = [_btlGenReward(_btlPickGrade()), _btlGenReward(_btlPickGrade()), _btlGenReward(_btlPickGrade())];
  window._btlRwCards = cards;
  window._btlRwPicked = false;

  var ov = document.createElement('div');
  ov.className = 'btl-result-overlay btl-result-win';
  ov.id = 'btlResultOv';
  ov.innerHTML =
    '<div class="btl-win-emoji">🎉</div>' +
    '<div class="btl-win-title">전투 승리!</div>' +
    '<div class="btl-win-sub">' + _btl.mon.name + '을(를) 물리쳤다!</div>' +
    '<div class="btl-card-hint" id="btlCardHint">카드 1장을 선택하세요</div>' +
    '<div class="btl-card-row" id="btlCardRow">' +
      cards.map(function(c, i) {
        return '<div class="btl-reward-card" id="btlRcard' + i + '" onclick="_btlSelectCard(' + i + ')">' +
          '<div class="btl-card-back"><img src="images/baby-squirrel.png" class="btl-card-baby-bounce"></div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div id="btlContWrap" style="display:none"><button class="btl-continue-btn" onclick="_btlContinueAfterWin()">' +
      (_btl.isBoss ? '마을로 귀환' : '탐험 계속하기') +
    '</button></div>';

  wrap.appendChild(ov);
}

function _btlBuildFront(r, chosen) {
  var gradeClass = 'btl-grade-' + r.grade.toLowerCase();
  var frontClass = chosen ? 'btl-card-front-chosen' : 'btl-card-front-unchosen';
  return '<div class="btl-card-front ' + frontClass + ' ' + gradeClass + (chosen ? ' btl-chosen-front' : ' btl-unchosen-front') + '">' +
    '<div class="btl-card-grade">' + r.grade + '등급</div>' +
    '<div class="btl-card-reward-icon">' + (r.item ? r.item.icon : '🌰') + '</div>' +
    '<div class="btl-card-reward-txt">' + _btlRewardText(r) + '</div>' +
  '</div>';
}

function _btlSelectCard(idx) {
  if (window._btlRwPicked) return;
  window._btlRwPicked = true;
  var cards = window._btlRwCards;

  _btlSound('cardFlip');
  var el = document.getElementById('btlRcard' + idx);
  el.innerHTML = _btlBuildFront(cards[idx], true);
  el.className = 'btl-reward-card btl-card-disabled btl-card-chosen';

  var r = cards[idx];
  setTimeout(function() {
    if (r.grade === 'A') _btlSound('reward');
    else _btlSound('reward');
  }, 300);

  setTimeout(function() {
    for (var i = 0; i < 3; i++) {
      if (i === idx) continue;
      (function(j) {
        setTimeout(function() {
          _btlSound('cardFlip');
          var oel = document.getElementById('btlRcard' + j);
          oel.innerHTML = _btlBuildFront(cards[j], false);
          oel.className = 'btl-reward-card btl-card-disabled btl-card-unchosen';
        }, j < idx ? j * 150 : (j - 1) * 150);
      })(i);
    }
    setTimeout(function() {
      var cw = document.getElementById('btlContWrap');
      if (cw) cw.style.display = 'block';
    }, 400);
  }, 600);

  var hint = document.getElementById('btlCardHint');
  if (hint) {
    hint.textContent = r.grade + '등급 획득! ' + _btlRewardText(r);
    hint.style.color = r.grade === 'A' ? '#f0c040' : r.grade === 'B' ? '#60a8f0' : '#60c060';
  }
  _btl.loot.acorns += r.acorns;
  if (r.item) _btl.loot.items.push(r.item);
}

function _btlContinueAfterWin() {
  var s = _expState;
  // 전투 보상을 탐험 loot에 추가
  s.loot.push({ type: 'battle', acorns: _btl.loot.acorns, items: _btl.loot.items || [] });
  // 현재 타일 클리어
  s.tiles[s.currentTile].cleared = true;
  s.currentTile++;
  // SP 동기화
  s.sp = _btl.sp;
  _expSaveProgress();

  if (s.currentTile >= s.tiles.length) {
    _expShowSummary();
  } else {
    _expRenderMap();
  }
}

// ================================================================
//  전투 결과: 패배
// ================================================================
// ── 도망 실행 (팝업에서 확인 후 호출) ──
function _btlDoEscape() {
  var b = _btl;
  if (b.busy || b.battleOver) return;

  b.busy = true;
  _btlLockBtns(true);

  var failPct = _expConfig.escape_fail_pct || 30;
  var escaped = Math.random() * 100 >= failPct;

  if (escaped) {
    _btlSound('cardFlip');
    _btlLog('💨 도망에 성공했다! 마을로 귀환한다...', 'heal');
    b.battleOver = true;
    setTimeout(function() {
      var s = _expState;
      var totalAcorns = 0;
      var allItems = [];
      s.loot.forEach(function(l) {
        totalAcorns += (l.acorns || 0);
        if (l.items && l.items.length) {
          l.items.forEach(function(item) { allItems.push(item); });
        }
      });
      var halfAcorns = Math.floor(totalAcorns / 2);
      var keepCount = Math.floor(allItems.length / 2);
      var keptItems = [];
      if (keepCount > 0 && allItems.length > 0) {
        var shuffled = allItems.slice();
        for (var si = shuffled.length - 1; si > 0; si--) {
          var sj = Math.floor(Math.random() * (si + 1));
          var tmp = shuffled[si]; shuffled[si] = shuffled[sj]; shuffled[sj] = tmp;
        }
        keptItems = shuffled.slice(0, keepCount);
      }
      s.loot = [{ type: 'penalty', acorns: halfAcorns, items: keptItems }];
      _expShowSummary('retreated');
    }, 800);
  } else {
    _btlLog('💦 도망에 실패했다!', 'em');
    _btlSound('hit');

    setTimeout(function() {
      var alive = b.party.filter(function(p) { return p.hp > 0; });
      if (alive.length === 0) { b.busy = false; _btlLockBtns(false); return; }
      var rTarget = alive[Math.floor(Math.random() * alive.length)];
      var rIdx = b.party.indexOf(rTarget);
      var mSwing = _expConfig.mon_swing || 3;
      var eDmg = Math.max(1, b.mon.atk - Math.floor(rTarget.def * ((_expConfig.sq_def_effect || 48) / 100)) + Math.round(Math.random() * mSwing * 2 - mSwing));

      var tCard = document.getElementById('btlPc' + rIdx);
      if (tCard) { tCard.classList.add('btl-hit'); setTimeout(function() { tCard.classList.remove('btl-hit'); }, 350); }
      _btlFlash('rgba(255,60,60,.22)');
      _btlPopNum('-' + eDmg, 'btlPc' + rIdx, '#ff5050');
      rTarget.hp = Math.max(0, rTarget.hp - eDmg);
      _btlLog('🐺 <b>' + b.mon.name + '</b>의 반격! <b>' + rTarget.name + '</b>에게 <b style="color:#de5e4e">' + eDmg + ' 데미지!</b>', 'em');

      _btlRender();

      var allDead = b.party.every(function(p) { return p.hp <= 0; });
      if (allDead) {
        setTimeout(function() {
          _btlLog('💀 <b>전원 쓰러짐... 패배</b>', 'lose');
          _sndStopBGM(); _btlSound('defeat');
          b.battleOver = true;
          _btlLockBtns(true);
          _btlShowDefeat();
        }, 300);
        return;
      }

      b.busy = false;
      _btlLockBtns(false);
    }, 500);
  }
}

function _btlShowDefeat() {
  var wrap = document.getElementById('btlWrap');
  if (!wrap) return;
  var s = _expState;
  var totalAcorns = 0;
  s.loot.forEach(function(l) { totalAcorns += (l.acorns || 0); });
  var halfAcorns = Math.floor(totalAcorns / 2);

  var ov = document.createElement('div');
  ov.className = 'btl-result-overlay btl-result-lose';
  ov.id = 'btlResultOv';
  ov.innerHTML =
    '<div class="btl-lose-emoji">💀</div>' +
    '<div class="btl-lose-title">전투 패배...</div>' +
    '<div class="btl-lose-sub">다람쥐들이 모두 쓰러졌다</div>' +
    '<div class="btl-lose-options">' +
      '<button class="btl-lose-btn btl-btn-give-up" onclick="_btlDefeatRetreat()">' +
        '<span class="btl-lb-icon">🏳️</span><div><div class="btl-lb-main">포기하고 귀환</div><div class="btl-lb-sub">전리품 50%만 가지고 마을로 (🌰 ' + halfAcorns + '개)</div></div>' +
      '</button>' +
    '</div>';
  wrap.appendChild(ov);
}

function _btlDefeatRetreat() {
  var s = _expState;
  var totalAcorns = 0;
  var allItems = [];
  s.loot.forEach(function(l) {
    totalAcorns += (l.acorns || 0);
    if (l.items && l.items.length) {
      l.items.forEach(function(item) { allItems.push(item); });
    }
  });
  var halfAcorns = Math.floor(totalAcorns / 2);
  // 아이템 50% 버림 (소수점 버림: 1개→0개, 2개→1개, 3개→1개)
  var keepCount = Math.floor(allItems.length / 2);
  // 랜덤으로 keepCount개만 남기기
  var keptItems = [];
  if (keepCount > 0 && allItems.length > 0) {
    var shuffled = allItems.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    keptItems = shuffled.slice(0, keepCount);
  }
  s.loot = [{ type: 'penalty', acorns: halfAcorns, items: keptItems }];
  _expShowSummary('retreated');
}

// ================================================================
//  탐험 완료 요약 화면
// ================================================================
function _expShowSummary(finishStatus) {
  var status = finishStatus || 'completed';
  var isDefeat = (status === 'retreated');
  var s = _expState;
  if (!s) { _expFinish(status); return; }

  // 전투 BGM 정지 (패배/승리 효과음은 전투 종료 시점에서 이미 재생됨)
  _sndStopBGM();

  var container = document.getElementById('sqcontent-expedition');
  if (!container) { _expFinish(status); return; }

  // 전리품 집계
  var totalAcorns = 0;
  var battleCount = 0;
  var treasureCount = 0;
  var emptyCount = 0;
  var allItems = [];
  s.loot.forEach(function(l) {
    totalAcorns += (l.acorns || 0);
    if (l.type === 'battle') battleCount++;
    else if (l.type === 'treasure') treasureCount++;
    if (l.items && l.items.length) {
      l.items.forEach(function(item) { allItems.push(item); });
    }
  });
  s.tiles.forEach(function(t) {
    if (t.type === 'empty' && t.cleared) emptyCount++;
  });

  // 아이템 목록 HTML
  var itemsHTML = '';
  if (allItems.length > 0) {
    itemsHTML = '<div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px">' +
      '<div style="font-size:11px;font-weight:800;color:#86efac;margin-bottom:8px;text-align:center">🎁 획득 아이템</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">' +
      allItems.map(function(item) {
        var label = (typeof item === 'object' && item.name) ? (item.icon + ' ' + item.name) : item;
        return '<div style="background:rgba(255,255,255,0.08);padding:4px 10px;border-radius:10px;font-size:12px;font-weight:700;color:#e5e7eb">' + label + '</div>';
      }).join('') +
      '</div></div>';
  }

  // 파티 상태 요약
  var partyHTML = s.party.map(function(p) {
    var hpPct = Math.max(0, Math.round(p.hp / p.maxHp * 100));
    var hpColor = hpPct <= 0 ? '#ef4444' : hpPct <= 50 ? '#eab308' : '#22c55e';
    var statusText = p.hp <= 0 ? '쓰러짐' : 'HP ' + p.hp + '/' + p.maxHp;
    var gs = _expGradeStyle(p.grade || 'normal');
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(139,111,71,0.1);border-radius:14px;border:1px solid rgba(139,111,71,0.15)">' +
      '<div style="border-radius:12px;' + gs.border + ';box-shadow:' + gs.shadow + ';padding:2px;display:inline-block;background:rgba(255,255,255,0.5)"><img src="images/squirrels/' + (p.hp <= 0 ? ((p.sprite || 'sq_acorn') + '_defeat') : (p.sprite || 'sq_acorn')) + '.png" style="width:36px;height:36px;object-fit:contain;border-radius:8px;display:block"></div>' +
      '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:900;color:#5c4a32">' + p.name + '</div>' +
        '<div style="height:5px;background:rgba(0,0,0,0.1);border-radius:3px;margin-top:4px;overflow:hidden">' +
          '<div style="height:100%;width:' + hpPct + '%;background:' + hpColor + ';border-radius:3px"></div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:800;color:' + hpColor + '">' + statusText + '</div>' +
    '</div>';
  }).join('');

  // 타일 경로 미니맵
  var miniTilesHTML = s.tiles.map(function(t) {
    var icon = t.type === 'empty' ? '🍃' : t.type === 'treasure' ? '💰' : t.type === 'monster' ? '⚔️' : '👑';
    var tileBg = t.type === 'boss' ? 'rgba(168,85,247,.12)' : t.cleared === false ? 'rgba(239,68,68,.15)' : 'rgba(100,180,100,.12)';
    var tileBorder = t.type === 'boss' ? 'rgba(168,85,247,.25)' : t.cleared === false ? 'rgba(239,68,68,.25)' : 'rgba(100,180,100,.2)';
    return '<div style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;background:' + tileBg + ';border:1px solid ' + tileBorder + '">' + icon + '</div>';
  }).join('<div style="width:6px;height:1px;background:rgba(100,180,100,.2);flex-shrink:0"></div>');

  // 파티 가로 카드 HTML
  var partyCardsHTML = s.party.map(function(p) {
    var hpPct = Math.max(0, Math.round(p.hp / p.maxHp * 100));
    var hpColor = hpPct <= 0 ? '#ef4444' : hpPct <= 50 ? '#eab308' : '#22c55e';
    var statusText = p.hp <= 0 ? '쓰러짐' : 'HP ' + p.hp + '/' + p.maxHp;
    var gs = _expGradeStyle(p.grade || 'normal');
    return '<div style="flex:1;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(255,255,255,.06);padding:10px 8px;text-align:center">' +
      '<div style="border-radius:10px;' + gs.border + ';box-shadow:' + gs.shadow + ';padding:2px;display:inline-block;background:rgba(255,255,255,.05)"><img src="images/squirrels/' + (p.hp <= 0 ? ((p.sprite || 'sq_acorn') + '_defeat') : (p.sprite || 'sq_acorn')) + '.png" style="width:36px;height:36px;object-fit:contain;border-radius:7px;display:block"></div>' +
      '<div style="font-size:11px;font-weight:900;color:#e8d5b5;margin-top:4px">' + p.name + '</div>' +
      '<div style="height:3px;background:rgba(255,255,255,.08);border-radius:2px;margin:4px 4px 2px"><div style="height:100%;width:' + hpPct + '%;background:' + hpColor + ';border-radius:2px"></div></div>' +
      '<div style="font-size:9px;color:' + hpColor + ';font-weight:700">' + statusText + '</div>' +
    '</div>';
  }).join('');

  // 뱃지 HTML
  var badgesHTML = '';
  if (battleCount > 0) badgesHTML += '<div style="background:rgba(239,68,68,.12);padding:3px 8px;border-radius:6px;font-size:9px;font-weight:800;color:#fca5a5">⚔️' + battleCount + '</div>';
  if (treasureCount > 0) badgesHTML += '<div style="background:rgba(251,191,36,.12);padding:3px 8px;border-radius:6px;font-size:9px;font-weight:800;color:#fde68a">💰' + treasureCount + '</div>';
  if (emptyCount > 0) badgesHTML += '<div style="background:rgba(148,163,184,.12);padding:3px 8px;border-radius:6px;font-size:9px;font-weight:800;color:#cbd5e1">🍃' + emptyCount + '</div>';

  container.innerHTML =
    '<div style="max-width:420px;margin:0 auto">' +
      '<div style="background:linear-gradient(160deg,#2e2318,#231a11);border-radius:20px;padding:20px 16px;border:1.5px solid #5c4a34;box-shadow:inset 0 0 40px rgba(0,0,0,.3),0 4px 20px rgba(0,0,0,.4);position:relative;overflow:hidden">' +
        '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent 5%,#c9a44a 30%,#e8c87a 50%,#c9a44a 70%,transparent 95%)"></div>' +
        // 헤더: 아이콘 + 결과 + 도토리
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding-top:4px">' +
          '<div style="font-size:44px">' + (isDefeat ? '💀' : '🎉') + '</div>' +
          '<div style="flex:1">' +
            '<div style="font-size:20px;font-weight:900;color:' + (isDefeat ? '#ef4444' : '#fbbf24') + '">' + (isDefeat ? '탐험 실패...' : '탐험 완료!') + '</div>' +
            '<div style="font-size:11px;color:#8a7a60">' + (isDefeat ? '전리품 50%만 획득' : '모든 구간 돌파!') + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:28px;font-weight:900;color:#fbbf24">🌰 ' + totalAcorns + '</div>' +
            '<div style="font-size:10px;color:#b89e78">도토리 획득</div>' +
          '</div>' +
        '</div>' +
        // 타일 + 뱃지
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:0">' + miniTilesHTML + '</div>' +
          '<div style="display:flex;gap:4px">' + badgesHTML + '</div>' +
        '</div>' +
        // 아이템
        (allItems.length > 0 ?
          '<div style="border-top:1px solid rgba(184,158,120,.12);padding:10px 0;margin-bottom:10px">' +
            '<div style="font-size:10px;font-weight:800;color:#86efac;margin-bottom:6px">🎁 획득 아이템</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
            allItems.map(function(item) {
              var label = (typeof item === 'object' && item.name) ? (item.icon + ' ' + item.name) : item;
              return '<div style="background:rgba(255,255,255,.06);padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#e5e7eb">' + label + '</div>';
            }).join('') +
            '</div></div>' : '') +
        // 구분선
        '<div style="border-top:1px solid rgba(184,158,120,.12);margin-bottom:14px"></div>' +
        // 파티: 가로 카드
        '<div style="font-size:11px;font-weight:900;color:#b89e78;margin-bottom:8px;letter-spacing:1px">🐿️ 파티</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:16px">' + partyCardsHTML + '</div>' +
        // 귀환 버튼
        '<button onclick="_expFinish(\'' + status + '\')" style="width:100%;padding:13px;border-radius:12px;border:none;font-family:inherit;font-size:15px;font-weight:900;cursor:pointer;background:linear-gradient(135deg,' + (isDefeat ? '#ef4444,#dc2626' : '#22c55e,#16a34a') + ');color:white;box-shadow:0 3px 0 ' + (isDefeat ? '#991b1b' : '#15803d') + ',0 4px 16px ' + (isDefeat ? 'rgba(239,68,68,.25)' : 'rgba(34,197,94,.25)') + '">🏠 마을로 귀환하기</button>' +
        '<div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent 5%,#c9a44a 30%,#e8c87a 50%,#c9a44a 70%,transparent 95%)"></div>' +
      '</div>' +
    '</div>';
}

// ================================================================
//  탐험 완료 / 귀환
// ================================================================
function _expComplete() {
  _expFinish('completed');
}

function _expRetreat() {
  var s = _expState;
  if (!s) return;

  var totalAcorns = 0;
  var allItems = [];
  s.loot.forEach(function(l) {
    totalAcorns += (l.acorns || 0);
    if (l.items && l.items.length) {
      l.items.forEach(function(item) { allItems.push(item); });
    }
  });
  var halfAcorns = Math.floor(totalAcorns / 2);
  var keepCount = Math.floor(allItems.length / 2);
  var keptItems = [];
  if (keepCount > 0 && allItems.length > 0) {
    var shuffled = allItems.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    keptItems = shuffled.slice(0, keepCount);
  }

  _expShowOverlay(
    '🏳️',
    '정말 귀환하시겠어요?',
    '지금 돌아가면 전리품의 50%만 가져갈 수 있어요.<br><span style="color:#fbbf24;font-weight:800">🌰 ' + halfAcorns + '개 획득 예상</span>',
    '귀환한다', function() {
      s.loot = [{ type: 'penalty', acorns: halfAcorns, items: keptItems }];
      _expShowSummary('retreated');
    },
    '계속 탐험', null
  );
}

async function _expFinish(status) {
  var s = _expState;
  if (!s) return;

  // 배경음 정지 + 잔여 SFX 정지
  _sndStopBGM();
  if (_sndLastSFX) {
    try { _sndLastSFX.pause(); _sndLastSFX.currentTime = 0; } catch(e) {}
    _sndLastSFX = null;
  }

  var totalAcorns = 0;
  s.loot.forEach(function(l) { totalAcorns += (l.acorns || 0); });

  try {
    // loot에서 _meta 제거 후 최종 저장
    var finalLoot = s.loot.filter(function(l) { return l.type !== '_meta'; });
    var updateData = {
      status: status,
      current_step: s.currentTile,
      loot: finalLoot
    };
    await sb.from('expeditions').update(updateData).eq('id', s.expId);

    // 다람쥐 상태 복원 + HP 업데이트
    // HP가 풀이 아니면 recovering 상태로 전환 (시간 경과 후 자동 회복)
    var baseMinutes = (_sqSettings && _sqSettings.recovery_base_minutes) || 60;
    var recoveryBoost = (typeof getRecoveryBoostPct === 'function') ? getRecoveryBoostPct() : 0;
    for (var i = 0; i < s.party.length; i++) {
      var p = s.party[i];
      var maxHp = p.maxHp || 100;
      var currentHp = Math.max(0, p.hp);

      if (currentHp >= maxHp) {
        // HP 풀 → 바로 explorer 복귀
        await sb.from('squirrels').update({
          status: 'explorer', hp_current: maxHp, recovers_at: null
        }).eq('id', p.id);
        _sqUpdate(p.id, { status: 'explorer', hp_current: maxHp, recovers_at: null });
      } else {
        // HP 부족 → recovering 상태 + recovers_at 설정
        var lostPct = 1 - (currentHp / maxHp); // 0~1 (0%~100% 손실)
        var recoveryMinutes = Math.max(1, Math.round(baseMinutes * lostPct));
        // 회복속도 부스트 이벤트 적용
        if (recoveryBoost > 0) recoveryMinutes = Math.max(1, Math.round(recoveryMinutes * (1 - recoveryBoost / 100)));
        var recoversAt = new Date(Date.now() + recoveryMinutes * 60000).toISOString();
        try {
          await sb.from('squirrels').update({
            status: 'recovering', hp_current: currentHp, recovers_at: recoversAt
          }).eq('id', p.id);
        } catch(e) {
          // recovers_at 컬럼이 없으면 없이 시도
          await sb.from('squirrels').update({
            status: 'recovering', hp_current: currentHp
          }).eq('id', p.id);
        }
        _sqUpdate(p.id, { status: 'recovering', hp_current: currentHp, recovers_at: recoversAt });
      }
    }

    // 도토리 지급
    if (totalAcorns > 0) {
      await sb.rpc('adjust_acorns', {
        p_user_id: myProfile.id,
        p_amount: totalAcorns,
        p_reason: '탐험 보상 (' + status + ')'
      });
      myProfile.acorns = (myProfile.acorns || 0) + totalAcorns;
      if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    }

    // 아이템 인벤토리 지급
    var allItems = [];
    s.loot.forEach(function(l) {
      if (l.items && l.items.length) {
        l.items.forEach(function(item) { allItems.push(item); });
      }
    });
    if (allItems.length > 0) {
      // 아이템에서 이름 추출 (객체 또는 문자열 하위 호환)
      var itemNames = allItems.map(function(item) {
        if (typeof item === 'object' && item.name) return item.name;
        return (item + '').replace(/^\S+\s*/, '').trim() || item;
      });
      // 이름별 개수 집계 (스택형 아이템 대응)
      var nameCount = {};
      itemNames.forEach(function(n) { nameCount[n] = (nameCount[n] || 0) + 1; });
      try {
        // grantItem 헬퍼 사용 (스택형 자동 처리)
        if (typeof grantItem === 'function') {
          for (var gName in nameCount) {
            await grantItem(myProfile.id, gName, nameCount[gName]);
          }
        } else {
          // fallback: 기존 방식
          var uniqueNames = Object.keys(nameCount);
          var prodRes = await sb.from('products').select('id,name,icon,item_type,reward_type').in('name', uniqueNames);
          var prodMap = {};
          (prodRes.data || []).forEach(function(p) {
            if (!prodMap[p.name]) prodMap[p.name] = p;
          });
          var insertRows = [];
          itemNames.forEach(function(name) {
            var prod = prodMap[name];
            if (prod) {
              insertRows.push({
                user_id: myProfile.id,
                product_id: prod.id,
                product_snapshot: prod,
                from_gacha: false,
                status: 'held'
              });
            }
          });
          if (insertRows.length > 0) {
            await sb.from('inventory').insert(insertRows);
          }
        }
      } catch(e) {
        console.error('아이템 지급 오류:', e);
      }
    }

    var msg = status === 'completed'
      ? '🎉 탐험 완료! 🌰 ' + totalAcorns + '개 획득!'
      : '🏳️ 귀환 완료. 🌰 ' + totalAcorns + '개 획득.';
    toast(status === 'completed' ? '🎉' : '🏳️', msg);

  } catch (e) {
    console.error('_expFinish error:', e);
    toast('❌', '탐험 종료 처리 중 오류가 발생했지만 귀환합니다.');
  }

  // 항상 복귀 (에러가 나도)
  _expState = null;

  // expedition 탭 HTML을 원래 상태로 복원 (도움말 포함)
  var container = document.getElementById('sqcontent-expedition');
  if (container) {
    container.innerHTML =
      '<div class="clay-card p-5 text-center mb-4">' +
        '<div style="font-size:48px" class="mb-2">🗺️</div>' +
        '<div class="title-font text-lg text-gray-700 mb-1">탐험 준비</div>' +
        '<div class="text-sm text-gray-400 mb-4">탐험형 다람쥐를 보유해야 출발할 수 있어요</div>' +
        '<button class="btn btn-primary" onclick="sqStartExpeditionFlow()">탐험 출발 →</button>' +
      '</div>' +
      '<div id="sqActiveExpeditionArea"></div>' +
      '<div class="clay-card p-4 mt-4">' +
        '<div class="title-font text-sm text-gray-600 mb-3">💡 탐험 가이드</div>' +
        '<div class="sq-help-grid">' +
          '<div class="sq-help-card"><div style="font-size:24px;margin-bottom:4px">✨</div><div class="sq-help-card-title">SP 전략</div><div class="sq-help-card-desc">스킬 포인트(SP)는 탐험마다 랜덤 횟수가 부여돼요. 보스전을 위해 아껴두세요!</div></div>' +
          '<div class="sq-help-card"><div style="font-size:24px;margin-bottom:4px">💨</div><div class="sq-help-card-title">도망치기</div><div class="sq-help-card-desc">위험하면 도망! 단, 전리품의 50%만 가져가요</div></div>' +
          '<div class="sq-help-card"><div style="font-size:24px;margin-bottom:4px">🌰</div><div class="sq-help-card-title">포션 사용</div><div class="sq-help-card-desc">전투 중 도토리 1개로 HP를 회복할 수 있어요</div></div>' +
          '<div class="sq-help-card"><div style="font-size:24px;margin-bottom:4px">🎁</div><div class="sq-help-card-title">보상 획득</div><div class="sq-help-card-desc">전투 승리 시 카드 뽑기! 등급(C/B/A)에 따라 보상이 달라요</div></div>' +
        '</div>' +
      '</div>';
  }

  await sqLoadSquirrels();
  await sqLoadActiveExpedition();
  sqTab('my');
}

// ── DB 진행 저장 ──
async function _expSaveProgress() {
  var s = _expState;
  if (!s) return;
  try {
    // tiles와 sp를 loot 배열의 _meta 객체로 함께 저장 (별도 컬럼 불필요)
    var lootWithMeta = s.loot.filter(function(l) { return l.type !== '_meta'; });
    lootWithMeta.push({ type: '_meta', tiles: s.tiles, sp: s.sp, spTotal: s.spTotal });
    await sb.from('expeditions').update({
      current_step: s.currentTile,
      loot: lootWithMeta
    }).eq('id', s.expId);
  } catch (e) {}
}
