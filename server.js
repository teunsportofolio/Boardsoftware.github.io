const express = require('express');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* -----------------------------
   PATHS & DIRECTORIES
----------------------------- */
const dataDir = path.join(__dirname, 'data');
const climbsDir = path.join(dataDir, 'climbs');
const routesDir = path.join(dataDir, 'routes');
const generatedDir = path.join(dataDir, 'generated'); // NEW: generated holds
const climbsIndexFile = path.join(dataDir, 'index.json');
const routesIndexFile = path.join(dataDir, 'routes_index.json');
const holdDifficultyFile = path.join(dataDir, 'holddifficulty.json');

// Ensure all folders and index files exist
fs.ensureDirSync(climbsDir);
fs.ensureDirSync(routesDir);
fs.ensureDirSync(generatedDir);
if (!fs.existsSync(climbsIndexFile)) fs.writeJsonSync(climbsIndexFile, []);
if (!fs.existsSync(routesIndexFile)) fs.writeJsonSync(routesIndexFile, []);

/* -----------------------------
   LOAD HOLD DIFFICULTY
----------------------------- */
const holdData = fs.readJsonSync(holdDifficultyFile);
const holdLevels = holdData["Hold difficulty level"];
const holdDirections = holdData["Hold Direction"];
const holdWeights = Object.fromEntries(holdData["Hold difficulty weight"]);
const directionWeights = Object.fromEntries(holdData["Hold direction difficulty weight"]);

/* -----------------------------
   CLIMBING PHYSICS
----------------------------- */
function distance(a, b) {
  const dx = a.col - b.col;
  const dy = a.row - b.row;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.pow(d, 1.6);
}

function bonusLeft(oldDir, newDir) {
  if ([1,2,3].includes(oldDir) && [7,6,5].includes(newDir)) return -1;
  if ([1,2,3].includes(oldDir) && [1,2,3].includes(newDir)) return 1;
  if ([7,6,5].includes(oldDir) && [1,2,3].includes(newDir)) return 0;
  if ([7,6,5].includes(oldDir) && [7,6,5].includes(newDir)) return -1;
  return 0;
}

function bonusRight(oldDir, newDir) {
  if ([7,6,5].includes(oldDir) && [1,2,3].includes(newDir)) return -1;
  if ([7,6,5].includes(oldDir) && [7,6,5].includes(newDir)) return 1;
  if ([1,2,3].includes(oldDir) && [5,6,7].includes(newDir)) return 0;
  if ([1,2,3].includes(oldDir) && [1,2,3].includes(newDir)) return -1;
  return 0;
}

function findPreviousHold(route, newHold) {
  const holds = [];
  for (let r = 0; r < route.grid.length; r++) {
    for (let c = 0; c < route.grid[r].length; c++) {
      if (route.grid[r][c] !== null) {
        const level = holdLevels[r][c];
        if (level !== -1) holds.push({ row: r, col: c });
      }
    }
  }
  holds.sort((a, b) => b.row - a.row);
  for (let i = 1; i < holds.length; i++) {
    if (holds[i].row === newHold.row && holds[i].col === newHold.col) return holds[i - 1];
  }
  return null;
}

function moveDifficulty(oldHold, newHold) {
  const level = holdLevels[newHold.row]?.[newHold.col];
  const direction = holdDirections[newHold.row]?.[newHold.col];
  if (level === -1 || level == null || direction === -1 || direction == null) return null;

  const dist = distance(oldHold, newHold);
  const holdScore = holdWeights[level];
  const dirScore = directionWeights[direction];
  const oldDir = holdDirections[oldHold.row]?.[oldHold.col];
  if (oldDir == null) return null;

  let bonus = 0;
  if (oldHold.col < newHold.col) bonus = bonusLeft(oldDir, direction);
  if (oldHold.col > newHold.col) bonus = bonusRight(oldDir, direction);
  return dist + holdScore + (dirScore + bonus);
}

/* -----------------------------
   ADAPTIVE HOLD SELECTION LOGIC
----------------------------- */

const MAX_REACH = 6;
const MAX_UP = 4;

function getCandidateHolds(currentHold, route) {
  const candidates = [];

  for (let r = 0; r < route.grid.length; r++) {
    for (let c = 0; c < route.grid[r].length; c++) {
      if (route.grid[r][c] === null) continue;

      const dx = c - currentHold.col;
      const dy = r - currentHold.row;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (
        r <= currentHold.row &&
        r >= currentHold.row - MAX_UP &&
        dist > 0 &&
        dist <= MAX_REACH
      ) {
        candidates.push({ row: r, col: c, dist });
      }
    }
  }

  return candidates;
}

