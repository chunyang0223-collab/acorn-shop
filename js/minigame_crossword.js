// ══════════════════════════════════════════════
//  단어 게임 (크로스워드)
// ══════════════════════════════════════════════

const CW_GRID_SIZE  = 15;
const CW_BOARD_COLS = 9;
const CW_BOARD_ROWS = 13;
const CW_MAX_WORDS  = 6;
const CW_MAX_ATTEMPTS = 40;

const CW_ACORN_RULES = {
  easy:   { perWord: 2, bonus: 0 },
  normal: { perWord: 3, bonus: 2 },
  hard:   { perWord: 3, bonus: 7 },
};

let _cwState = null;
let _cwDifficulty = 'easy';
let _cwWordBank = null;

// ── 단어 뱅크 로드 ──
async function _cwLoadWordBank() {
  console.log('[CW] _cwLoadWordBank 호출');
  if (_cwWordBank) { console.log('[CW] _cwLoadWordBank: 캐시 히트, 단어수:', Object.keys(_cwWordBank).length); return _cwWordBank; }
  try {
    const res  = await fetch('words.txt');
    const text = await res.text();
    console.log(`[CW] _cwLoadWordBank: words.txt 로드 완료, 길이=${text.length}`);
    // "const vocaDB = { ... }" 형태 파싱
    const match = text.match(/const\s+vocaDB\s*=\s*(\{[\s\S]*\})/);
    if (match) {
      _cwWordBank = JSON.parse(match[1]);
    } else {
      // fallback: 줄 단위 파싱
      _cwWordBank = {};
      text.split('\n').forEach(line => {
        const m = line.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
        if (m) _cwWordBank[m[1]] = m[2];
      });
    }
  } catch(e) {
    console.warn('[crossword] 단어 파일 로드 실패:', e);
    _cwWordBank = {};
  }
  return _cwWordBank;
}

// ── 크로스워드 생성 ──
function _cwGenerate(wordBank) {
  const entries = Object.entries(wordBank).filter(([w]) => w.length >= 3 && w.length <= 10);
  for (let attempt = 0; attempt < CW_MAX_ATTEMPTS; attempt++) {
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const result   = _cwTryBuild(shuffled);
    if (result && result.placed.length >= 4) return result;
  }
  return null;
}

function _cwTryBuild(entries) {
  const grid   = Array.from({ length: CW_GRID_SIZE }, () => Array(CW_GRID_SIZE).fill(null));
  const placed = [];

  const [firstWord, firstHint] = entries[0];
  const startCol = Math.floor(CW_GRID_SIZE / 2);
  const startRow = Math.floor((CW_GRID_SIZE - firstWord.length) / 2);
  _cwPlaceWord(grid, firstWord, startRow, startCol, 'down');
  placed.push({ word: firstWord, hint: firstHint, row: startRow, col: startCol, dir: 'down', number: 1 });

  let num = 2;
  for (let i = 1; i < entries.length && placed.length < CW_MAX_WORDS; i++) {
    const [word, hint] = entries[i];
    const pos = _cwFindPlacement(grid, placed, word);
    if (pos) {
      _cwPlaceWord(grid, word, pos.row, pos.col, pos.dir);
      placed.push({ word, hint, row: pos.row, col: pos.col, dir: pos.dir, number: num++ });
    }
  }
  return placed.length >= 4 ? { grid, placed } : null;
}

function _cwPlaceWord(grid, word, row, col, dir) {
  for (let i = 0; i < word.length; i++) {
    const r = dir === 'across' ? row : row + i;
    const c = dir === 'across' ? col + i : col;
    grid[r][c] = word[i];
  }
}

