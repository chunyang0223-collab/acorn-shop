/* ================================================================
   🧬 다람쥐 합성 시스템 (sq_fuse.js)
   ================================================================
   squirrel.js에서 분리된 합성 관련 함수들
   의존: _sqSquirrels, _sqSettings, _sqGradeOrder, _sqGradeLabel,
         _sqGradeStyle, _sqCalcGrade, _sqRandomSprite,
         _sqSpawnParticlesAt, _sqPlayGrowSound, _playTone,
         sqRenderGrid, spendAcorns, showModal, closeModal, toast,
         myProfile, sb, _farmData
   ================================================================ */

var _sqFuseSelected = [null, null]; // 선택된 다람쥐 ID 2개
var _sqFuseSlotPicking = 0;         // 현재 선택 중인 슬롯 (1 or 2)

function sqFuseInit() {
  _sqFuseSelected = [null, null];
  _sqFuseSlotPicking = 0;
  sqFuseRenderSlots();
  sqFuseRenderGrid();
  const costEl = document.getElementById('sqFuseCostDisplay');
  if (costEl) costEl.textContent = _sqSettings.fuse_cost ?? 10;
}

function sqFuseRenderSlots() {
  for (let i = 1; i <= 2; i++) {
    const slot = document.getElementById('sqFuseSlot' + i);
    const sq = _sqFuseSelected[i-1] ? _sqSquirrels.find(s => s.id === _sqFuseSelected[i-1]) : null;
    if (sq) {
      const grade = _sqCalcGrade(sq);
      const gs = _sqGradeStyle(grade);
      const spriteFile = sq.sprite || 'sq_acorn';
      slot.innerHTML = `
        <div style="text-align:center;position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--text-muted);z-index:1" onclick="event.stopPropagation();sqFuseClearSlot(${i})">✕</div>
          <div style="border-radius:14px;${gs.border};box-shadow:${gs.shadow};padding:2px;background:${gs.bg}">
            <img src="images/squirrels/${spriteFile}.png" style="width:48px;height:48px;object-fit:contain;border-radius:10px;display:block" onerror="this.outerHTML='<div style=\\'font-size:36px;line-height:48px;text-align:center\\'>🦔</div>'">
          </div>
          <div style="font-size:11px;font-weight:900;color:var(--fuse-slot-name);margin-top:4px">${sq.name}</div>
          <div style="font-size:10px;font-weight:800;color:${gs.color}">${gs.label}</div>
          <div style="font-size:9px;font-weight:700;color:${sq.type==='explorer'?'var(--p-green-600)':'var(--p-purple-700)'};margin-top:1px">${sq.type==='explorer'?'탐험형':'애완형'}</div>
        </div>`;
      slot.style.border = '3px solid ' + gs.color;
      slot.style.background = gs.bg;
    } else {
      const isPicking = _sqFuseSlotPicking === i;
      slot.innerHTML = `<span style="font-size:32px;color:var(${isPicking ? '--fuse-slot-active-plus' : '--fuse-slot-plus'})">＋</span>`;
      slot.style.border = isPicking ? '3px solid var(--fuse-slot-active-border)' : '3px dashed var(--fuse-slot-border)';
      slot.style.background = isPicking ? 'var(--fuse-slot-active-bg)' : 'var(--fuse-slot-bg)';
    }
  }

  // 버튼 & 정보 업데이트
  const btn = document.getElementById('sqFuseBtn');
  const info = document.getElementById('sqFuseInfo');
  if (_sqFuseSelected[0] && _sqFuseSelected[1]) {
    const sq1 = _sqSquirrels.find(s => s.id === _sqFuseSelected[0]);
    const sq2 = _sqSquirrels.find(s => s.id === _sqFuseSelected[1]);
    const g1 = _sqCalcGrade(sq1), g2 = _sqCalcGrade(sq2);
    if (g1 !== g2) {
      info.innerHTML = `<div style="color:var(--p-red-600);font-size:13px;font-weight:800">⚠️ 같은 등급끼리만 합성할 수 있어요</div>`;
      btn.style.display = 'none';
    } else if (sq1.type !== sq2.type) {
      info.innerHTML = `<div style="color:var(--p-red-600);font-size:13px;font-weight:800">⚠️ 같은 타입끼리만 합성할 수 있어요 (탐험+탐험 or 애완+애완)</div>`;
      btn.style.display = 'none';
    } else {
      const gs = _sqGradeStyle(g1);
      const gi = _sqGradeOrder.indexOf(g1);
      const upgradeChance = _sqFuseGetUpgradeChance(g1);
      const nextLabel = gi < 4 ? _sqGradeLabel[_sqGradeOrder[gi+1]] : null;
      info.innerHTML = `<div style="font-size:13px;font-weight:800;color:${gs.color}">
        ${gs.label} + ${gs.label} 합성
        ${nextLabel ? `<span style="color:var(--text-secondary);font-weight:600"> · 승급 확률 ${upgradeChance}%</span>` : ''}
      </div>`;
      btn.style.display = '';
    }
  } else {
    info.innerHTML = _sqFuseSlotPicking
      ? `<div style="color:var(--p-amber-500);font-size:13px;font-weight:700">아래에서 다람쥐를 선택해주세요</div>`
      : '';
    btn.style.display = 'none';
  }
}