function evaluateCandidates(prevHold, candidates) {
  return candidates
    .map(c => {
      const diff = moveDifficulty(prevHold, c);
      if (diff === null) return null;
      return { ...c, difficulty: diff };
    })
    .filter(Boolean);
}

function pickAdaptiveHold(candidates, lastMoveDifficulty) {
  if (!candidates.length) return null;

  const TARGET = 5.5;
  candidates.sort((a, b) => a.difficulty - b.difficulty);

  let chosen;
  if (lastMoveDifficulty < TARGET - 1) {
    chosen = candidates[Math.floor(candidates.length * 0.75)];
  } else if (lastMoveDifficulty > TARGET + 1) {
    chosen = candidates[Math.floor(candidates.length * 0.25)];
  } else {
    chosen = candidates[Math.floor(candidates.length * 0.5)];
  }

  return chosen;
}

/* -----------------------------
   API: ADAPTIVE NEXT HOLD
----------------------------- */
app.post('/api/adaptive-next-hold', async (req, res) => {
  try {
    const { climbId, currentHold, previousHold, lastMoveDifficulty } = req.body;

    let file = path.join(routesDir, `${climbId}.json`);
    if (!fs.existsSync(file)) {
      file = path.join(climbsDir, `${climbId}.json`);
    }
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'Route not found' });
    }

    const route = await fs.readJson(file);
    const candidates = getCandidateHolds(currentHold, route);
    const evaluated = evaluateCandidates(previousHold, candidates);

    if (!evaluated.length) {
      return res.status(400).json({ error: 'No valid candidates' });
    }

    const chosen = pickAdaptiveHold(evaluated, lastMoveDifficulty);

    res.json({
      chosenHold: chosen,
      allCandidates: evaluated.sort((a, b) => a.difficulty - b.difficulty)
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Adaptive selection failed");
  }
});

