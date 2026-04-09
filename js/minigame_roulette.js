// ══════════════════════════════════════════════
//  행운의 룰렛 v3 (minigame.js에서 분리)
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
//  행운의 룰렛 v3 (가변 칸 너비 + DB 확률)
// ══════════════════════════════════════════════

var _rltSlices = [
  { key: 'miss', label: '꽝',   mult: 0,   color: '#5a5a5a' },
  { key: 'x1',   label: '×1',   mult: 1,   color: '#5a8a4a' },
  { key: 'x15',  label: '×1.5', mult: 1.5, color: '#4a6ea8' },
  { key: 'x3',   label: '×3',   mult: 3,   color: '#b86828' },
  { key: 'x10',  label: '×10',  mult: 10,  color: '#b83838' }
];

var _roulette = null;

function _rltGetProbs() {
  var s = _mgSettings['roulette'] || {};
  var p = s.probs || {};
  return {
    miss: p.miss !== undefined ? p.miss : 38,
    x1:   p.x1   !== undefined ? p.x1   : 30,
    x15:  p.x15  !== undefined ? p.x15  : 20,
    x3:   p.x3   !== undefined ? p.x3   : 10,
    x10:  p.x10  !== undefined ? p.x10  : 2
  };
}

function _rltGetWidths() {
  var s = _mgSettings['roulette'] || {};
  var w = s.widths || {};
  return {
    miss: w.miss !== undefined ? w.miss : 38,
    x1:   w.x1   !== undefined ? w.x1   : 30,
    x15:  w.x15  !== undefined ? w.x15  : 20,
    x3:   w.x3   !== undefined ? w.x3   : 10,
    x10:  w.x10  !== undefined ? w.x10  : 2
  };
}

function startRouletteGame() {
  console.log('[ROULETTE] startRouletteGame 호출');
  var hub = document.getElementById('minigame-hub');
  var play = document.getElementById('minigame-play');
  hub.classList.add('hidden');
  play.classList.remove('hidden');

  var baseFee = getMgSetting('roulette', 'entryFee') || 5;
  var pLimit = getPlayLimit('roulette');
  var rLimit = getRewardLimit('roulette');
  var played = _mgTodayPlays['roulette'] || 0;
  var rewarded = _mgTodayRewards['roulette'] || 0;
  console.log(`[ROULETTE] baseFee=${baseFee}, pLimit=${pLimit}, rLimit=${rLimit}, played=${played}, rewarded=${rewarded}`);

  _roulette = { baseFee: baseFee, multiplier: 1, spinning: false, angle: 0 };

  play.innerHTML =
    '<div class="rlt-container">' +
      '<div class="rlt-header">' +
        '<button class="rlt-back-btn" onclick="confirmExitRoulette()">← 돌아가기</button>' +
        '<div class="rlt-title">🎡 행운의 룰렛</div>' +
        '<div class="rlt-info">도전 ' + (pLimit - played) + '/' + pLimit + ' · 보상 ' + (rLimit - rewarded) + '/' + rLimit + '</div>' +
      '</div>' +
      '<div class="rlt-wheel-wrap">' +
        '<div class="rlt-pointer">▼</div>' +
        '<canvas id="rltCanvas" width="240" height="240"></canvas>' +
      '</div>' +
      '<div class="rlt-bet-section">' +
        '<div class="rlt-bet-label">배수 선택</div>' +
        '<div class="rlt-bet-row">' +
          '<button class="rlt-bet-btn rlt-bet-active" onclick="_rltSetMult(1)">×1<span class="rlt-bet-fee">' + baseFee + '🌰</span></button>' +
          '<button class="rlt-bet-btn" onclick="_rltSetMult(2)">×2<span class="rlt-bet-fee">' + baseFee*2 + '🌰</span></button>' +
          '<button class="rlt-bet-btn" onclick="_rltSetMult(3)">×3<span class="rlt-bet-fee">' + baseFee*3 + '🌰</span></button>' +
          '<button class="rlt-bet-btn" onclick="_rltSetMult(4)">×4<span class="rlt-bet-fee">' + baseFee*4 + '🌰</span></button>' +
          '<button class="rlt-bet-btn" onclick="_rltSetMult(5)">×5<span class="rlt-bet-fee">' + baseFee*5 + '🌰</span></button>' +
        '</div>' +
        '<div class="rlt-bet-total" id="rltBetTotal">참가비: 🌰 ' + baseFee + '</div>' +
      '</div>' +
      '<button class="rlt-spin-btn" id="rltSpinBtn" onclick="_rltSpin()">돌리기!</button>' +
      '<div class="rlt-result" id="rltResult"></div>' +
    '</div>';

  _rltDrawWheel(0);
}

function _rltSetMult(m) {
  if (_roulette.spinning) return;
  _roulette.multiplier = m;
  var btns = document.querySelectorAll('.rlt-bet-btn');
  btns.forEach(function(b, i) {
    b.classList.toggle('rlt-bet-active', i === m - 1);
  });
  document.getElementById('rltBetTotal').textContent = '참가비: 🌰 ' + (_roulette.baseFee * m);
}

