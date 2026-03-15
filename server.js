const express = require('express');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const dataDir = path.join(__dirname, 'data');
const climbsDir = path.join(dataDir, 'climbs');
const indexFile = path.join(dataDir, 'index.json');
const holdDifficultyFile = path.join(dataDir, 'holddifficulty.json');

fs.ensureDirSync(climbsDir);
if (!fs.existsSync(indexFile)) fs.writeJsonSync(indexFile, []);

/* -----------------------------
LOAD HOLD DIFFICULTY
----------------------------- */

const holdData = fs.readJsonSync(holdDifficultyFile);

const holdLevels = holdData["Hold difficulty level"];
const holdDirections = holdData["Hold Direction"];
const holdWeights = Object.fromEntries(holdData["Hold difficulty weight"]);
const directionWeights = Object.fromEntries(holdData["Hold direction difficulty weight"]);

/* -----------------------------
DISTANCE (NONLINEAR)
----------------------------- */

function distance(a, b) {

  const dx = a.col - b.col;
  const dy = a.row - b.row;

  const d = Math.sqrt(dx * dx + dy * dy);

  return Math.pow(d, 1.6);
}

/* -----------------------------
BONUS RULES
----------------------------- */

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

/* -----------------------------
FIND PREVIOUS HOLD IN ROUTE
----------------------------- */

function findPreviousHold(route, newHold) {

  const holds = [];

  for (let r = 0; r < route.grid.length; r++) {
    for (let c = 0; c < route.grid[r].length; c++) {

      if (route.grid[r][c] !== null) {
        const level = holdLevels[r][c];
        if (level !== -1) {
          holds.push({ row: r, col: c });
        }
      }

    }
  }

  // FIX: sort bottom → top
  holds.sort((a, b) => b.row - a.row);

  for (let i = 1; i < holds.length; i++) {
    if (holds[i].row === newHold.row && holds[i].col === newHold.col) {
      return holds[i - 1];
    }
  }

  return null;
}

/* -----------------------------
MOVE DIFFICULTY
----------------------------- */

function moveDifficulty(oldHold, newHold) {

  const level = holdLevels[newHold.row][newHold.col];
  const direction = holdDirections[newHold.row][newHold.col];

  if (level === -1 || direction === -1)
    return null;

  const dist = distance(oldHold, newHold);

  const holdScore = holdWeights[level];
  const dirScore = directionWeights[direction];

  const oldDir = holdDirections[oldHold.row][oldHold.col];

  let bonus = 0;

  if (oldHold.col < newHold.col)
    bonus = bonusLeft(oldDir, direction);

  if (oldHold.col > newHold.col)
    bonus = bonusRight(oldDir, direction);

  return dist + holdScore + (dirScore + bonus);
}

/* -----------------------------
API: DIFFICULTY CALCULATION
----------------------------- */

app.post('/api/difficulty', async (req, res) => {
  const { climbId, newHold, oldHold: clientOldHold } = req.body;

  const level = holdLevels[newHold.row][newHold.col];
  const direction = holdDirections[newHold.row][newHold.col];

  if (level === -1 || level === null || direction === -1 || direction === null) {
    return res.status(400).json({ error: 'New hold is not a valid hold' });
  }

  const file = path.join(climbsDir, `${climbId}.json`);

  if (!fs.existsSync(file))
    return res.status(404).json({ error: 'Climb not found' });

  const route = await fs.readJson(file);

  // Use client-provided oldHold OR find it normally
  let oldHold = clientOldHold;
  if (!oldHold) {
    oldHold = findPreviousHold(route, newHold);
    if (!oldHold)
      return res.status(400).json({ error: 'Previous hold not found' });
  }

  const difficulty = moveDifficulty(oldHold, newHold);

  res.json({
    oldHold,
    newHold,
    difficulty
  });
});


/* -----------------------------
CREATE climb
----------------------------- */

app.post('/api/climbs', async (req, res) => {

  const id = uuidv4();
  const climb = { ...req.body, id };

  await fs.writeJson(path.join(climbsDir, `${id}.json`), climb, { spaces: 2 });

  const index = await fs.readJson(indexFile);

  index.push({
    id,
    name: climb.name,
    grade: climb.grade,
    angle: climb.angle,
    tags: climb.tags || [],
    features: climb.features || []
  });

  await fs.writeJson(indexFile, index, { spaces: 2 });

  res.json({ id });
});

/* -----------------------------
UPDATE climb
----------------------------- */

app.put('/api/climbs/:id', async (req, res) => {

  const id = req.params.id;
  const file = path.join(climbsDir, `${id}.json`);

  if (!fs.existsSync(file))
    return res.status(404).json({ error: 'Not found' });

  const climb = { ...req.body, id };

  await fs.writeJson(file, climb, { spaces: 2 });

  let index = await fs.readJson(indexFile);

  index = index.map(i =>
    i.id === id
      ? { id, name: climb.name, grade: climb.grade, angle: climb.angle, tags: climb.tags || [], features: climb.features || [] }
      : i
  );

  await fs.writeJson(indexFile, index, { spaces: 2 });

  res.json({ success: true });
});

/* -----------------------------
GET index
----------------------------- */

app.get('/api/climbs', async (req, res) => {
  const index = await fs.readJson(indexFile);
  res.json(index);
});

/* -----------------------------
GET single climb
----------------------------- */

app.get('/api/climbs/:id', async (req, res) => {

  const file = path.join(climbsDir, `${req.params.id}.json`);

  if (!fs.existsSync(file))
    return res.status(404).json({ error: 'Not found' });

  const climb = await fs.readJson(file);

  res.json(climb);
});

/* ----------------------------- */

app.listen(3000, () =>
  console.log('Server running on http://localhost:3000')
);

/* -----------------------------
get holddifficulty data
----------------------------- */
app.get('/api/holddifficulty', (req, res) => {
  res.json(holdData);
});