function _cwFindPlacement(grid, placed, word) {
  const candidates = [];
  for (const p of placed) {
    const crossDir = p.dir === 'down' ? 'across' : 'down';
    for (let wi = 0; wi < word.length; wi++) {
      for (let pi = 0; pi < p.word.length; pi++) {
        if (word[wi] !== p.word[pi]) continue;
        let row, col;
        if (crossDir === 'down') {
          row = p.row - wi; col = p.col + pi;
        } else {
          row = p.row + pi; col = p.col - wi;
        }
        if (_cwCanPlace(grid, word, row, col, crossDir)) {
          const cx   = col + (crossDir === 'across' ? word.length / 2 : 0);
          const cy   = row + (crossDir === 'down'   ? word.length / 2 : 0);
          const dist = Math.abs(cx - CW_GRID_SIZE / 2) + Math.abs(cy - CW_GRID_SIZE / 2);
          const hPen = crossDir === 'down' ? Math.abs(col - CW_GRID_SIZE / 2) * 3 : 0;
          candidates.push({ row, col, dir: crossDir, score: dist + hPen });
        }
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0];
}

function _cwCanPlace(grid, word, row, col, dir) {
  if (row < 0 || col < 0) return false;
  const endRow = dir === 'across' ? row : row + word.length - 1;
  const endCol = dir === 'across' ? col + word.length - 1 : col;
  if (endRow >= CW_GRID_SIZE || endCol >= CW_GRID_SIZE) return false;
  if (dir === 'across' && col > 0 && grid[row][col - 1] !== null) return false;
  if (dir === 'down'   && row > 0 && grid[row - 1][col] !== null) return false;
  if (dir === 'across' && endCol < CW_GRID_SIZE - 1 && grid[row][endCol + 1] !== null) return false;
  if (dir === 'down'   && endRow < CW_GRID_SIZE - 1 && grid[endRow + 1][col] !== null) return false;

  let hasIntersection = false;
  for (let i = 0; i < word.length; i++) {
    const r = dir === 'across' ? row : row + i;
    const c = dir === 'across' ? col + i : col;
    const existing = grid[r][c];
    if (existing === null) {
      if (dir === 'across') {
        if (r > 0 && grid[r-1][c] !== null) return false;
        if (r < CW_GRID_SIZE - 1 && grid[r+1][c] !== null) return false;
      } else {
        if (c > 0 && grid[r][c-1] !== null) return false;
        if (c < CW_GRID_SIZE - 1 && grid[r][c+1] !== null) return false;
      }
    } else if (existing === word[i]) {
      hasIntersection = true;
    } else {
      return false;
    }
  }
  return hasIntersection;
}

// ── Prefilled 계산 ──
function _cwBuildPrefilled(placed, grid, difficulty) {
  const prefilled = new Set();
  if (difficulty === 'hard') {
    const count = {};
    placed.forEach(p => {
      for (let i = 0; i < p.word.length; i++) {
        const r = p.dir === 'across' ? p.row : p.row + i;
        const c = p.dir === 'across' ? p.col + i : p.col;
        const k = `${r},${c}`;
        count[k] = (count[k] || 0) + 1;
      }
    });
    Object.entries(count).forEach(([k, v]) => { if (v >= 2) prefilled.add(k); });
    return prefilled;
  }
  const ratio = difficulty === 'easy' ? 0.5 : 0.25;
  placed.forEach(p => {
    const len     = p.word.length;
    const count   = Math.max(1, Math.round(len * ratio));
    const indices = Array.from({ length: len }, (_, i) => i).sort(() => Math.random() - 0.5).slice(0, count);
    indices.forEach(i => {
      const r = p.dir === 'across' ? p.row : p.row + i;
      const c = p.dir === 'across' ? p.col + i : p.col;
      prefilled.add(`${r},${c}`);
    });
  });
  return prefilled;
}

// ── 게임 시작 ──
async function startCrosswordGame(difficulty) {
  console.log(`[CW] startCrosswordGame(difficulty=${difficulty})`);
  _cwDifficulty = difficulty || 'easy';

  const hub  = document.getElementById('minigame-hub');
  const play = document.getElementById('minigame-play');
  hub.classList.add('hidden');
  play.classList.remove('hidden');

  play.innerHTML = `
    <div id="cw-wrap" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px 16px;min-height:100%;background:var(--bg,#f0eeff);font-family:'Segoe UI',system-ui,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%;max-width:420px;">
        <button onclick="exitMinigame()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#8b87a8;padding:4px 8px;">✕</button>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:0.75rem;font-weight:700;padding:4px 12px;border-radius:20px;background:${_cwDiffColor(_cwDifficulty)};color:#fff;">${_cwDiffLabel(_cwDifficulty)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;width:100%;max-width:420px;background:#fff;border-radius:16px;padding:12px 18px;box-shadow:0 2px 8px rgba(124,111,247,.10);border:1.5px solid #e2deff;">
        <div style="display:flex;flex-direction:column;align-items:center;flex:1">
          <span style="font-size:1.2rem;font-weight:800;color:#7c6ff7" id="cw-stat-words">0</span>
          <span style="font-size:0.65rem;color:#8b87a8;text-transform:uppercase;letter-spacing:.5px">단어</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;flex:1">
          <span style="font-size:1.2rem;font-weight:800;color:#7c6ff7" id="cw-stat-filled">0</span>
          <span style="font-size:0.65rem;color:#8b87a8;text-transform:uppercase;letter-spacing:.5px">입력</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;flex:1">
          <span style="font-size:1.2rem;font-weight:800;color:#7c6ff7" id="cw-stat-timer">0:00</span>
          <span style="font-size:0.65rem;color:#8b87a8;text-transform:uppercase;letter-spacing:.5px">시간</span>
        </div>
        <button id="cw-btn-submit" onclick="cwSubmit()"
          style="padding:10px 20px;border-radius:12px;font-size:0.875rem;font-weight:800;font-family:inherit;cursor:pointer;border:none;background:#7c6ff7;color:#fff;box-shadow:0 4px 0 #5a52c7;transition:transform .1s,box-shadow .1s;white-space:nowrap;">
          제출
        </button>
      </div>
      <div style="background:#fff;border-radius:20px;padding:20px;box-shadow:0 4px 20px rgba(124,111,247,.15);border:1.5px solid #e2deff;">
        <div id="cw-board-container">
          <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px;color:#8b87a8;font-size:.9rem;">
            <div style="width:36px;height:36px;border:3px solid #e2deff;border-top-color:#7c6ff7;border-radius:50%;animation:cw-spin .7s linear infinite;"></div>
            게임판 생성 중…
          </div>
        </div>
      </div>
      <div id="cw-hint-tooltip" style="position:fixed;z-index:200;background:#2d2a3e;color:#fff;font-size:.78rem;line-height:1.45;padding:8px 12px;border-radius:12px;max-width:220px;box-shadow:0 4px 20px rgba(124,111,247,.15);pointer-events:auto;cursor:pointer;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;">
        <div id="cw-tt-dir" style="font-size:.65rem;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#f7a1c4;margin-bottom:3px;"></div>
        <div id="cw-tt-text"></div>
      </div>
    </div>
    <style>
      @keyframes cw-spin { to { transform:rotate(360deg); } }
      .cw-cell { width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.95rem;font-weight:700;position:relative;transition:background .15s,box-shadow .15s;cursor:default;user-select:none; }
      .cw-cell.empty { background:#f0eeff;opacity:.25; }
      .cw-cell.filled { background:#fff;border:1.5px solid #e2deff;box-shadow:3px 3px 0 rgba(124,111,247,.15);cursor:pointer; }
      .cw-cell.prefilled { background:#ede9ff; }
      .cw-cell.prefilled input { color:#7c6ff7;font-weight:800; }
      .cw-cell.active { background:#ede9ff!important;border-color:#7c6ff7!important;box-shadow:0 0 0 2px #7c6ff7!important; }
      .cw-cell.highlight { background:#f0edff;border-color:#c4b9ff; }
      .cw-cell.correct { background:#d4f4e4;border-color:#7dd3aa; }
      .cw-cell.wrong { background:#fde8e8;border-color:#f5a7a7; }
      .cw-cell input { width:100%;height:100%;border:none;background:transparent;text-align:center;font-size:.95rem;font-weight:700;font-family:inherit;color:#2d2a3e;text-transform:uppercase;cursor:pointer;outline:none;caret-color:transparent; }
      .cw-num { position:absolute;top:2px;left:3px;font-size:.5rem;font-weight:700;color:#7c6ff7;line-height:1; }
      #cw-hint-tooltip.show { opacity:1;transform:translateY(0); }
    </style>`;

  // 단어뱅크 로드 후 게임판 생성
  const wordBank = await _cwLoadWordBank();
  if (!wordBank || Object.keys(wordBank).length === 0) {
    document.getElementById('cw-board-container').innerHTML = '<p style="color:#f5a7a7;padding:20px;text-align:center;">단어 파일을 불러올 수 없어요.</p>';
    return;
  }
  _cwInit(wordBank);
}

function _cwDiffLabel(d) {
  return d === 'easy' ? '😊 Easy' : d === 'normal' ? '🧠 Normal' : '🔥 Hard';
}
function _cwDiffColor(d) {
  return d === 'easy' ? '#6bcf9e' : d === 'normal' ? '#7c6ff7' : '#f7708a';
}

// ── 게임판 초기화 ──
function _cwInit(wordBank) {
  console.log('[CW] _cwInit 호출, 단어수:', Object.keys(wordBank).length);
  const result = _cwGenerate(wordBank);
  if (!result) { console.warn('[CW] _cwInit: 생성 실패, 재시도'); setTimeout(() => _cwInit(wordBank), 50); return; }
  console.log('[CW] _cwInit: 생성 성공, 배치 단어수:', result.placed.length);

  const { grid, placed } = result;

  // 바운딩박스 → 9×13 고정 중앙 배치
  let minR = CW_GRID_SIZE, maxR = 0, minC = CW_GRID_SIZE, maxC = 0;
  for (let r = 0; r < CW_GRID_SIZE; r++)
    for (let c = 0; c < CW_GRID_SIZE; c++)
      if (grid[r][c]) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }

  const usedRows = maxR - minR + 1;
  const usedCols = maxC - minC + 1;
  const offR = Math.floor((CW_BOARD_ROWS - usedRows) / 2);
  const offC = Math.floor((CW_BOARD_COLS - usedCols) / 2);

  const fixedGrid = Array.from({ length: CW_BOARD_ROWS }, () => Array(CW_BOARD_COLS).fill(null));
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      if (grid[r][c])
        fixedGrid[r - minR + offR][c - minC + offC] = grid[r][c];

  const adjPlaced = placed.map(p => ({ ...p, row: p.row - minR + offR, col: p.col - minC + offC }));
  const prefilled = _cwBuildPrefilled(adjPlaced, fixedGrid, _cwDifficulty);

  const userGrid = Array.from({ length: CW_BOARD_ROWS }, () => Array(CW_BOARD_COLS).fill(''));
  prefilled.forEach(k => {
    const [r, c] = k.split(',').map(Number);
    if (fixedGrid[r]?.[c]) userGrid[r][c] = fixedGrid[r][c];
  });

  _cwState = {
    grid: fixedGrid, placed: adjPlaced, userGrid, prefilled,
    rows: CW_BOARD_ROWS, cols: CW_BOARD_COLS,
    selected: null, selectedDir: 'across',
    timer: 0, timerInterval: null, submitted: false,
  };

  _cwState.timerInterval = setInterval(() => {
    _cwState.timer++;
    const m = Math.floor(_cwState.timer / 60);
    const s = _cwState.timer % 60;
    const el = document.getElementById('cw-stat-timer');
    if (el) el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }, 1000);

  document.getElementById('cw-stat-words').textContent = adjPlaced.length;
  _cwRenderBoard();
  _cwUpdateFilled();
}

// ── 보드 렌더 ──
function _cwRenderBoard() {
  const { grid, placed, userGrid, rows, cols, prefilled } = _cwState;
  const container = document.getElementById('cw-board-container');
  if (!container) return;

  const numMap = {};
  placed.forEach(p => { numMap[`${p.row},${p.col}`] = p.number; });

  const board = document.createElement('div');
  board.style.cssText = `display:grid;gap:3px;grid-template-columns:repeat(${cols},36px);grid-template-rows:repeat(${rows},36px);`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cw-cell';
      cell.dataset.r = r; cell.dataset.c = c;

      if (grid[r][c]) {
        cell.classList.add('filled');
        const isPre = prefilled.has(`${r},${c}`);
        if (isPre) cell.classList.add('prefilled');

        if (numMap[`${r},${c}`]) {
          const num = document.createElement('span');
          num.className = 'cw-num';
          num.textContent = numMap[`${r},${c}`];
          cell.appendChild(num);
        }

        const input = document.createElement('input');
        input.maxLength = 1;
        input.value = userGrid[r][c] ? userGrid[r][c].toUpperCase() : '';
        input.dataset.r = r; input.dataset.c = c;

        if (isPre) {
          input.readOnly = true; input.tabIndex = -1;
          input.addEventListener('click', () => { input.blur(); _cwCellClick(r, c); });
        } else {
          input.addEventListener('click',   () => { input.focus(); _cwCellClick(r, c); });
          input.addEventListener('keydown', e  => _cwKeyDown(e, r, c));
          input.addEventListener('input',   e  => _cwInput(e, r, c));
        }
        cell.appendChild(input);
      } else {
        cell.classList.add('empty');
      }
      board.appendChild(cell);
    }
  }

  container.innerHTML = '';
  container.appendChild(board);
  _cwHighlight();

  // 툴팁 클릭 닫기
  const tt = document.getElementById('cw-hint-tooltip');
  if (tt) tt.addEventListener('click', () => tt.classList.remove('show'));
}