function sqFuseGetUpgradeChance(grade) { return _sqFuseGetUpgradeChance(grade); }
function _sqFuseGetUpgradeChance(grade) {
  switch(grade) {
    case 'normal': return _sqSettings.fuse_upgrade_normal ?? 15;
    case 'rare':   return _sqSettings.fuse_upgrade_rare ?? 12;
    case 'epic':   return _sqSettings.fuse_upgrade_epic ?? 8;
    case 'unique': return _sqSettings.fuse_upgrade_unique ?? 5;
    default:       return 0;
  }
}

function sqFuseRenderGrid() {
  const grid = document.getElementById('sqFuseGrid');
  if (!grid) return;

  // baby, exploring, recovering, 장착 농부 제외
  const activeFarmerId = typeof _farmData !== 'undefined' ? _farmData?.active_farmer_id : null;
  const fusable = _sqSquirrels.filter(sq =>
    (sq.type === 'explorer' || sq.type === 'pet') && sq.status === 'idle' && sq.id !== activeFarmerId
  );

  if (!fusable.length) {
    grid.innerHTML = '<div class="text-center py-4 text-sm text-gray-400">합성 가능한 다람쥐가 없어요</div>';
    return;
  }

  // 등급별 그룹핑
  const groups = {};
  fusable.forEach(sq => {
    const g = _sqCalcGrade(sq);
    if (!groups[g]) groups[g] = [];
    groups[g].push(sq);
  });

  let html = '';
  _sqGradeOrder.forEach(grade => {
    if (!groups[grade]) return;
    const gs = _sqGradeStyle(grade);
    html += `<div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:900;color:${gs.color};margin-bottom:6px">${gs.label} (${groups[grade].length})</div>`;
    groups[grade].forEach(sq => {
      const isSelected = _sqFuseSelected.includes(sq.id);
      const spriteFile = sq.sprite || 'sq_acorn';
      html += `
        <div onclick="sqFuseSelect('${sq.id}')" style="display:inline-flex;flex-direction:column;align-items:center;width:72px;padding:8px 4px;margin:3px;border-radius:12px;cursor:pointer;border:2px solid ${isSelected ? gs.color : 'transparent'};background:${isSelected ? gs.bg : 'white'};box-shadow:0 2px 8px rgba(0,0,0,0.05);transition:all .15s;text-align:center">
          <div style="border-radius:10px;${gs.border};padding:1px;background:${gs.bg}">
            <img src="images/squirrels/${spriteFile}.png" style="width:40px;height:40px;object-fit:contain;border-radius:8px;display:block" onerror="this.outerHTML='<div style=\\'font-size:28px;line-height:40px\\'>🦔</div>'">
          </div>
          <div style="font-size:10px;font-weight:900;color:var(--text-primary);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64px">${sq.name}</div>
          <div style="font-size:9px;font-weight:700;color:${sq.type==='explorer'?'var(--p-green-600)':'var(--p-purple-700)'}">${sq.type==='explorer'?'탐험형':'애완형'}</div>
          <div style="font-size:8px;color:var(--text-muted);margin-top:1px;white-space:nowrap">❤${sq.hp_current||0} ⚔${sq.stats?.atk||0} 🛡${sq.stats?.def||0}</div>
          ${isSelected ? '<div style="font-size:10px;color:var(--p-amber-500);font-weight:800">선택됨</div>' : ''}
        </div>`;
    });
    html += '</div>';
  });
  grid.innerHTML = html;
}

function sqFusePickSlot(slot) {
  _sqFuseSlotPicking = (_sqFuseSlotPicking === slot) ? 0 : slot;
  sqFuseRenderSlots();
  sqFuseRenderGrid();
}

