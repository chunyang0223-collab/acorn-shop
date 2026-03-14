/* ================================================================
   🗺️ 탐험 시스템 (expedition.js)
   ================================================================
   탐험 맵 UI + 전투 시스템 통합
   - sqContinueExpedition(expId) 호출로 진입
   - 타일 노드 이동 → 이벤트 분기 (빈칸/보물/몬스터/보스)
   - 전투 씬 인라인 렌더
   - 완료/귀환 시 DB 업데이트 + 탭 복귀
   ================================================================ */

// ── 탐험 설정 (관리자 설정과 연동 예정) ──
var _expConfig = {
  // 타일 이벤트 확률 (%)  — 합산 100
  chance_empty: 25,
  chance_treasure: 30,
  chance_monster: 45,
  // SP (스킬 포인트) 범위
  sp_min: 1,
  sp_max: 5,
  // 보물 보상 범위
  treasure_acorn_min: 3,
  treasure_acorn_max: 12,
  // 몬스터 테이블
  monsters: [
    { name: '숲의 늑대', emoji: '🐺', lv: 6, hp: 80, atk: 16, def: 7 },
    { name: '야생 멧돼지', emoji: '🐗', lv: 7, hp: 100, atk: 18, def: 9 },
    { name: '독 거미', emoji: '🕷️', lv: 5, hp: 60, atk: 20, def: 5 },
    { name: '그림자 박쥐', emoji: '🦇', lv: 5, hp: 55, atk: 17, def: 4 },
  ],
  // 보스 테이블
  bosses: [
    { name: '숲의 수호자', emoji: '🐻', lv: 10, hp: 180, atk: 24, def: 12 },
    { name: '고대 뱀', emoji: '🐍', lv: 11, hp: 200, atk: 26, def: 10 },
  ]
};

// ── 탐험 런타임 상태 ──
var _expState = null; // { expId, expedition, party, tiles, currentTile, sp, spTotal, loot, ... }

