// ---------------- Procedural level generator ----------------
//
// Technique: start from a SOLVED state (crates already on targets),
// then repeatedly apply random "pulls" (the exact reverse of a push).
// Because every pull is reversible into a forward push, replaying the
// pulls backward as pushes is always a valid solution — so every level
// this produces is solvable by construction, no solver needed.

const DIFFICULTY = {
  easy:   { w: 6, h: 6, crates: 2, minPulls: 12, iterations: 150, obstacleChance: 0.05 },
  medium: { w: 7, h: 7, crates: 3, minPulls: 20, iterations: 250, obstacleChance: 0.10 },
  hard:   { w: 8, h: 8, crates: 4, minPulls: 30, iterations: 400, obstacleChance: 0.14 }
};

const GEN_FALLBACK_LEVEL = `#####\n#@$.#\n#####`;

function genShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function genIsFullyConnected(wallGrid, W, H) {
  let start = null, total = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!wallGrid[y][x]) { total++; if (!start) start = { x, y }; }
  }
  if (!start) return false;
  const seen = new Set([start.x + ',' + start.y]);
  const stack = [start];
  while (stack.length) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || ny >= H || nx >= W || wallGrid[ny][nx]) continue;
      const key = nx + ',' + ny;
      if (!seen.has(key)) { seen.add(key); stack.push({ x: nx, y: ny }); }
    }
  }
  return seen.size === total;
}

function genSerialize(wallGrid, targets, crates, player, W, H) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      if (wallGrid[y][x]) { row += '#'; continue; }
      const isT = targets.some(t => t.x === x && t.y === y);
      const hasCrate = crates.some(c => c.x === x && c.y === y);
      const isPlayer = player.x === x && player.y === y;
      if (isPlayer) row += isT ? '+' : '@';
      else if (hasCrate) row += isT ? '*' : '$';
      else row += isT ? '.' : ' ';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

const GEN_DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Cells the player can walk to without pushing anything (crates block, like walls).
function genReachable(start, wallGrid, crates, W, H) {
  const blocked = (x, y) => wallGrid[y][x] || crates.some(c => c.x === x && c.y === y);
  const seen = new Set([start.x + ',' + start.y]);
  const queue = [start];
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of GEN_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked(nx, ny)) continue;
      const key = nx + ',' + ny;
      if (!seen.has(key)) { seen.add(key); queue.push({ x: nx, y: ny }); }
    }
  }
  return seen;
}

function genTryGenerate(cfg, noObstacles) {
  const W = cfg.w + 2, H = cfg.h + 2;
  const wallGrid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1);
    wallGrid.push(row);
  }

  if (!noObstacles) {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (Math.random() < cfg.obstacleChance) wallGrid[y][x] = true;
    }
    if (!genIsFullyConnected(wallGrid, W, H)) return null;
  }

  const floorCells = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!wallGrid[y][x]) floorCells.push({ x, y });
  }
  if (floorCells.length < cfg.crates * 3 + 2) return null;

  genShuffle(floorCells);
  const targets = floorCells.slice(0, cfg.crates).map(c => ({ ...c }));
  let crates = targets.map(c => ({ ...c }));
  const remaining = floorCells.filter(c => !targets.some(t => t.x === c.x && t.y === c.y));
  if (!remaining.length) return null;
  let player = { ...remaining[Math.floor(Math.random() * remaining.length)] };

  // Guided pulls: pick a random crate + direction, check the reverse-push is
  // legal (destination cells free, player can actually walk to the pull spot),
  // then apply it. Much higher hit rate than a blind random walk.
  let successfulPulls = 0;
  let attempts = 0;
  while (successfulPulls < cfg.minPulls && attempts < cfg.iterations) {
    attempts++;
    const crateIdx = Math.floor(Math.random() * crates.length);
    const cratePos = crates[crateIdx];
    const [dx, dy] = GEN_DIRS[Math.floor(Math.random() * 4)];
    const standAt = { x: cratePos.x - dx, y: cratePos.y - dy };   // where player must stand
    const retreat = { x: cratePos.x - 2 * dx, y: cratePos.y - 2 * dy }; // where player ends up

    if (standAt.x < 0 || standAt.y < 0 || standAt.x >= W || standAt.y >= H) continue;
    if (retreat.x < 0 || retreat.y < 0 || retreat.x >= W || retreat.y >= H) continue;
    if (wallGrid[standAt.y][standAt.x] || wallGrid[retreat.y][retreat.x]) continue;
    if (crates.some(c => c.x === standAt.x && c.y === standAt.y)) continue;
    if (crates.some(c => c.x === retreat.x && c.y === retreat.y)) continue;

    const reachable = genReachable(player, wallGrid, crates, W, H);
    if (!reachable.has(standAt.x + ',' + standAt.y)) continue;

    crates[crateIdx] = standAt;
    player = retreat;
    successfulPulls++;
  }

  if (successfulPulls < cfg.minPulls) return null;
  const alreadySolved = crates.every(c => targets.some(t => t.x === c.x && t.y === c.y));
  if (alreadySolved) return null;

  return genSerialize(wallGrid, targets, crates, player, W, H);
}

function generateLevel(difficulty) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  for (let attempt = 0; attempt < 25; attempt++) {
    const result = genTryGenerate(cfg, attempt >= 15);
    if (result) return result;
  }
  return GEN_FALLBACK_LEVEL;
}