function sqFuseClearSlot(slot) {
  _sqFuseSelected[slot-1] = null;
  _sqFuseSlotPicking = slot;
  sqFuseRenderSlots();
  sqFuseRenderGrid();
}

function sqFuseSelect(id) {
  // 이미 슬롯에 있으면 → 빼기 (토글)
  if (_sqFuseSelected[0] === id) { sqFuseClearSlot(1); return; }
  if (_sqFuseSelected[1] === id) { sqFuseClearSlot(2); return; }

  // 슬롯이 선택되어 있지 않으면 빈 슬롯에 자동 배치
  if (!_sqFuseSlotPicking) {
    if (!_sqFuseSelected[0]) _sqFuseSlotPicking = 1;
    else if (!_sqFuseSelected[1]) _sqFuseSlotPicking = 2;
    else return; // 둘 다 차있으면 무시
  }

  // 이미 다른 슬롯에 있으면 제거
  const otherSlot = _sqFuseSlotPicking === 1 ? 1 : 0;
  if (_sqFuseSelected[otherSlot] === id) _sqFuseSelected[otherSlot] = null;

  _sqFuseSelected[_sqFuseSlotPicking - 1] = id;

  // 다음 빈 슬롯으로 이동
  if (_sqFuseSlotPicking === 1 && !_sqFuseSelected[1]) _sqFuseSlotPicking = 2;
  else _sqFuseSlotPicking = 0;

  sqFuseRenderSlots();
  sqFuseRenderGrid();
}

// ── 합성 실행 ──
async function sqFuseExecute() {
  const id1 = _sqFuseSelected[0], id2 = _sqFuseSelected[1];
  if (!id1 || !id2) return;

  const sq1 = _sqSquirrels.find(s => s.id === id1);
  const sq2 = _sqSquirrels.find(s => s.id === id2);
  if (!sq1 || !sq2) return;

  const grade = _sqCalcGrade(sq1);
  if (grade !== _sqCalcGrade(sq2)) {
    toast('⚠️', '같은 등급끼리만 합성할 수 있어요');
    return;
  }

  const cost = _sqSettings.fuse_cost ?? 10;
  if ((myProfile.acorns || 0) < cost) {
    toast('⚠️', `도토리가 부족해요 (${cost}개 필요)`);
    return;
  }

  // 확인 모달
  const gs = _sqGradeStyle(grade);
  const upgradeChance = _sqFuseGetUpgradeChance(grade);
  const gi = _sqGradeOrder.indexOf(grade);
  const nextLabel = gi < 4 ? _sqGradeLabel[_sqGradeOrder[gi+1]] : null;

  showModal(`
    <div style="text-align:center">
      <div style="font-size:48px;margin-bottom:8px">🧬</div>
      <h2 style="font-size:18px;font-weight:900;color:var(--text-primary);margin-bottom:8px">다람쥐 합성</h2>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:4px"><strong>${sq1.name}</strong> + <strong>${sq2.name}</strong></p>
      <p style="font-size:13px;color:${gs.color};font-weight:800;margin-bottom:4px">${gs.label} 등급 합성</p>
      ${nextLabel ? `<p style="font-size:12px;color:var(--text-muted)">승급 확률: ${upgradeChance}% → ${nextLabel}</p>` : ''}
      <p style="font-size:13px;color:var(--p-amber-600);font-weight:700;margin:12px 0">🌰 ${cost} 도토리 소모</p>
      <p style="font-size:12px;color:var(--p-red-600);font-weight:600;margin-bottom:16px">⚠️ 재료 다람쥐 두 마리는 사라집니다!</p>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn flex-1" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text)">취소</button>
        <button onclick="closeModal();sqFuseConfirm()" class="btn btn-primary flex-1">합성하기!</button>
      </div>
    </div>
  `);
}