/* -----------------------------
   API: BEHAVIOR DIFFICULTY (RENAMED)
----------------------------- */
app.post('/api/behavior-difficulty', (req, res) => {
  const { meta } = req.body;

  const positions = meta?.positions || [];
  const duration = (meta?.duration || 0) / 1000;
  const dt = (meta?.dt || 500) / 1000;

  const adjustment = computeAdjustment(positions);
  const timeToStable = computeTimeToStable(positions, dt);
  const smoothness = computeSmoothness(positions);
  const hesitation = Math.max(0, duration - timeToStable);

  const normStable = clamp(timeToStable / 1.5, 0, 1);
  const normAdjust = clamp(adjustment / 50, 0, 1);
  const normHesitation = clamp(hesitation / 2, 0, 1);
  const normSmooth = 1 - clamp(smoothness / 20, 0, 1);

  let difficulty =
    0.35 * normStable +
    0.30 * normAdjust +
    0.20 * normHesitation +
    0.15 * normSmooth;

  difficulty = clamp(difficulty * 10, 0, 10);

  res.json({ difficulty });
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function computeAdjustment(positions) {
  let total = 0;
  for (let i = 1; i < positions.length; i++) {
    const dx = positions[i].x - positions[i - 1].x;
    const dy = positions[i].y - positions[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

function computeTimeToStable(positions, dt) {
  if (positions.length < 5) return dt;

  for (let i = 3; i < positions.length; i++) {
    let movement = 0;
    for (let j = i - 3; j < i; j++) {
      const dx = positions[j].x - positions[j - 1].x;
      const dy = positions[j].y - positions[j - 1].y;
      movement += Math.hypot(dx, dy);
    }
    if (movement < 5) {
      return (i / positions.length) * dt;
    }
  }
  return dt;
}

function computeSmoothness(positions) {
  let total = 0;
  for (let i = 2; i < positions.length; i++) {
    const dx1 = positions[i - 1].x - positions[i - 2].x;
    const dy1 = positions[i - 1].y - positions[i - 2].y;
    const dx2 = positions[i].x - positions[i - 1].x;
    const dy2 = positions[i].y - positions[i - 1].y;
    total += Math.hypot(dx2 - dx1, dy2 - dy1);
  }
  return total;
}

/* -----------------------------
   API: ROUTES
----------------------------- */
app.post('/api/routes', async (req, res) => {
  try {
    const id = uuidv4();
    const route = { ...req.body, id };
    await fs.writeJson(path.join(routesDir, `${id}.json`), route, { spaces: 2 });

    let index = await fs.readJson(routesIndexFile);
    index.push({ id, name: route.name, grade: route.grade, timestamp: Date.now() });
    await fs.writeJson(routesIndexFile, index, { spaces: 2 });
    res.json({ id });
  } catch (err) {
    res.status(500).send("Failed to save route");
  }
});

app.get('/api/routes', async (req, res) => {
  const index = await fs.readJson(routesIndexFile);
  res.json(index);
});

app.get('/api/routes/:id', async (req, res) => {
  const file = path.join(routesDir, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(await fs.readJson(file));
});

/* -----------------------------
   DELETE ROUTES
----------------------------- */
app.delete('/api/routes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await fs.remove(path.join(routesDir, `${id}.json`));

    let index = await fs.readJson(routesIndexFile);
    index = index.filter(i => i.id !== id);
    await fs.writeJson(routesIndexFile, index, { spaces: 2 });

    res.json({ success: true });
  } catch (err) {
    res.status(500).send("Delete Error");
  }
});

/* -----------------------------
   API: CLIMBS
----------------------------- */
app.post('/api/climbs', async (req, res) => {
  try {
    const id = uuidv4();
    const climb = { ...req.body, id };

    let completed = false;

    if (climb.routeId) {
      const routeFile = path.join(routesDir, `${climb.routeId}.json`);
      if (fs.existsSync(routeFile)) {
        const route = await fs.readJson(routeFile);

        let endHold = null;
        route.grid.forEach((row, r) => {
          row.forEach((cell, c) => {
            if (cell === "#F44336") endHold = { row: r, col: c };
          });
        });

        const lastMove = climb.filledSequence?.[climb.filledSequence.length - 1];
        if (endHold && lastMove &&
            lastMove.row === endHold.row &&
            lastMove.col === endHold.col) {
          completed = true;
        }
      }
    }

    climb.completed = completed;
    await fs.writeJson(path.join(climbsDir, `${id}.json`), climb, { spaces: 2 });

    const moveCount = (climb.filledSequence && Array.isArray(climb.filledSequence))
      ? climb.filledSequence.length : 0;

    let index = await fs.readJson(climbsIndexFile);
    index.push({
      id,
      routeId: climb.routeId,
      name: climb.name || "Unnamed Attempt",
      routeName: climb.routeName || "N/A",
      timestamp: climb.timestamp || Date.now(),
      moveCount,
      completed
    });

    await fs.writeJson(climbsIndexFile, index, { spaces: 2 });
    res.json({ id });
  } catch (err) {
    console.error("Save Error:", err);
    res.status(500).send("Failed to save climb");
  }
});

app.get('/api/climbs', async (req, res) => {
  const index = await fs.readJson(climbsIndexFile);
  res.json(index);
});

app.get('/api/climbs/:id', async (req, res) => {
  const file = path.join(climbsDir, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(await fs.readJson(file));
});

/* -----------------------------
   DELETE CLIMB
----------------------------- */
app.delete('/api/climbs/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const file = path.join(climbsDir, `${id}.json`);

    if (fs.existsSync(file)) {
      await fs.remove(file);
    }

    let index = await fs.readJson(climbsIndexFile);
    index = index.filter(i => i.id !== id);
    await fs.writeJson(climbsIndexFile, index, { spaces: 2 });

    res.json({ success: true });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).send("Failed to delete climb");
  }
});

/* -----------------------------
   API: HOLD-BASED DIFFICULTY
----------------------------- */
app.post('/api/difficulty', async (req, res) => {
  const { climbId, newHold, oldHold: clientOldHold } = req.body;
  const level = holdLevels[newHold.row]?.[newHold.col];
  if (level === -1 || level == null) return res.status(400).json({ error: 'Invalid hold' });

  let file = path.join(climbsDir, `${climbId}.json`);
  if (!fs.existsSync(file)) file = path.join(routesDir, `${climbId}.json`);

  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Source not found' });

  const route = await fs.readJson(file);
  let oldHold = clientOldHold || findPreviousHold(route, newHold);
  if (!oldHold) return res.status(400).json({ error: 'Previous hold not found' });

  const diff = moveDifficulty(oldHold, newHold);
  if (diff == null) return res.status(400).json({ error: 'Difficulty could not be computed' });

  res.json({ oldHold, newHold, difficulty: diff });
});

app.get('/api/holddifficulty', (req, res) => res.json(holdData));

/* -----------------------------
   API: GENERATED NEXT HOLD
----------------------------- */
app.post('/api/generate-next-hold', async (req, res) => {
  try {
    const { climbId, currentHold, previousHold, predictedDifficulty } = req.body;

    let file = path.join(routesDir, `${climbId}.json`);
    if (!fs.existsSync(file)) {
      file = path.join(climbsDir, `${climbId}.json`);
    }
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'Route not found' });
    }

    const route = await fs.readJson(file);

    const candidates = getCandidateHolds(currentHold, route);
    const evaluated = evaluateCandidates(previousHold, candidates);
    if (!evaluated.length) {
      return res.status(400).json({ error: 'No valid candidates' });
    }

    const prevDiff = moveDifficulty(previousHold, currentHold);
    if (prevDiff == null) {
      return res.status(400).json({ error: 'Previous move difficulty unavailable' });
    }

    let targetDifficulty = prevDiff;
    if (typeof predictedDifficulty === 'number') {
      if (predictedDifficulty > prevDiff) {
        targetDifficulty += 1.0;
      } else if (predictedDifficulty < prevDiff) {
        targetDifficulty -= 1.0;
      }
    }

    evaluated.sort((a, b) =>
      Math.abs(a.difficulty - targetDifficulty) -
      Math.abs(b.difficulty - targetDifficulty)
    );

    const chosen = evaluated[0];

    const generatedFile = path.join(generatedDir, `${climbId}.json`);
    await fs.writeJson(generatedFile, {
      climbId,
      chosenHold: chosen,
      currentHold,
      previousHold,
      predictedDifficulty,
      targetDifficulty,
      timestamp: Date.now()
    }, { spaces: 2 });

    res.json({
      chosenHold: chosen,
      allCandidates: evaluated
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to generate next hold");
  }
});

/* -----------------------------
   DIGITAL TWIN HELPERS
----------------------------- */

function getSortedRouteHolds(route) {
  const holds = [];
  route.grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell !== null) holds.push({ row: r, col: c, color: cell });
    });
  });
  return holds.sort((a, b) => b.row - a.row);
}