// 칸 너비(비율) 기반으로 각 슬라이스의 시작각도와 크기를 계산
function _rltCalcAngles() {
  var widths = _rltGetWidths();
  var keys = ['miss','x1','x15','x3','x10'];
  var total = 0;
  keys.forEach(function(k) { total += (widths[k] || 1); });

  var angles = [];
  var currentAngle = -Math.PI / 2; // 12시에서 시작
  for (var i = 0; i < keys.length; i++) {
    var w = (widths[keys[i]] || 1) / total;
    var sweep = w * Math.PI * 2;
    angles.push({ start: currentAngle, sweep: sweep, idx: i });
    currentAngle += sweep;
  }
  return angles;
}

function _rltDrawWheel(rotation) {
  var canvas = document.getElementById('rltCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var size = canvas.width;
  var cx = size / 2, cy = size / 2, r = size / 2 - 4;
  var angles = _rltCalcAngles();

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  for (var i = 0; i < angles.length; i++) {
    var a = angles[i];
    var slice = _rltSlices[a.idx];
    var startA = a.start;
    var endA = startA + a.sweep;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, startA, endA);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 텍스트 - 칸 중앙에 배치, 항상 읽기 좋은 방향
    ctx.save();
    var midAngle = startA + a.sweep / 2;
    ctx.rotate(midAngle + Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.max(10, Math.round(size * 0.055)) + 'px sans-serif';
    ctx.fillText(slice.label, 0, -r * 0.62);
    ctx.restore();
  }

  // 가운데 원
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a2a';
  ctx.fill();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold ' + Math.round(size * 0.04) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPIN', 0, 0);

  ctx.restore();

  // 외곽 테두리
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function _rltPickResult() {
  var probs = _rltGetProbs();
  var keys = ['miss','x1','x15','x3','x10'];
  var roll = Math.random() * 100;
  console.log(`[ROULETTE] _rltPickResult: probs=`, JSON.stringify(probs), `roll=${roll.toFixed(2)}`);
  var cumul = 0;
  for (var i = 0; i < keys.length; i++) {
    cumul += (probs[keys[i]] || 0);
    if (roll < cumul) { console.log(`[ROULETTE] _rltPickResult → ${keys[i]}(idx=${i}), cumul=${cumul}`); return i; }
  }
  console.log('[ROULETTE] _rltPickResult → fallback miss');
  return 0;
}

async function _rltSpin() {
  console.log('[ROULETTE] _rltSpin 호출');
  if (!_roulette || _roulette.spinning) { console.log('[ROULETTE] _rltSpin 무시: spinning=', _roulette?.spinning); return; }

  var totalFee = _roulette.baseFee * _roulette.multiplier;
  console.log(`[ROULETTE] _rltSpin: totalFee=${totalFee}, multiplier=${_roulette.multiplier}, acorns=${myProfile?.acorns}`);

  if ((myProfile?.acorns || 0) < totalFee) {
    toast('❌', '도토리가 부족해요! (필요: 🌰' + totalFee + ', 보유: 🌰' + (myProfile?.acorns || 0) + ')');
    return;
  }

  var pLimit = getPlayLimit('roulette');
  var played = _mgTodayPlays['roulette'] || 0;
  console.log(`[ROULETTE] _rltSpin: pLimit=${pLimit}, played=${played}`);
  if (played >= pLimit) {
    toast('⚠️', '오늘 도전 횟수를 모두 사용했어요!');
    return;
  }

  _roulette.spinning = true;
  document.getElementById('rltSpinBtn').disabled = true;
  document.getElementById('rltSpinBtn').textContent = '돌리는 중...';
  document.getElementById('rltResult').innerHTML = '';

  // 참가비 차감
  try {
    console.log(`[ROULETTE] 참가비 차감 시도: -${totalFee}`);
    var res = await sb.rpc('adjust_acorns', {
      p_user_id: myProfile.id, p_amount: -totalFee,
      p_reason: '미니게임 [행운의 룰렛] 참가비 -' + totalFee + '🌰 (×' + _roulette.multiplier + ')'
    });
    console.log('[ROULETTE] adjust_acorns 응답:', JSON.stringify(res.data));
    if (!res.data?.success) { toast('❌', '참가비 차감 실패!'); _roulette.spinning = false; _rltResetBtn(); return; }
    myProfile.acorns = res.data.balance;
    updateAcornDisplay();
  } catch(e) { console.error('[ROULETTE] 참가비 차감 오류:', e); toast('❌', '참가비 차감 중 오류'); _roulette.spinning = false; _rltResetBtn(); return; }

  // 확률 기반 결과 결정
  var resultIdx = _rltPickResult();
  var resultSlice = _rltSlices[resultIdx];
  console.log(`[ROULETTE] 결과: idx=${resultIdx}, key=${resultSlice.key}, label=${resultSlice.label}, mult=${resultSlice.mult}`);

  // 해당 칸의 중앙 각도 계산 (칸 너비 기반)
  // angles[i].start는 12시(-π/2)부터 시계방향으로 배치된 각 칸의 시작 각도(회전 전 기준)
  // 포인터는 12시(상단)에 고정, 휠을 시계방향으로 돌림
  // 포인터 위치(12시 = -π/2)에 칸 중앙이 오려면:
  //   rotation + (칸 중앙 각도) = -π/2 (+ 2πn)
  //   rotation = -π/2 - 칸 중앙 각도
  var angles = _rltCalcAngles();
  var targetA = angles[resultIdx];
  var sliceMid = targetA.start + targetA.sweep / 2; // 칸 중앙의 절대 각도
  var jitter = (Math.random() - 0.5) * targetA.sweep * 0.5; // 칸 안에서 랜덤 오프셋

  // 목표 회전 각도: 포인터(-π/2)에 칸 중앙이 오도록
  var desiredRotation = -Math.PI / 2 - (sliceMid + jitter);
  // 0~2π 범위로 정규화
  desiredRotation = ((desiredRotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  // 현재 누적 각도에서 목표까지 + 최소 5~8바퀴
  var fullSpins = Math.PI * 2 * (5 + Math.floor(Math.random() * 3));
  var currentNorm = ((_roulette.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  var delta = desiredRotation - currentNorm;
  if (delta <= 0) delta += Math.PI * 2;
  var totalRotation = fullSpins + delta;

  var startAngle = _roulette.angle;
  var endAngle = startAngle + totalRotation;
  var duration = 4500;
  var startTime = Date.now();

  function animate() {
    var elapsed = Date.now() - startTime;
    var t = Math.min(1, elapsed / duration);
    var ease = 1 - Math.pow(1 - t, 4);
    var currentAngle = startAngle + totalRotation * ease;
    _rltDrawWheel(currentAngle);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      _roulette.angle = endAngle;
      _roulette.spinning = false;
      _rltShowResult(resultSlice, totalFee);
    }
  }
  requestAnimationFrame(animate);
}

async function _rltShowResult(slice, totalFee) {
  var reward = Math.floor(totalFee * slice.mult);
  console.log(`[ROULETTE] _rltShowResult: slice=${slice.key}, mult=${slice.mult}, totalFee=${totalFee}, reward=${reward}`);

  var rLimit = getRewardLimit('roulette');
  var rUsed = _mgTodayRewards['roulette'] || 0;
  var canClaim = rUsed < rLimit && reward > 0;
  console.log(`[ROULETTE] _rltShowResult: rLimit=${rLimit}, rUsed=${rUsed}, canClaim=${canClaim}`);

  await recordPlay('roulette', reward, canClaim && reward > 0);

  if (canClaim && reward > 0) {
    console.log(`[ROULETTE] 보상 지급: ${reward}`);
    await _giveMinigameReward(reward, reward, 'roulette');
  }

  var resultDiv = document.getElementById('rltResult');
  var emoji, colorClass;
  if (slice.mult === 0) { emoji = '😢'; colorClass = 'rlt-result-lose'; }
  else if (slice.mult >= 10) { emoji = '🎉🎉🎉'; colorClass = 'rlt-result-big'; }
  else if (slice.mult >= 3) { emoji = '🎉'; colorClass = 'rlt-result-big'; }
  else { emoji = '😊'; colorClass = 'rlt-result-win'; }

  if (slice.mult === 0) {
    resultDiv.innerHTML = '<div class="rlt-result-box ' + colorClass + '">' +
      '<div class="rlt-result-emoji">' + emoji + '</div>' +
      '<div class="rlt-result-text">꽝! 다음 기회에...</div>' +
      '<div class="rlt-result-amount">-' + totalFee + ' 🌰</div>' +
    '</div>';
  } else {
    var net = reward - totalFee;
    var netText = net > 0 ? '+' + net : '' + net;
    resultDiv.innerHTML = '<div class="rlt-result-box ' + colorClass + '">' +
      '<div class="rlt-result-emoji">' + emoji + '</div>' +
      '<div class="rlt-result-text">' + slice.label + ' 당첨!</div>' +
      '<div class="rlt-result-amount">+' + reward + ' 🌰' + (canClaim ? '' : ' (보상 소진)') + '</div>' +
      '<div class="rlt-result-net">순이익: ' + netText + ' 🌰</div>' +
    '</div>';
    if (canClaim) toast('🌰', '+' + reward + ' 도토리를 받았어요!');
  }

  _rltResetBtn();
  updateAcornDisplay();

  var pLimit = getPlayLimit('roulette');
  var played = _mgTodayPlays['roulette'] || 0;
  var rRem = rLimit - (_mgTodayRewards['roulette'] || 0);
  var infoEl = document.querySelector('.rlt-info');
  if (infoEl) infoEl.textContent = '도전 ' + (pLimit - played) + '/' + pLimit + ' · 보상 ' + rRem + '/' + rLimit;
}

function _rltResetBtn() {
  var btn = document.getElementById('rltSpinBtn');
  if (btn) { btn.disabled = false; btn.textContent = '돌리기!'; }
}

function confirmExitRoulette() {
  if (_roulette?.spinning) { toast('⚠️', '룰렛이 돌아가는 중이에요!'); return; }
  exitMinigame();
}