async function sqFuseConfirm() {
  const id1 = _sqFuseSelected[0], id2 = _sqFuseSelected[1];
  if (!id1 || !id2) return;

  const sq1 = _sqSquirrels.find(s => s.id === id1);
  const sq2 = _sqSquirrels.find(s => s.id === id2);
  if (!sq1 || !sq2) return;

  const grade = _sqCalcGrade(sq1);
  if (sq1.type !== sq2.type) { toast('⚠️', '같은 타입끼리만 합성 가능'); return; }
  const cost = _sqSettings.fuse_cost ?? 10;

  // 도토리 차감
  const spendRes = await spendAcorns(cost, '다람쥐 합성');
  if (spendRes.error) {
    toast('❌', '도토리 차감 실패');
    return;
  }

  // 승급 판정
  const upgradeChance = _sqFuseGetUpgradeChance(grade);
  const upgraded = Math.random() * 100 < upgradeChance;
  const resultGrade = upgraded ? _sqGradeOrder[Math.min(4, _sqGradeOrder.indexOf(grade) + 1)] : grade;

  // 해당 등급 범위의 스탯 생성
  const stats = _sqFuseGenerateStats(resultGrade);
  const sprite = _sqRandomSprite();
  const fusionType = sq1.type; // 재료와 같은 타입 유지

  // DB: 새 다람쥐 생성 먼저 → 성공하면 재료 삭제 (안전한 순서)
  try {
    const { data: newSq, error: insErr } = await sb.from('squirrels').insert({
      user_id: myProfile.id,
      name: sq1.name,
      type: fusionType,
      status: 'idle',
      sprite: sprite,
      stats: stats,
      hp_current: stats.hp,
      acorns_fed: 0,
      acorns_required: 0,
      acquired_from: 'shop'
    }).select('*').single();
    if (insErr) throw insErr;

    const { error: delErr } = await sb.from('squirrels').delete().in('id', [id1, id2]);
    if (delErr) {
      console.warn('[fuse] 재료 삭제 실패, 새 다람쥐는 생성됨:', delErr);
    }

    // 로컬 캐시 업데이트
    _sqSquirrels = _sqSquirrels.filter(s => s.id !== id1 && s.id !== id2);
    _sqSquirrels.push(newSq);

    // 결과 연출
    _sqFuseShowResult(newSq, upgraded, grade, resultGrade);
  } catch(e) {
    console.error('[fuse] 합성 실패:', JSON.stringify(e));
    toast('❌', '합성 실패: ' + (e?.message || e?.details || JSON.stringify(e)));
    // 도토리 환불 시도
    try {
      await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: cost, p_reason: '합성 실패 환불' });
      myProfile.acorns += cost;
      if (typeof updateAcornDisplay === 'function') updateAcornDisplay();
    } catch(e2) { console.error('[fuse] 환불 실패:', e2); }
  }
}

function _sqFuseGenerateStats(targetGrade) {
  const hpMin = _sqSettings.stat_hp_min || 60, hpMax = _sqSettings.stat_hp_max || 150;
  const atkMin = _sqSettings.stat_atk_min || 8, atkMax = _sqSettings.stat_atk_max || 20;
  const defMin = _sqSettings.stat_def_min || 4, defMax = _sqSettings.stat_def_max || 20;

  // 목표 등급에 맞는 스탯이 나올 때까지 재생성 (최대 500회)
  for (let i = 0; i < 500; i++) {
    const hp  = hpMin  + Math.floor(Math.random() * (hpMax - hpMin + 1));
    const atk = atkMin + Math.floor(Math.random() * (atkMax - atkMin + 1));
    const def = defMin + Math.floor(Math.random() * (defMax - defMin + 1));
    const score = ((hp/hpMax) + (atk/atkMax) + (def/defMax)) / 3 * 100;
    const g = score >= 90 ? 'legend' : score >= 80 ? 'unique' : score >= 70 ? 'epic' : score >= 60 ? 'rare' : 'normal';
    if (g === targetGrade) return { hp, atk, def };
  }
  // fallback: 등급 중간값으로 생성
  const mid = targetGrade === 'legend' ? 95 : targetGrade === 'unique' ? 85 : targetGrade === 'epic' ? 75 : targetGrade === 'rare' ? 65 : 50;
  const ratio = mid / 100;
  return {
    hp:  Math.round(hpMax * ratio),
    atk: Math.round(atkMax * ratio),
    def: Math.round(defMax * ratio)
  };
}