// ── 셀 클릭 ──
function _cwCellClick(r, c) {
  if (_cwState.submitted) return;
  if (_cwState.selected?.[0] === r && _cwState.selected?.[1] === c) {
    _cwState.selectedDir = _cwState.selectedDir === 'across' ? 'down' : 'across';
  } else {
    _cwState.selected = [r, c];
  }
  _cwHighlight();

  const active = _cwState.placed.find(p =>
    p.dir === _cwState.selectedDir &&
    (p.dir === 'across' ? p.row === r && c >= p.col && c < p.col + p.word.length
                        : p.col === c && r >= p.row && r < p.row + p.word.length)
  ) || _cwState.placed.find(p =>
    p.dir === 'across' ? p.row === r && c >= p.col && c < p.col + p.word.length
                       : p.col === c && r >= p.row && r < p.row + p.word.length
  );
  if (active) {
    const cellEl = document.querySelector(`.cw-cell[data-r="${r}"][data-c="${c}"]`);
    if (cellEl) _cwShowTooltip(cellEl, active.hint, active.dir);
  }
}

// ── 키 입력 ──
function _cwKeyDown(e, r, c) {
  if (_cwState.submitted) return;
  if (e.key === 'Backspace') {
    if (!_cwState.userGrid[r][c]) { _cwMovePrev(r, c); }
    else { _cwState.userGrid[r][c] = ''; e.target.value = ''; _cwUpdateFilled(); }
    e.preventDefault();
  } else if (e.key === 'ArrowRight') { _cwState.selectedDir = 'across'; _cwMoveNext(r, c); e.preventDefault(); }
  else if (e.key === 'ArrowLeft')  { _cwState.selectedDir = 'across'; _cwMovePrev(r, c); e.preventDefault(); }
  else if (e.key === 'ArrowDown')  { _cwState.selectedDir = 'down';   _cwMoveNext(r, c); e.preventDefault(); }
  else if (e.key === 'ArrowUp')    { _cwState.selectedDir = 'down';   _cwMovePrev(r, c); e.preventDefault(); }
  else if (/^[a-zA-Z]$/.test(e.key)) {
    const val = e.key.toLowerCase();
    e.target.value = val.toUpperCase();
    _cwState.userGrid[r][c] = val;
    const cell = e.target.closest('.cw-cell');
    cell?.classList.remove('correct', 'wrong');
    _cwMoveNext(r, c);
    _cwUpdateFilled();
    e.preventDefault();
  }
}

