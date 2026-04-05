/* ================================================================
   🌱 다람쥐 농장 — 파종·수확 (farm_actions.js)
   씨앗 심기 / 수확 (이벤트 연출 포함)
   ================================================================ */

const _FARM_STACK_MAX = 10; // 인벤토리 슬롯당 최대 스택

// ================================================================
//  파종 모달 (인벤토리 씨앗 선택 → 밭에 심기)
// ================================================================
function farmShowPlantModal(slot) {
  playSound('click');
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
      <button onclick="closeModal()" class="btn w-full" style="background:var(--btn-cancel-bg);color:var(--btn-cancel-text);font-size:13px;font-weight:800;padding:12px;border-radius:14px;border:1.5px solid var(--btn-cancel-border);margin-top:10px">취소</button>
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

    // 농장 성장속도 부스트 이벤트 적용
    const growBoost = (typeof getFarmGrowthBoostPct === 'function') ? getFarmGrowthBoostPct() : 0;
    if (growBoost > 0) {
      // 심은 직후 plot의 harvest_at을 단축
      await _farmReloadAll();
      const plot = _farmPlots.find(p => p.slot === slot);
      if (plot?.harvest_at) {
        const now = Date.now();
        const harvestAt = new Date(plot.harvest_at).getTime();
        const remaining = harvestAt - now;
        const reduced = Math.max(60000, Math.round(remaining * (1 - growBoost / 100))); // 최소 1분
        const newHarvest = new Date(now + reduced).toISOString();
        await sb.from('farm_plots').update({ harvest_at: newHarvest }).eq('user_id', myProfile.id).eq('slot', slot);
        plot.harvest_at = newHarvest;
      }
    }

    playSound('click');
    toast(crop?.emoji || '🌱', `${crop?.name || ''} 씨앗을 심었어요!${growBoost > 0 ? ` (🎉 ${growBoost}% 성장 부스트!)` : ''}`);
    await _farmReloadAll();
    farmRenderMain();
  } catch(e) {
    console.error('[farm plant]', e);
    playSound('farmError');
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

  // ★ 인벤토리 공간 체크 (슬롯 기반, 촉진제/영양제는 슬롯 미차지)
  const capacity = _farmData?.inventory_capacity || 3;
  const cropId = plot.crop_id;
  const usedSlots = (_farmInventory || []).filter(i => i.item_type === 'seed' || i.item_type === 'crop').reduce((sum, inv) => {
    return sum + Math.ceil(inv.quantity / _FARM_STACK_MAX);
  }, 0);
  const existing = (_farmInventory || []).find(i => i.crop_id === cropId && i.item_type === 'crop');
  const existingQty = existing?.quantity || 0;
  const roomInSlot = existingQty > 0 && (existingQty % _FARM_STACK_MAX) > 0
    ? _FARM_STACK_MAX - (existingQty % _FARM_STACK_MAX)
    : 0;
  const freeSlots = capacity - usedSlots;
  const totalSpace = roomInSlot + freeSlots * _FARM_STACK_MAX;

  if (totalSpace <= 0) {
    toast('🎒', '인벤토리가 가득 찼어요! 작물을 판매하고 수확하세요');
    return;
  }

  const crop = _farmCrops.find(c => c.id === cropId);

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
    let icon, title, desc, color;

    if (ev === 'catthief') {
      icon = '🐱'; title = '길냥이 도둑!';
      desc = '길냥이가 작물을 몽땅 훔쳐갔어요...!'; color = '#6b7280';
      _playTone(200, 'sine', 0.15, 0.3);
      setTimeout(() => _playTone(160, 'sine', 0.15, 0.4), 200);
    } else if (ev === 'poor') {
      icon = '😥'; title = '흉작...';
      desc = `${crop?.name || '작물'} ${qty}개만 수확했어요`; color = '#f59e0b';
      _playTone(260, 'sine', 0.12, 0.2);
    } else if (ev === 'bumper') {
      icon = '🎉'; title = '풍작!';
      desc = `${crop?.name || '작물'} ${qty}개 대풍작이에요!`; color = '#16a34a';
      _sqPlayGrowSound();
      setTimeout(() => {
        const modal = document.querySelector('.modal-box');
        if (modal) { const r = modal.getBoundingClientRect(); _sqSpawnParticlesAt(r.left + r.width/2, r.top + r.height/3, true, 20); }
      }, 200);
    } else {
      icon = crop?.emoji || '🌾'; title = '수확 완료!';
      desc = `${crop?.name || '작물'} ${qty}개를 수확했어요`; color = '#16a34a';
      _playTone(440, 'triangle', 0.12, 0.15);
    }

    closeModal();
    setTimeout(() => {
      showModal(`
        <div style="text-align:center;padding:12px 0">
          <div style="font-size:52px;margin-bottom:8px">${icon}</div>
          <div style="font-size:18px;font-weight:900;color:${color};margin-bottom:6px">${title}</div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:16px">${desc}</div>
          <button onclick="closeModal()" class="btn btn-primary w-full">확인</button>
        </div>
      `);
    }, 150);

    _farmReloadAll().then(() => farmRenderMain());
  }, 1500);
}
