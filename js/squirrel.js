/* ================================================================
   🐿️ 다람쥐 시스템 (squirrel.js)
   index.html의 sb, myProfile, toast, showModal, closeModal 사용
   ================================================================ */

var _sqSquirrels = [];
var _sqSettings  = {};
var _sqCurrentTab = 'my';

// ── 탭 전환 ──
function sqTab(tab) {
  ['my','shop','expedition'].forEach(t => {
    document.getElementById(`sqcontent-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`sqtab-${t}`).classList.toggle('active', t === tab);
  });
  _sqCurrentTab = tab;
}

// ── 다람쥐 탭 진입 시 호출 ──
async function sqInit() {
  await sqLoadSettings();
  await sqLoadSquirrels();
  await sqLoadActiveExpedition();
}

// ── 설정 로드 ──
async function sqLoadSettings() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key','squirrel_settings').maybeSingle();
    _sqSettings = data?.value || {
      shop_price: 30, acorn_min: 20, acorn_max: 50,
      time_chance: 40, time_min_hours: 1, time_max_hours: 8
    };
  } catch(e) { _sqSettings = { shop_price:30, acorn_min:20, acorn_max:50, time_chance:40, time_min_hours:1, time_max_hours:8 }; }
}

// ── 다람쥐 목록 로드 ──
async function sqLoadSquirrels() {
  const { data } = await sb.from('squirrels')
    .select('*').eq('user_id', myProfile.id).order('created_at');
  _sqSquirrels = data || [];
  sqRenderGrid();
  sqCheckGrowthTimers();
}

// ── 그리드 렌더링 ──
function sqRenderGrid() {
  const grid = document.getElementById('squirrelGrid');
  document.getElementById('squirrelCount').textContent = `${_sqSquirrels.length} / 10`;

  if (_sqSquirrels.length === 0) {
    grid.innerHTML = `
      <div class="col-span-2 text-center py-8">
        <div style="font-size:48px">🐿️</div>
        <div class="text-sm text-gray-400 font-bold mt-2">아직 다람쥐가 없어요</div>
        <div class="text-xs text-gray-300 mt-1">상점에서 분양받아보세요!</div>
      </div>`;
    return;
  }

  grid.innerHTML = _sqSquirrels.map(sq => sqCardHTML(sq)).join('');

  const empty = 10 - _sqSquirrels.length;
  for (let i = 0; i < Math.min(empty, 2); i++) {
    grid.innerHTML += `<div style="background:#fafafa;border:2px dashed #e5e7eb;border-radius:20px;padding:24px 16px;text-align:center;color:#d1d5db;font-size:13px"><div style="font-size:24px">＋</div><div class="mt-1">빈 슬롯</div></div>`;
  }
}

function sqCardHTML(sq) {
  const typeLabel = { baby:'아기', explorer:'탐험형', pet:'애완형' };
  const typeBadge = { baby:'badge-baby', explorer:'badge-explorer', pet:'badge-pet' };
  const emoji = sqEmoji(sq);
  const borderColor = sq.status === 'explorer' || sq.status === 'exploring' ? '#3b82f6'
                    : sq.status === 'pet' ? '#ec4899' : '#a3a3a3';

  let progressHTML = '';
  if (sq.status === 'baby') {
    const pct = Math.min(100, Math.round((sq.acorns_fed / sq.acorns_required) * 100));
    progressHTML = `
      <div class="mt-2">
        <div class="flex justify-between text-xs text-gray-400 mb-1">
          <span>성장 게이지</span><span>${sq.acorns_fed}/${sq.acorns_required} 🌰</span>
        </div>
        <div style="height:10px;border-radius:99px;background:#f3f4f6;overflow:hidden">
          <div style="height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#f97316);width:${pct}%;transition:width .5s ease"></div>
        </div>
        ${sq.needs_time && sq.grows_at ? `<div class="text-xs text-amber-600 mt-1 font-bold">⏳ 성장 대기 중...</div>` : ''}
      </div>`;
  }

  return `
    <div onclick="sqOpenModal('${sq.id}')" style="background:white;border-radius:20px;padding:16px;box-shadow:0 4px 20px rgba(0,0,0,0.07);transition:all .2s;border:2px solid transparent;border-left:4px solid ${borderColor};cursor:pointer">
      <div class="flex items-start gap-2">
        <div style="font-size:36px;line-height:1">${emoji}</div>
        <div class="flex-1 min-w-0">
          <div class="font-black text-gray-800 text-sm truncate">${sq.name}</div>
          <div class="flex gap-1 flex-wrap mt-0.5">
            <span class="badge ${typeBadge[sq.status] || 'badge-baby'}">${typeLabel[sq.status] || sq.status}</span>
            ${sq.status === 'exploring'  ? `<span class="badge badge-exploring">탐험중</span>` : ''}
            ${sq.status === 'recovering' ? `<span class="badge badge-recovering">회복중</span>` : ''}
          </div>
        </div>
      </div>
      ${progressHTML}
    </div>`;
}

function sqEmoji(sq) {
  if (sq.status === 'recovering') return '😴';
  if (sq.status === 'explorer' || sq.status === 'exploring') return '🦔';
  return '🐿️';
}

// ── 성장 타이머 체크 ──
async function sqCheckGrowthTimers() {
  const now = new Date();
  for (const sq of _sqSquirrels) {
    if (sq.status === 'baby' && sq.needs_time && sq.grows_at && new Date(sq.grows_at) <= now) {
      const newType = Math.random() < 0.5 ? 'explorer' : 'pet';
      await sb.from('squirrels').update({ status: newType, grows_at: null, needs_time: false }).eq('id', sq.id);
      toast('🎉', `${sq.name}이(가) ${newType === 'explorer' ? '탐험형 🗺️' : '애완형 🏡'}으로 성장했어요!`);
    }
  }
  await sqLoadSquirrels();
}

// ── 다람쥐 구매 ──
async function sqBuySquirrel(from) {
  if (_sqSquirrels.length >= 10) {
    showModal(`<div class="text-center"><div style="font-size:40px">😅</div><div class="title-font text-lg text-gray-800 my-2">보유 한도 초과</div><div class="text-sm text-gray-500 mb-4">최대 10마리까지 보유할 수 있어요.<br>재활용센터에서 다람쥐를 판매해보세요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  if (from === 'gacha') {
    showModal(`<div class="text-center"><div style="font-size:40px">🎰</div><div class="title-font text-lg text-gray-800 my-2">뽑기로 획득</div><div class="text-sm text-gray-500 mb-4">뽑기 탭에서 다람쥐를 획득할 수 있어요!</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  const price = _sqSettings.shop_price || 30;
  if (myProfile.acorns < price) {
    showModal(`<div class="text-center"><div style="font-size:40px">🌰</div><div class="title-font text-lg text-gray-800 my-2">도토리 부족</div><div class="text-sm text-gray-500 mb-4">${price} 도토리가 필요해요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  showModal(`
    <div class="text-center">
      <img src="images/baby-squirrel.png" style="width:80px;height:80px;object-fit:contain" class="mx-auto mb-2">
      <div class="title-font text-lg text-gray-800 mb-1">아기 다람쥐 분양</div>
      <div class="text-sm text-gray-500 mb-4"><strong>${price} 🌰</strong>에 분양받을까요?</div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="sqDoBuySquirrel(${price})">분양받기</button>
        <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
      </div>
    </div>`);
}

async function sqDoBuySquirrel(price) {
  closeModal();
  const acornsNeeded = Math.floor(Math.random() * ((_sqSettings.acorn_max||50) - (_sqSettings.acorn_min||20) + 1)) + (_sqSettings.acorn_min||20);
  const needsTime = Math.random() * 100 < (_sqSettings.time_chance||40);
  const baseHp  = 80  + Math.floor(Math.random() * 40);
  const baseAtk = 8   + Math.floor(Math.random() * 10);
  const baseDef = 4   + Math.floor(Math.random() * 8);

  try {
    const { error: e1 } = await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: -price, p_reason: '다람쥐 구매' });
    if (e1) throw e1;

    const { error: e2 } = await sb.from('squirrels').insert({
      user_id: myProfile.id,
      name: sqRandomName(),
      status: 'baby',
      acorns_fed: 0,
      acorns_required: acornsNeeded,
      needs_time: needsTime,
      stats: { hp: baseHp, atk: baseAtk, def: baseDef },
      hp_current: baseHp,
      acquired_from: 'shop'
    });
    if (e2) throw e2;

    myProfile.acorns -= price;
    document.getElementById('acornBadge').textContent = myProfile.acorns.toLocaleString();
    toast('🎉', '새 다람쥐를 분양받았어요!');
    sqTab('my');
    await sqLoadSquirrels();
  } catch(e) {
    console.error(e);
    toast('❌', '오류가 발생했어요');
  }
}

function sqRandomName() {
  const names = ['꼬미','솔방울','도토','밤톨','잣순이','솜이','깜찍이','하루','봄봄','단풍이','찰떡','밀키','코코','뭉치'];
  return names[Math.floor(Math.random() * names.length)];
}

// ── 다람쥐 상세 모달 ──
function sqOpenModal(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  if (!sq) return;
  const emoji = sqEmoji(sq);
  const typeLabel = { baby:'아기 다람쥐 🐿️', explorer:'탐험형 🗺️', pet:'애완형 🏡' };
  const pct = sq.status === 'baby' ? Math.min(100, Math.round((sq.acorns_fed / sq.acorns_required) * 100)) : 100;

  showModal(`
    <div class="text-center mb-4">
      <div style="font-size:64px">${emoji}</div>
      <div class="title-font text-xl text-gray-800 mt-1">${sq.name}</div>
      <div class="text-sm text-gray-400">${typeLabel[sq.status] || sq.status}</div>
    </div>

    ${sq.status === 'baby' ? `
    <div class="clay-card p-3 mb-3" style="background:#fffbeb">
      <div class="flex justify-between text-xs text-gray-500 mb-1 font-bold">
        <span>🌰 성장 게이지</span><span>${sq.acorns_fed} / ${sq.acorns_required}</span>
      </div>
      <div style="height:10px;border-radius:99px;background:#f3f4f6;overflow:hidden">
        <div style="height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#f97316);width:${pct}%"></div>
      </div>
      ${sq.needs_time ? `<div class="text-xs text-amber-600 mt-2 font-bold text-center">⏳ 이 다람쥐는 도토리 외에 시간도 필요해요</div>` : ''}
      ${sq.grows_at   ? `<div class="text-xs text-green-600 mt-1 font-bold text-center">🌱 성장 대기 중...</div>` : ''}
    </div>
    ${!sq.grows_at ? `
    <div class="flex gap-2 mb-3">
      <input type="number" id="sqFeedAmount" class="field" placeholder="먹일 도토리 수" min="1" style="flex:1">
      <button class="btn btn-primary" onclick="sqFeedSquirrel('${sq.id}')">🌰 먹이기</button>
    </div>` : ''}` : ''}

    ${sq.status !== 'baby' ? `
    <div class="grid grid-cols-3 gap-2 mb-3">
      <div class="clay-card p-2 text-center">
        <div class="text-xs text-gray-400 font-bold">❤️ HP</div>
        <div class="title-font text-lg text-red-500">${sq.hp_current}<span class="text-xs text-gray-300">/${sq.stats?.hp||100}</span></div>
      </div>
      <div class="clay-card p-2 text-center">
        <div class="text-xs text-gray-400 font-bold">⚔️ 공격</div>
        <div class="title-font text-lg text-orange-500">${sq.stats?.atk||10}</div>
      </div>
      <div class="clay-card p-2 text-center">
        <div class="text-xs text-gray-400 font-bold">🛡️ 방어</div>
        <div class="title-font text-lg text-blue-500">${sq.stats?.def||5}</div>
      </div>
    </div>` : ''}

    <div class="flex gap-2">
      ${sq.status === 'pet' || sq.status === 'explorer' ? `<button class="btn btn-red btn-sm flex-1" onclick="sqSellSquirrel('${sq.id}')">🏪 펫샵에 팔기</button>` : ''}
      <button class="btn btn-gray btn-sm flex-1" onclick="closeModal()">닫기</button>
    </div>`);
}

// ── 먹이기 ──
async function sqFeedSquirrel(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  const amount = parseInt(document.getElementById('sqFeedAmount').value);
  if (!amount || amount < 1) { toast('⚠️', '먹일 양을 입력해주세요'); return; }
  if (myProfile.acorns < amount) { toast('🌰', '도토리가 부족해요'); return; }

  const newFed = sq.acorns_fed + amount;
  const updates = { acorns_fed: newFed };

  if (newFed >= sq.acorns_required) {
    if (sq.needs_time) {
      const hours = Math.floor(Math.random() * ((_sqSettings.time_max_hours||8) - (_sqSettings.time_min_hours||1) + 1)) + (_sqSettings.time_min_hours||1);
      updates.grows_at = new Date(Date.now() + hours * 3600000).toISOString();
      toast('⏳', `도토리를 다 먹었어요! ${hours}시간 후 성장합니다`);
    } else {
      const newType = Math.random() < 0.5 ? 'explorer' : 'pet';
      updates.status = newType;
      toast('🎉', `${sq.name}이(가) ${newType === 'explorer' ? '탐험형 🗺️' : '애완형 🏡'}으로 성장했어요!`);
    }
  } else {
    toast('🌰', `${sq.name}에게 도토리 ${amount}개를 줬어요!`);
  }

  try {
    await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: -amount, p_reason: '다람쥐 먹이기' });
    await sb.from('squirrels').update(updates).eq('id', id);
    myProfile.acorns -= amount;
    document.getElementById('acornBadge').textContent = myProfile.acorns.toLocaleString();
    closeModal();
    await sqLoadSquirrels();
  } catch(e) {
    toast('❌', '오류가 발생했어요');
  }
}

// ── 펫샵 판매 ──
function sqSellSquirrel(id) {
  const sq = _sqSquirrels.find(s => s.id === id);
  const statSum = (sq.stats?.hp||100) + (sq.stats?.atk||10) * 3 + (sq.stats?.def||5) * 2;
  const price = Math.max(10, 20 + Math.floor(statSum * 0.3) + Math.floor(Math.random() * 20) - 10);
  const desc = sq.status === 'explorer' ? '탐험을 즐기는 활발한 녀석이군요!' : '온순하고 귀여운 애완 다람쥐네요!';

  showModal(`
    <div class="text-center">
      <div style="font-size:40px" class="mb-2">🏪</div>
      <div class="title-font text-lg text-gray-800 mb-1">펫샵</div>
      <div class="text-sm text-gray-500 mb-1">잠깐 살펴볼게요...</div>
      <div class="text-sm text-gray-600 mb-3">${desc}<br>이 다람쥐는 <strong>${price} 🌰</strong>에 사겠습니다.<br>파시겠어요?</div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="sqDoSell('${id}', ${price})">판매하기</button>
        <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
      </div>
    </div>`);
}

async function sqDoSell(id, price) {
  closeModal();
  try {
    await sb.rpc('adjust_acorns', { p_user_id: myProfile.id, p_amount: price, p_reason: '다람쥐 펫샵 판매' });
    await sb.from('squirrels').delete().eq('id', id);
    myProfile.acorns += price;
    document.getElementById('acornBadge').textContent = myProfile.acorns.toLocaleString();
    toast('🏪', `${price} 도토리를 받았어요!`);
    await sqLoadSquirrels();
  } catch(e) {
    toast('❌', '오류가 발생했어요');
  }
}

// ── 탐험 ──
async function sqLoadActiveExpedition() {
  const { data } = await sb.from('expeditions')
    .select('*').eq('user_id', myProfile.id).eq('status','active').maybeSingle();
  const area = document.getElementById('sqActiveExpeditionArea');
  if (data) {
    area.innerHTML = `
      <div class="clay-card p-4">
        <div class="title-font text-base text-gray-700 mb-2">⚔️ 진행 중인 탐험</div>
        <div class="flex items-center gap-3">
          <div class="text-3xl">🗺️</div>
          <div>
            <div class="font-black text-gray-700">${data.current_step} / ${data.total_steps} 칸 진행</div>
            <div class="text-xs text-gray-400">획득 보상: ${(data.loot||[]).length}개</div>
          </div>
          <button class="btn btn-primary btn-sm ml-auto" onclick="sqContinueExpedition('${data.id}')">계속하기 →</button>
        </div>
      </div>`;
  } else {
    area.innerHTML = '';
  }
}

async function sqStartExpeditionFlow() {
  const explorers = _sqSquirrels.filter(s => s.status === 'explorer');
  if (explorers.length === 0) {
    showModal(`<div class="text-center"><div style="font-size:40px">🗺️</div><div class="title-font text-lg text-gray-800 my-2">탐험형 다람쥐가 없어요</div><div class="text-sm text-gray-500 mb-4">다람쥐를 키워서 탐험형으로 성장시켜보세요!</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }
  const { data: active } = await sb.from('expeditions').select('id').eq('user_id', myProfile.id).eq('status','active').maybeSingle();
  if (active) {
    showModal(`<div class="text-center"><div style="font-size:40px">⚔️</div><div class="title-font text-lg text-gray-800 my-2">이미 탐험 중이에요</div><div class="text-sm text-gray-500 mb-4">진행 중인 탐험을 완료하거나 귀환 후 다시 출발하세요.</div><button class="btn btn-primary w-full" onclick="closeModal()">확인</button></div>`);
    return;
  }

  window._sqExpSelected = [];
  showModal(`
    <div class="text-center mb-4">
      <div style="font-size:40px">🗺️</div>
      <div class="title-font text-lg text-gray-800">탐험 다람쥐 선택</div>
      <div class="text-xs text-gray-400 mt-1">최대 3마리를 선택해서 탐험을 떠나요</div>
    </div>
    <div class="space-y-2 mb-4">
      ${explorers.map(sq => `
        <div id="expcard-${sq.id}" onclick="sqToggleExpSelect('${sq.id}')" style="background:white;border-radius:16px;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:2px solid transparent;cursor:pointer;transition:all .2s">
          <div class="flex items-center gap-3">
            <div style="font-size:28px">🦔</div>
            <div class="flex-1">
              <div class="font-black text-gray-700">${sq.name}</div>
              <div class="text-xs text-gray-400">❤️${sq.hp_current} ⚔️${sq.stats?.atk||10} 🛡️${sq.stats?.def||5}</div>
            </div>
            <div id="expcheck-${sq.id}" class="text-xl">⬜</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="flex gap-2">
      <button class="btn btn-primary flex-1" onclick="sqLaunchExpedition()">⚔️ 출발!</button>
      <button class="btn btn-gray flex-1" onclick="closeModal()">취소</button>
    </div>`);
}

function sqToggleExpSelect(id) {
  const idx = window._sqExpSelected.indexOf(id);
  if (idx >= 0) {
    window._sqExpSelected.splice(idx, 1);
    document.getElementById(`expcard-${id}`).style.borderColor = 'transparent';
    document.getElementById(`expcheck-${id}`).textContent = '⬜';
  } else {
    if (window._sqExpSelected.length >= 3) { toast('⚠️', '최대 3마리까지 선택할 수 있어요'); return; }
    window._sqExpSelected.push(id);
    document.getElementById(`expcard-${id}`).style.borderColor = '#f59e0b';
    document.getElementById(`expcheck-${id}`).textContent = '✅';
  }
}

async function sqLaunchExpedition() {
  if (!window._sqExpSelected?.length) { toast('⚠️', '다람쥐를 1마리 이상 선택해주세요'); return; }
  try {
    await sb.from('expeditions').insert({
      user_id: myProfile.id,
      squirrel_ids: window._sqExpSelected,
      current_step: 0,
      total_steps: 5,
      status: 'active',
      loot: []
    });
    closeModal();
    toast('🗺️', '탐험을 시작했어요!');
    await sqLoadActiveExpedition();
    sqTab('expedition');
  } catch(e) {
    toast('❌', '탐험 시작에 실패했어요');
  }
}

async function sqContinueExpedition(expId) {
  toast('🚧', '탐험 진행 화면은 준비 중이에요');
}

// ── 관리자: 설정 로드 ──
async function sqAdminInit() {
  await sqLoadSettings();
  document.getElementById('sqSet_shopPrice').value  = _sqSettings.shop_price    || 30;
  document.getElementById('sqSet_acornMin').value   = _sqSettings.acorn_min     || 20;
  document.getElementById('sqSet_acornMax').value   = _sqSettings.acorn_max     || 50;
  document.getElementById('sqSet_timeChance').value = _sqSettings.time_chance   || 40;
  document.getElementById('sqSet_timeMin').value    = _sqSettings.time_min_hours|| 1;
  document.getElementById('sqSet_timeMax').value    = _sqSettings.time_max_hours|| 8;
  await sqAdminLoadList();
}

async function sqSaveSettings() {
  const val = {
    shop_price:     parseInt(document.getElementById('sqSet_shopPrice').value)  || 30,
    acorn_min:      parseInt(document.getElementById('sqSet_acornMin').value)   || 20,
    acorn_max:      parseInt(document.getElementById('sqSet_acornMax').value)   || 50,
    time_chance:    parseInt(document.getElementById('sqSet_timeChance').value) || 40,
    time_min_hours: parseInt(document.getElementById('sqSet_timeMin').value)    || 1,
    time_max_hours: parseInt(document.getElementById('sqSet_timeMax').value)    || 8,
  };
  const { error } = await sb.from('app_settings').upsert({ key: 'squirrel_settings', value: val }, { onConflict: 'key' });
  if (error) { toast('❌', '저장 실패'); return; }
  _sqSettings = val;
  toast('✅', '설정이 저장됐어요');
}

async function sqAdminLoadList() {
  const { data } = await sb.from('squirrels').select('*, users(display_name)').order('created_at', { ascending: false }).limit(30);
  const el = document.getElementById('sqAdminList');
  if (!data?.length) { el.innerHTML = '<div class="text-center py-4 text-gray-400">보유 다람쥐가 없어요</div>'; return; }
  const typeLabel = { baby:'아기', explorer:'탐험형', pet:'애완형', exploring:'탐험중', recovering:'회복중' };
  el.innerHTML = data.map(sq => `
    <div class="flex items-center justify-between py-2 border-b border-gray-100">
      <div>
        <span class="font-black text-gray-700 text-sm">${sq.name}</span>
        <span class="badge badge-${sq.status === 'explorer' || sq.status === 'exploring' ? 'explorer' : sq.status === 'pet' ? 'pet' : 'baby'} ml-1">${typeLabel[sq.status]||sq.status}</span>
      </div>
      <div class="text-xs text-gray-400">${sq.users?.display_name || '알 수 없음'}</div>
    </div>`).join('');
}