function _cwInput(e, r, c) {
  if (_cwState.submitted) { e.target.value = (_cwState.userGrid[r][c] || '').toUpperCase(); return; }
  const raw = e.target.value.replace(/[^a-zA-Z]/g, '');
  const val = raw.slice(-1).toLowerCase();
  e.target.value = val.toUpperCase();
  _cwState.userGrid[r][c] = val;
  const cell = e.target.closest('.cw-cell');
  cell?.classList.remove('correct', 'wrong');
  if (val) _cwMoveNext(r, c);
  _cwUpdateFilled();
}

function _cwMoveNext(r, c) {
  const { rows, cols, grid, selectedDir } = _cwState;
  const dr = selectedDir === 'down' ? 1 : 0;
  const dc = selectedDir === 'across' ? 1 : 0;
  const nr = r + dr, nc = c + dc;
  if (nr < rows && nc < cols && grid[nr][nc]) {
    _cwState.selected = [nr, nc]; _cwHighlight(); _cwFocus(nr, nc);
  }
}
function _cwMovePrev(r, c) {
  const { grid, selectedDir } = _cwState;
  const dr = selectedDir === 'down' ? -1 : 0;
  const dc = selectedDir === 'across' ? -1 : 0;
  const nr = r + dr, nc = c + dc;
  if (nr >= 0 && nc >= 0 && grid[nr][nc]) {
    _cwState.selected = [nr, nc]; _cwHighlight(); _cwFocus(nr, nc);
  }
}
function _cwFocus(r, c) {
  const input = document.querySelector(`.cw-cell input[data-r="${r}"][data-c="${c}"]`);
  if (input && !input.readOnly) input.focus();
}