function _sqFuseShowResult(newSq, upgraded, oldGrade, newGrade) {
  const gs = _sqGradeStyle(newGrade);
  const spriteFile = newSq.sprite || 'sq_acorn';
  const typeLabel = newSq.type === 'explorer' ? '탐험형' : '애완형';

  // Phase 1: 합성 중 연출 모달
  showModal(`
    <div id="sqFuseAnim" style="text-align:center;padding:20px 0">
      <div id="sqFuseAnimIcon" style="font-size:56px;animation:sqCardShake 0.5s ease infinite">🧬</div>
      <div style="font-size:16px;font-weight:900;color:var(--text-brand);margin-top:16px">합성 중...</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px">두근두근</div>
    </div>
  `);

  // 두근두근 → 서스펜스 상승 (아기다람쥐 성장 연출과 동일)
  _playTone(220, 'sine', 0.12, 0.18);
  setTimeout(() => _playTone(220, 'sine', 0.12, 0.18), 200);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 400);
  setTimeout(() => _playTone(260, 'sine', 0.12, 0.18), 600);
  setTimeout(() => _playTone(310, 'triangle', 0.2, 0.15), 800);
  setTimeout(() => _playTone(370, 'triangle', 0.2, 0.15), 1000);
  setTimeout(() => _playTone(440, 'triangle', 0.25, 0.15), 1200);
  setTimeout(() => _playTone(523, 'triangle', 0.3, 0.12), 1400);

  // Phase 3: 아이콘 흔들림 강화
  setTimeout(() => {
    const icon = document.getElementById('sqFuseAnimIcon');
    if (icon) icon.style.animation = 'sqCardShake 0.2s ease infinite';
  }, 1000);

  // Phase 4: 파티클 + 빛남 효과
  setTimeout(() => {
    const animEl = document.getElementById('sqFuseAnim');
    if (animEl) {
      const r = animEl.getBoundingClientRect();
      _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/2, true, 15);
    }
  }, 1600);

  // Phase 5: 결과 공개 (약 2초 후)
  setTimeout(() => {
    _sqPlayGrowSound();

    // 승급 시 추가 팡파레
    if (upgraded) {
      setTimeout(() => _playTone(523, 'sine', 0.3, 0.2), 100);
      setTimeout(() => _playTone(659, 'sine', 0.3, 0.2), 250);
      setTimeout(() => _playTone(784, 'sine', 0.4, 0.25), 400);
    }

    closeModal();

    setTimeout(() => {
      showModal(`
        <div style="text-align:center">
          <div style="font-size:14px;color:var(--text-muted);font-weight:700;margin-bottom:12px">합성 결과</div>
          ${upgraded ? `
            <div style="font-size:28px;margin-bottom:8px;animation:sqReadyBounce 0.8s ease-in-out infinite">⬆️</div>
            <div style="font-size:16px;font-weight:900;color:var(--p-amber-500);margin-bottom:12px">🎉 등급 승급!</div>
          ` : ''}
          <div id="sqFuseResultImg" style="display:inline-block;border-radius:20px;${gs.border};box-shadow:${gs.shadow};padding:4px;background:${gs.bg};margin-bottom:12px;opacity:0;transform:scale(0.5);transition:opacity 0.5s,transform 0.5s cubic-bezier(0.34,1.56,0.64,1)">
            <img src="images/squirrels/${spriteFile}.png" style="width:80px;height:80px;object-fit:contain;border-radius:16px;display:block" onerror="this.outerHTML='<div style=\\'font-size:60px;line-height:80px\\'>🦔</div>'">
          </div>
          <div style="font-size:18px;font-weight:900;color:var(--text-primary);margin-bottom:4px">${newSq.name}</div>
          <div style="font-size:14px;font-weight:800;color:${gs.color};margin-bottom:4px">${gs.label} · ${typeLabel}</div>
          <div style="display:flex;gap:12px;justify-content:center;margin:12px 0">
            <div style="text-align:center"><div style="font-size:10px;color:var(--text-muted)">❤️ HP</div><div style="font-size:16px;font-weight:900;color:var(--p-red-500)">${newSq.stats.hp}</div></div>
            <div style="text-align:center"><div style="font-size:10px;color:var(--text-muted)">⚔️ ATK</div><div style="font-size:16px;font-weight:900;color:var(--p-orange-500)">${newSq.stats.atk}</div></div>
            <div style="text-align:center"><div style="font-size:10px;color:var(--text-muted)">🛡️ DEF</div><div style="font-size:16px;font-weight:900;color:var(--p-blue-500)">${newSq.stats.def}</div></div>
          </div>
          ${upgraded ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">${_sqGradeLabel[oldGrade]} → <strong style="color:${gs.color}">${gs.label}</strong></div>` : ''}
          <button onclick="closeModal();sqFuseInit();sqRenderGrid();" class="btn btn-primary w-full">확인</button>
        </div>
      `);

      // 이미지 팝인 애니메이션
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const img = document.getElementById('sqFuseResultImg');
        if (img) { img.style.opacity = '1'; img.style.transform = 'scale(1)'; }
      }));

      // 결과 파티클
      setTimeout(() => {
        const modal = document.querySelector('.modal-content') || document.querySelector('[class*="modal"]');
        if (modal) {
          const r = modal.getBoundingClientRect();
          _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 20);
        }
      }, 200);
    }, 150);
  }, 2000);
}