// ================================================================
//  진입점
// ================================================================
async function sqContinueExpedition(expId) {
  try {
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

    // 타일 생성 (아직 안 만들어졌으면)
    const tiles = data.tiles || _expGenerateTiles(data.total_steps);

    // 상태 초기화
    _expState = {
      expId: expId,
      expedition: data,
      party: squirrels.map(sq => ({
        id: sq.id, name: sq.name,
        hp: sq.hp_current, maxHp: sq.stats?.hp || 80,
        atk: sq.stats?.atk || 12, def: sq.stats?.def || 6
      })),
      tiles: tiles,
      currentTile: data.current_step || 0,
      sp: spTotal,
      spTotal: spTotal,
      loot: data.loot || [],
      battleOver: false
    };

    // 타일 데이터 DB 저장 (최초 생성 시, 컬럼 없으면 무시)
    if (!data.tiles) {
      try { await sb.from('expeditions').update({ tiles: tiles }).eq('id', expId); } catch(e) {}
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
      var boss = _expConfig.bosses[Math.floor(Math.random() * _expConfig.bosses.length)];
      tiles.push({ type: 'boss', monster: { ...boss }, cleared: false });
    } else {
      var roll = Math.random() * 100;
      if (roll < _expConfig.chance_empty) {
        tiles.push({ type: 'empty', cleared: false });
      } else if (roll < _expConfig.chance_empty + _expConfig.chance_treasure) {
        var acorns = Math.floor(Math.random() * (_expConfig.treasure_acorn_max - _expConfig.treasure_acorn_min + 1)) + _expConfig.treasure_acorn_min;
        tiles.push({ type: 'treasure', acorns: acorns, cleared: false });
      } else {
        var mon = _expConfig.monsters[Math.floor(Math.random() * _expConfig.monsters.length)];
        tiles.push({ type: 'monster', monster: { ...mon }, cleared: false });
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

  var tilesHTML = '';
  for (var i = 0; i < s.tiles.length; i++) {
    var tile = s.tiles[i];
    var isCurrent = (i === s.currentTile);
    var isPast = (i < s.currentTile);
    var isFuture = (i > s.currentTile);

    var icon = '❓';
    var label = '';
    var tileClass = 'exp-tile';

    if (isPast || tile.cleared) {
      tileClass += ' exp-tile-past';
      if (tile.type === 'empty') { icon = '🍃'; label = '평화'; }
      else if (tile.type === 'treasure') { icon = '💰'; label = '보물'; }
      else if (tile.type === 'monster') { icon = '⚔️'; label = '승리'; }
      else if (tile.type === 'boss') { icon = '👑'; label = '격파'; }
    } else if (isCurrent) {
      tileClass += ' exp-tile-current';
      icon = '📍';
      label = (i === s.tiles.length - 1) ? '보스' : (i + 1) + '칸';
    } else {
      tileClass += ' exp-tile-future';
      icon = (i === s.tiles.length - 1) ? '💀' : '❓';
      label = (i === s.tiles.length - 1) ? '보스' : (i + 1) + '칸';
    }

    tilesHTML += '<div class="' + tileClass + '">' +
      '<div class="exp-tile-icon">' + icon + '</div>' +
      '<div class="exp-tile-label">' + label + '</div>' +
      '</div>';

    // 타일 사이 연결선
    if (i < s.tiles.length - 1) {
      var lineClass = isPast ? 'exp-line exp-line-past' : 'exp-line';
      tilesHTML += '<div class="' + lineClass + '"></div>';
    }
  }

  // 파티 상태
  var partyHTML = s.party.map(function(p) {
    var hpPct = Math.max(0, Math.round(p.hp / p.maxHp * 100));
    var hpColor = hpPct <= 20 ? '#ef4444' : hpPct <= 50 ? '#eab308' : '#22c55e';
    var isDead = p.hp <= 0;
    return '<div class="exp-party-card' + (isDead ? ' exp-party-dead' : '') + '">' +
      '<div class="exp-party-emoji">' + (isDead ? '😵' : '🦔') + '</div>' +
      '<div class="exp-party-info">' +
        '<div class="exp-party-name">' + p.name + '</div>' +
        '<div class="exp-party-bar"><div class="exp-party-hp" style="width:' + hpPct + '%;background:' + hpColor + '"></div></div>' +
        '<div class="exp-party-stats">❤️' + Math.max(0, p.hp) + '/' + p.maxHp + ' ⚔️' + p.atk + ' 🛡️' + p.def + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  container.innerHTML =
    '<div class="exp-container">' +
      // 상단 정보
      '<div class="exp-header">' +
        '<div class="exp-header-left">' +
          '<span class="exp-header-title">🗺️ 탐험 진행 중</span>' +
          '<span class="exp-header-sub">' + s.currentTile + ' / ' + s.tiles.length + ' 칸</span>' +
        '</div>' +
        '<div class="exp-header-right">' +
          '<span class="exp-loot-badge">🌰 ' + totalAcorns + '</span>' +
          '<span class="exp-sp-badge">✨ SP ' + s.sp + '/' + s.spTotal + '</span>' +
        '</div>' +
      '</div>' +
      // 타일 맵
      '<div class="exp-tiles-wrap">' +
        '<div class="exp-tiles">' + tilesHTML + '</div>' +
      '</div>' +
      // 파티
      '<div class="exp-party">' + partyHTML + '</div>' +
      // 행동 버튼
      '<div class="exp-actions">' +
        '<button class="btn btn-primary" id="expAdvanceBtn" onclick="_expAdvance()">▶️ 다음 칸으로 이동</button>' +
        '<button class="btn btn-gray" onclick="_expRetreat()">🏳️ 귀환하기</button>' +
      '</div>' +
    '</div>';
}

// ================================================================
//  다음 칸 이동
// ================================================================
function _expAdvance() {
  var s = _expState;
  if (!s || s.currentTile >= s.tiles.length) return;

  var tile = s.tiles[s.currentTile];

  if (tile.type === 'empty') {
    _expHandleEmpty();
  } else if (tile.type === 'treasure') {
    _expHandleTreasure(tile);
  } else if (tile.type === 'monster' || tile.type === 'boss') {
    _expHandleBattle(tile);
  }
}

// ── 빈 칸 ──
function _expHandleEmpty() {
  var s = _expState;
  s.tiles[s.currentTile].cleared = true;
  s.currentTile++;
  toast('🍃', '아무 일도 일어나지 않았다...');
  _expSaveProgress();

  if (s.currentTile >= s.tiles.length) {
    _expComplete();
  } else {
    _expRenderMap();
  }
}

// ── 보물 칸 ──
function _expHandleTreasure(tile) {
  var s = _expState;
  s.loot.push({ type: 'treasure', acorns: tile.acorns });
  s.tiles[s.currentTile].cleared = true;
  s.currentTile++;
  toast('💰', '보물 발견! 🌰 ' + tile.acorns + '개 획득!');
  _expSaveProgress();

  if (s.currentTile >= s.tiles.length) {
    _expComplete();
  } else {
    _expRenderMap();
  }
}

// ── 몬스터/보스 전투 ──
function _expHandleBattle(tile) {
  var s = _expState;
  var container = document.getElementById('sqcontent-expedition');
  if (!container) return;

  // 전투용 몬스터 데이터 (HP 복사본)
  var mon = {
    name: tile.monster.name, emoji: tile.monster.emoji, lv: tile.monster.lv,
    hp: tile.monster.hp, maxHp: tile.monster.hp,
    atk: tile.monster.atk, def: tile.monster.def
  };

  // 전투 UI 렌더
  _expRenderBattle(container, mon, tile.type === 'boss');
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
    loot: { acorns: 0 }
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
          '<button class="btl-act-btn" id="btlBtnItem"  onclick="_btlAction(\'item\')"><span class="btl-btn-icon">🎒</span>아이템</button>' +
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
    return '<div class="btl-p-card" id="btlPc' + i + '">' +
      '<div class="btl-p-emoji">' + (p.hp > 0 ? '🦔' : '😵') + '</div>' +
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

// ── Web Audio (전투 사운드) ──
var _btlAC = null;
function _btlGetAC() {
  if (!_btlAC) _btlAC = new (window.AudioContext || window.webkitAudioContext)();
  if (_btlAC.state === 'suspended') _btlAC.resume();
  return _btlAC;
}

function _btlSound(type) {
  try {
    var ctx = _btlGetAC();
    var g = ctx.createGain(); g.connect(ctx.destination);
    if (type === 'attack') {
      var o1 = ctx.createOscillator(); o1.type = 'triangle';
      o1.frequency.setValueAtTime(260, ctx.currentTime);
      o1.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + .16);
      g.gain.setValueAtTime(.22, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .18);
      o1.connect(g); o1.start(); o1.stop(ctx.currentTime + .2);
    } else if (type === 'hit') {
      var o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + .22);
      g.gain.setValueAtTime(.24, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .25);
      o.connect(g); o.start(); o.stop(ctx.currentTime + .28);
    } else if (type === 'skill') {
      [0, .1, .2].forEach(function(delay, i) {
        var o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime([440, 554, 659][i], ctx.currentTime + delay);
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(.18, ctx.currentTime + delay);
        sg.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + delay + .22);
        o.connect(sg); sg.connect(ctx.destination);
        o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + .25);
      });
    } else if (type === 'heal') {
      [0, .1, .2].forEach(function(delay, i) {
        var o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime([523, 659, 784][i], ctx.currentTime + delay);
        var hg = ctx.createGain();
        hg.gain.setValueAtTime(.16, ctx.currentTime + delay);
        hg.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + delay + .32);
        o.connect(hg); hg.connect(ctx.destination);
        o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + .35);
      });
    } else if (type === 'victory') {
      [[523, 0], [659, .13], [784, .26], [1047, .42], [784, .56], [1047, .68]].forEach(function(p) {
        var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = p[0];
        var vg = ctx.createGain();
        vg.gain.setValueAtTime(.16, ctx.currentTime + p[1]);
        vg.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + p[1] + .16);
        o.connect(vg); vg.connect(ctx.destination);
        o.start(ctx.currentTime + p[1]); o.stop(ctx.currentTime + p[1] + .18);
      });
    } else if (type === 'defeat') {
      var od = ctx.createOscillator(); od.type = 'sine';
      od.frequency.setValueAtTime(380, ctx.currentTime);
      od.frequency.exponentialRampToValueAtTime(95, ctx.currentTime + .7);
      g.gain.setValueAtTime(.19, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .75);
      od.connect(g); od.start(); od.stop(ctx.currentTime + .8);
    } else if (type === 'cardFlip') {
      var bufLen = ctx.sampleRate * 0.08;
      var buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 3);
      var noise = ctx.createBufferSource(); noise.buffer = buf;
      var flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 3500; flt.Q.value = 1.2;
      g.gain.setValueAtTime(.22, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .1);
      noise.connect(flt); flt.connect(g); noise.start(); noise.stop(ctx.currentTime + .12);
    } else if (type === 'reward') {
      [0, .07, .14].forEach(function(delay, i) {
        var o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime([880, 1109, 1319][i], ctx.currentTime + delay);
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(.17, ctx.currentTime + delay);
        sg.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + delay + .2);
        o.connect(sg); sg.connect(ctx.destination);
        o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + .25);
      });
    }
  } catch (e) {}
}