// ── 하이라이트 ──
function _cwHighlight() {
  const { placed, selected, selectedDir } = _cwState;
  document.querySelectorAll('.cw-cell.filled').forEach(el => el.classList.remove('active', 'highlight'));
  if (!selected) return;
  const [sr, sc] = selected;

  const activeWord = placed.find(p => {
    if (p.dir !== selectedDir) return false;
    return p.dir === 'across'
      ? p.row === sr && sc >= p.col && sc < p.col + p.word.length
      : p.col === sc && sr >= p.row && sr < p.row + p.word.length;
  }) || placed.find(p =>
    p.dir === 'across'
      ? p.row === sr && sc >= p.col && sc < p.col + p.word.length
      : p.col === sc && sr >= p.row && sr < p.row + p.word.length
  );

  if (activeWord) {
    for (let i = 0; i < activeWord.word.length; i++) {
      const r = activeWord.dir === 'across' ? activeWord.row : activeWord.row + i;
      const c = activeWord.dir === 'across' ? activeWord.col + i : activeWord.col;
      const cell = document.querySelector(`.cw-cell[data-r="${r}"][data-c="${c}"]`);
      if (cell) cell.classList.add(r === sr && c === sc ? 'active' : 'highlight');
    }
  } else {
    const cell = document.querySelector(`.cw-cell[data-r="${sr}"][data-c="${sc}"]`);
    if (cell) cell.classList.add('active');
  }
}