app.get('/api/twin/:climbId', async (req, res) => {
  try {
    const climbId = req.params.climbId;
    const attempt = await fs.readJson(path.join(climbsDir, `${climbId}.json`));

    const routeId = attempt.routeId;
    if (!routeId) return res.status(400).json({ error: "Attempt has no associated routeId" });

    const route = await fs.readJson(path.join(routesDir, `${routeId}.json`));

    const crux = findCrux(route, attempt);
    if (!crux) return res.json({ message: "Route completed! No twin needed.", route });

    const offsets = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
    let bestOption = { ...crux.targetHold, difficulty: 999 };

    for (const [dr, dc] of offsets) {
      const nr = crux.targetHold.row + dr;
      const nc = crux.targetHold.col + dc;

      if (nr < 0 || nc < 0) continue;
      if (!holdLevels[nr] || holdLevels[nr][nc] == null) continue;
      if (holdLevels[nr][nc] === -1) continue;

      const diff = moveDifficulty(crux.previousHold, { row: nr, col: nc });
      if (diff !== null && diff < bestOption.difficulty) {
        bestOption = { row: nr, col: nc, difficulty: diff };
      }
    }

    const twinRoute = JSON.parse(JSON.stringify(route));
    twinRoute.grid[crux.targetHold.row][crux.targetHold.col] = null;
    twinRoute.grid[bestOption.row][bestOption.col] = "#00FFFF";
    twinRoute.name = `${route.name} (Twin Optimized)`;
    twinRoute.isTwin = true;
    twinRoute.originalTarget = crux.targetHold;

    res.json(twinRoute);
  } catch (err) {
    console.error(err);
    res.status(500).send("Twin Generation Failed");
  }
});

function findCrux(route, attempt) {
  const routeHolds = [];
  route.grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell !== null) {
        routeHolds.push({ row: r, col: c, color: cell });
      }
    });
  });

  if (routeHolds.length === 0) return null;

  const attemptHolds = attempt.filledSequence || [];
  const successfulMoves = attemptHolds.filter(h => h.onRoute);

  let highestRowReached = 18;
  let lastSuccessfulHold = { row: 18, col: 8 };

  if (successfulMoves.length > 0) {
    const highestMove = successfulMoves.reduce((prev, curr) =>
      (curr.row < prev.row) ? curr : prev
    );
    highestRowReached = highestMove.row;
    lastSuccessfulHold = highestMove;
  }

  let remainingHolds = routeHolds
    .filter(h => h.row < highestRowReached)
    .sort((a, b) => b.row - a.row);

  if (remainingHolds.length === 0) {
    const allSorted = [...routeHolds].sort((a, b) => b.row - a.row);
    const lowestRouteHold = allSorted[0];

    return {
      targetHold: lowestRouteHold,
      previousHold: { row: 18, col: 8 }
    };
  }

  return {
    targetHold: remainingHolds[0],
    previousHold: lastSuccessfulHold
  };
}

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