// ================================================================
//  전투 행동 처리
// ================================================================
function _btlAction(type) {
  var b = _btl;
  if (b.busy || b.battleOver) return;

  if (type === 'escape') {
    _btlLog('💦 도망치려 했지만 실패했다!', 'em');
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
      dmg = Math.floor(b.attacker.atk * 1.65 + Math.random() * 9);
      _btlSound('skill');
      _btlFlash('rgba(255,220,50,.5)');
      _btlLog('✨ <b>' + b.attacker.name + '</b>의 필살기! <b style="color:#f0c030">' + dmg + ' 데미지!</b>', 'skill');
    } else {
      dmg = Math.max(1, b.attacker.atk - Math.floor(b.mon.def * 0.38) + Math.floor(Math.random() * 5) - 1);
      _btlSound('attack');
      _btlFlash('rgba(255,255,255,.38)');
      _btlLog('⚔️ <b>' + b.attacker.name + '</b>의 공격! <b style="color:#68c568">' + dmg + ' 데미지!</b>', 'atk');
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
        var eDmg = Math.max(1, b.mon.atk - Math.floor(target.def * 0.48) + Math.floor(Math.random() * 5) - 1);

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
            _btlSound('defeat');
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
    var target = b.party.filter(function(p) { return p.hp > 0; }).reduce(function(a, bb) { return bb.hp / bb.maxHp < a.hp / a.maxHp ? bb : a; });
    var tIdx = b.party.indexOf(target);
    var heal = Math.floor(target.maxHp * 0.4);
    target.hp = Math.min(target.maxHp, target.hp + heal);
    _btlRender();
    _btlSound('heal');
    _btlFlash('rgba(60,220,120,.28)');
    _btlPopNum('+' + heal, 'btlPc' + tIdx, '#38dd88');
    _btlLog('🎒 포션! <b>' + target.name + '</b> <b style="color:#48cc88">+' + heal + ' HP</b> 회복!', 'heal');

    setTimeout(function() {
      var aliveNow = b.party.filter(function(p) { return p.hp > 0; });
      var rTarget = aliveNow[Math.floor(Math.random() * aliveNow.length)];
      var rIdx = b.party.indexOf(rTarget);
      var eDmg = Math.max(1, b.mon.atk - Math.floor(rTarget.def * 0.48) + Math.floor(Math.random() * 5) - 1);
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
          _btlSound('defeat');
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
var _btlRewardTable = {
  weights: { C: 65, B: 28, A: 7 },
  C: { acorns: [5, 10], itemChance: 0.15, items: ['🍄 버섯', '🌿 풀잎', '🪨 돌멩이'] },
  B: { acorns: [10, 20], itemChance: 0.45, items: ['🍎 사과', '🔮 마석', '🪵 나무'] },
  A: { acorns: [20, 40], itemChance: 0.85, items: ['💎 보석', '⚗️ 비약', '🗡️ 단검'] }
};

function _btlPickGrade() {
  var r = Math.random() * 100;
  if (r < _btlRewardTable.weights.A) return 'A';
  if (r < _btlRewardTable.weights.A + _btlRewardTable.weights.B) return 'B';
  return 'C';
}

function _btlGenReward(grade) {
  var t = _btlRewardTable[grade];
  var acorns = Math.floor(Math.random() * (t.acorns[1] - t.acorns[0] + 1)) + t.acorns[0];
  var item = Math.random() < t.itemChance ? t.items[Math.floor(Math.random() * t.items.length)] : null;
  return { grade: grade, acorns: acorns, item: item };
}

function _btlRewardText(r) {
  if (r.item && r.acorns > 0) return '🌰 ' + r.acorns + '개 + ' + r.item;
  if (r.item) return r.item;
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
    '<div class="btl-win-title">🎉 전투 승리!</div>' +
    '<div class="btl-win-sub">' + _btl.mon.name + '을(를) 물리쳤다!</div>' +
    '<div class="btl-card-hint" id="btlCardHint">카드 1장을 선택하세요</div>' +
    '<div class="btl-card-row" id="btlCardRow">' +
      cards.map(function(c, i) {
        return '<div class="btl-reward-card" id="btlRcard' + i + '" onclick="_btlSelectCard(' + i + ')">' +
          '<div class="btl-card-back"><div class="btl-card-back-icon">🌰</div><div class="btl-card-back-lbl">보상</div></div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div id="btlContWrap" style="display:none"><button class="btl-continue-btn" onclick="_btlContinueAfterWin()">🗺️ 탐험 계속하기</button></div>';

  wrap.appendChild(ov);
}

function _btlBuildFront(r, chosen) {
  var gradeClass = 'btl-grade-' + r.grade.toLowerCase();
  return '<div class="btl-card-front ' + gradeClass + (chosen ? ' btl-chosen-front' : ' btl-unchosen-front') + '">' +
    '<div class="btl-card-grade">' + r.grade + '등급</div>' +
    '<div class="btl-card-reward-icon">' + (r.item ? r.item.split(' ')[0] : '🌰') + '</div>' +
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
}

function _btlContinueAfterWin() {
  var s = _expState;
  // 전투 보상을 탐험 loot에 추가
  s.loot.push({ type: 'battle', acorns: _btl.loot.acorns });
  // 현재 타일 클리어
  s.tiles[s.currentTile].cleared = true;
  s.currentTile++;
  // SP 동기화
  s.sp = _btl.sp;
  _expSaveProgress();

  if (s.currentTile >= s.tiles.length) {
    _expComplete();
  } else {
    _expRenderMap();
  }
}

// ================================================================
//  전투 결과: 패배
// ================================================================
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
    '<div class="btl-lose-title">💀 전투 패배...</div>' +
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
  s.loot.forEach(function(l) { totalAcorns += (l.acorns || 0); });
  var halfAcorns = Math.floor(totalAcorns / 2);
  s.loot = [{ type: 'penalty', acorns: halfAcorns }];
  _expFinish('retreated');
}

// ================================================================
//  탐험 완료 / 귀환
// ================================================================
function _expComplete() {
  _expFinish('completed');
}

function _expRetreat() {
  if (!confirm('정말 귀환하시겠어요? 현재까지의 전리품을 가지고 돌아갑니다.')) return;
  _expFinish('retreated');
}

async function _expFinish(status) {
  var s = _expState;
  if (!s) return;

  var totalAcorns = 0;
  s.loot.forEach(function(l) { totalAcorns += (l.acorns || 0); });

  try {
    // 탐험 상태 업데이트 (tiles 컬럼이 없을 수 있으므로 분리)
    var updateData = {
      status: status,
      current_step: s.currentTile,
      loot: s.loot
    };
    // tiles 저장 시도 (컬럼 없으면 무시)
    try {
      await sb.from('expeditions').update({ tiles: s.tiles }).eq('id', s.expId);
    } catch(e) {}
    await sb.from('expeditions').update(updateData).eq('id', s.expId);

    // 다람쥐 상태 복원 + HP 업데이트
    // HP가 풀이 아니면 recovering 상태로 전환 (시간 경과 후 자동 회복)
    var baseMinutes = (_sqSettings && _sqSettings.recovery_base_minutes) || 60;
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

  // expedition 탭 HTML을 원래 상태로 복원
  var container = document.getElementById('sqcontent-expedition');
  if (container) {
    container.innerHTML =
      '<div class="clay-card p-5 text-center mb-4">' +
        '<div style="font-size:48px" class="mb-2">🗺️</div>' +
        '<div class="title-font text-lg text-gray-700 mb-1">탐험 준비</div>' +
        '<div class="text-sm text-gray-400 mb-4">탐험형 다람쥐를 보유해야 출발할 수 있어요</div>' +
        '<button class="btn btn-primary" onclick="sqStartExpeditionFlow()">탐험 출발 →</button>' +
      '</div>' +
      '<div id="sqActiveExpeditionArea"></div>';
  }

  await sqLoadSquirrels();
  await sqLoadActiveExpedition();
  sqTab('expedition');
}

// ── DB 진행 저장 ──
async function _expSaveProgress() {
  var s = _expState;
  if (!s) return;
  try {
    await sb.from('expeditions').update({
      current_step: s.currentTile,
      loot: s.loot
    }).eq('id', s.expId);
    // tiles 컬럼이 있으면 저장 시도 (없으면 무시)
    try { await sb.from('expeditions').update({ tiles: s.tiles }).eq('id', s.expId); } catch(e) {}
  } catch (e) {}
}