// ── 채워진 칸 카운트 ──
function _cwUpdateFilled() {
  const { placed, userGrid, prefilled } = _cwState;
  const seen = new Set(); let total = 0, filled = 0;
  placed.forEach(p => {
    for (let i = 0; i < p.word.length; i++) {
      const r = p.dir === 'across' ? p.row : p.row + i;
      const c = p.dir === 'across' ? p.col + i : p.col;
      const k = `${r},${c}`;
      if (seen.has(k)) continue;
      seen.add(k); total++;
      if (userGrid[r][c] || prefilled.has(k)) filled++;
    }
  });
  const el = document.getElementById('cw-stat-filled');
  if (el) el.textContent = `${filled}/${total}`;
}

// ── 툴팁 ──
let _cwTtTimeout = null;
function _cwShowTooltip(cellEl, hint, dir) {
  const tt = document.getElementById('cw-hint-tooltip');
  const ttDir  = document.getElementById('cw-tt-dir');
  const ttText = document.getElementById('cw-tt-text');
  if (!tt) return;
  ttDir.textContent  = dir === 'across' ? '→ Across' : '↓ Down';
  ttText.textContent = hint;
  tt.style.left = '0px'; tt.style.top = '0px';
  tt.classList.add('show');

  const rect = cellEl.getBoundingClientRect();
  const tw = tt.offsetWidth, th = tt.offsetHeight;
  let left = rect.left + rect.width / 2 - tw / 2;
  let top  = rect.top - th - 10 + window.scrollY;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  if (top < 8) top = rect.bottom + 10 + window.scrollY;
  tt.style.left = `${left}px`;
  tt.style.top  = `${top}px`;
  clearTimeout(_cwTtTimeout);
}

// ── 제출 ──
async function cwSubmit() {
  console.log('[CW] cwSubmit 호출');
  if (!_cwState || _cwState.submitted) { console.log('[CW] cwSubmit 무시: state=', !!_cwState, 'submitted=', _cwState?.submitted); return; }
  _cwState.submitted = true;
  clearInterval(_cwState.timerInterval);

  const { placed, grid, userGrid, prefilled } = _cwState;
  let correctWords = 0;

  for (const p of placed) {
    let wordOk = true;
    for (let i = 0; i < p.word.length; i++) {
      const r = p.dir === 'across' ? p.row : p.row + i;
      const c = p.dir === 'across' ? p.col + i : p.col;
      const cell  = document.querySelector(`.cw-cell[data-r="${r}"][data-c="${c}"]`);
      const input = cell?.querySelector('input');
      if (!cell) continue;

      if (prefilled.has(`${r},${c}`)) continue;

      cell.classList.remove('correct', 'wrong');
      const user = (userGrid[r][c] || '').toLowerCase();
      const ans  = grid[r][c];

      // 정답으로 교체
      if (input) input.value = ans.toUpperCase();
      userGrid[r][c] = ans;

      if (user === ans) { cell.classList.add('correct'); }
      else { cell.classList.add('wrong'); wordOk = false; }
    }
    if (wordOk) correctWords++;
  }

  const rule      = CW_ACORN_RULES[_cwDifficulty];
  const allRight  = correctWords === placed.length;
  const acorns    = correctWords * rule.perWord + (allRight ? rule.bonus : 0);
  console.log(`[CW] cwSubmit 결과: correctWords=${correctWords}/${placed.length}, allRight=${allRight}, acorns=${acorns}, difficulty=${_cwDifficulty}`);

  // 도토리 버튼 비활성화
  const btn = document.getElementById('cw-btn-submit');
  if (btn) btn.disabled = true;

  // DB 기록
  const rewarded = acorns > 0;
  await recordPlay('crossword', correctWords, rewarded, acorns);
  if (rewarded) {
    try {
      const res = await sb.rpc('adjust_acorns', {
        p_user_id: myProfile.id,
        p_amount:  acorns,
        p_reason:  `단어게임(${_cwDifficulty}) ${correctWords}/${placed.length}단어 +${acorns}🌰`
      });
      if (res.data?.success) { myProfile.acorns = res.data.balance; updateAcornDisplay(); }
    } catch(e) { console.warn('[crossword] 도토리 지급 실패:', e); }
  }

  // 결과 팝업
  const emoji = correctWords === 0 ? '😅' : allRight ? '🎉' : correctWords >= placed.length / 2 ? '👍' : '🙂';
  const title = allRight ? '완벽해요!' : `${correctWords}개 맞췄어요`;
  const bonusNote = allRight && rule.bonus > 0 ? `전부 맞춰서 보너스 🌰${rule.bonus} 포함!` : '';

  // play 영역에 결과 오버레이
  const wrap = document.getElementById('cw-wrap');
  if (!wrap) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(45,42,62,.35);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:300;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:24px;padding:36px 40px;text-align:center;box-shadow:0 4px 20px rgba(124,111,247,.2);border:1.5px solid #e2deff;max-width:300px;width:90%;display:flex;flex-direction:column;align-items:center;gap:16px;">
      <div style="font-size:3rem;line-height:1;">${emoji}</div>
      <h2 style="font-size:1.4rem;font-weight:800;color:#7c6ff7;margin:0;">${title}</h2>
      <div style="width:100%;background:#f7f5ff;border-radius:12px;padding:14px 18px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:.85rem;color:#8b87a8;">맞춘 단어</span>
          <span style="font-size:1rem;font-weight:800;color:#2d2a3e;">${correctWords} / ${placed.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:.85rem;color:#8b87a8;">획득 도토리</span>
          <span style="font-size:1rem;font-weight:800;color:#c97c2a;">🌰 ${acorns}</span>
        </div>
      </div>
      ${bonusNote ? `<p style="font-size:.82rem;color:#8b87a8;margin:0;">${bonusNote}</p>` : ''}
      <button onclick="exitMinigame()" style="padding:12px 32px;border-radius:12px;font-size:.9rem;font-weight:800;font-family:inherit;cursor:pointer;border:none;background:#7c6ff7;color:#fff;box-shadow:0 4px 0 #5a52c7;width:100%;">확인</button>
    </div>`;
  document.body.appendChild(overlay);
}
