const express = require('express');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' })); // Give the skeletons room to breathe
app.use(express.static('public'));

/* -----------------------------
   PATHS & DIRECTORIES
----------------------------- */
const dataDir = path.join(__dirname, 'data');
const climbsDir = path.join(dataDir, 'climbs');
const routesDir = path.join(dataDir, 'routes'); // NEW: Dedicated routes folder
const climbsIndexFile = path.join(dataDir, 'index.json'); // Attempts index
const routesIndexFile = path.join(dataDir, 'routes_index.json'); // NEW: Routes index
const holdDifficultyFile = path.join(dataDir, 'holddifficulty.json');

// Ensure all folders and index files exist
fs.ensureDirSync(climbsDir);
fs.ensureDirSync(routesDir);
if (!fs.existsSync(climbsIndexFile)) fs.writeJsonSync(climbsIndexFile, []);
if (!fs.existsSync(routesIndexFile)) fs.writeJsonSync(routesIndexFile, []);

/* -----------------------------
   LOAD HOLD DIFFICULTY (Your Math Data)
----------------------------- */
const holdData = fs.readJsonSync(holdDifficultyFile);
const holdLevels = holdData["Hold difficulty level"];
const holdDirections = holdData["Hold Direction"];
const holdWeights = Object.fromEntries(holdData["Hold difficulty weight"]);
const directionWeights = Object.fromEntries(holdData["Hold direction difficulty weight"]);

/* -----------------------------
   CLIMBING PHYSICS (Your Original Logic)
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
  const level = holdLevels[newHold.row][newHold.col];
  const direction = holdDirections[newHold.row][newHold.col];
  if (level === -1 || direction === -1) return null;
  const dist = distance(oldHold, newHold);
  const holdScore = holdWeights[level];
  const dirScore = directionWeights[direction];
  const oldDir = holdDirections[oldHold.row][oldHold.col];
  let bonus = 0;
  if (oldHold.col < newHold.col) bonus = bonusLeft(oldDir, direction);
  if (oldHold.col > newHold.col) bonus = bonusRight(oldDir, direction);
  return dist + holdScore + (dirScore + bonus);
}

/* -----------------------------
   API: ROUTES (The Setter)
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
    // 1. Delete the route file
    await fs.remove(path.join(routesDir, `${id}.json`));

    // 2. Update the routes index
    let index = await fs.readJson(routesIndexFile);
    index = index.filter(i => i.id !== id);
    await fs.writeJson(routesIndexFile, index, { spaces: 2 });

    res.json({ success: true });
  } catch (err) {
    res.status(500).send("Delete Error");
  }
});


/* -----------------------------
   API: CLIMBS (The Attempts)
----------------------------- */
app.post('/api/climbs', async (req, res) => {
  try {
    const id = uuidv4();
    const climb = { ...req.body, id };

    // --- SUCCESS CHECK LOGIC ---
    let completed = false;
    
    // 1. Get the original route to find the 'End' hold
    if (climb.routeId) {
      const routeFile = path.join(routesDir, `${climb.routeId}.json`);
      if (fs.existsSync(routeFile)) {
        const route = await fs.readJson(routeFile);
        
        // 2. Find the Red (#F44336) hold in the original route grid
        let endHold = null;
        route.grid.forEach((row, r) => {
          row.forEach((cell, c) => {
            if (cell === "#F44336") endHold = { row: r, col: c };
          });
        });

        // 3. Check if the user's last move matches that hold
        const lastMove = climb.filledSequence[climb.filledSequence.length - 1];
        if (endHold && lastMove && 
            lastMove.row === endHold.row && 
            lastMove.col === endHold.col) {
          completed = true;
        }
      }
    }

    // Attach the result to the climb object
    climb.completed = completed;
    await fs.writeJson(path.join(climbsDir, `${id}.json`), climb, { spaces: 2 });

    // Update the index with the 'completed' flag
    const moveCount = (climb.filledSequence && Array.isArray(climb.filledSequence)) 
                      ? climb.filledSequence.length : 0;

    let index = await fs.readJson(climbsIndexFile);
    index.push({
      id,
      routeId: climb.routeId, // Crucial for Twin generation later
      name: climb.name || "Unnamed Attempt",
      routeName: climb.routeName || "N/A",
      timestamp: climb.timestamp || Date.now(),
      moveCount: moveCount,
      completed: completed // Now saved in index for fast UI loading
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

    // 1. Remove the detail file
    if (fs.existsSync(file)) {
      await fs.remove(file);
    }

    // 2. Remove from the index
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
   API: DIFFICULTY (The Logic)
----------------------------- */
app.post('/api/difficulty', async (req, res) => {
  const { climbId, newHold, oldHold: clientOldHold } = req.body;
  const level = holdLevels[newHold.row][newHold.col];
  if (level === -1 || level === null) return res.status(400).json({ error: 'Invalid hold' });

  // Search in both folders to be safe
  let file = path.join(climbsDir, `${climbId}.json`);
  if (!fs.existsSync(file)) file = path.join(routesDir, `${climbId}.json`);
  
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Source not found' });

  const route = await fs.readJson(file);
  let oldHold = clientOldHold || findPreviousHold(route, newHold);
  if (!oldHold) return res.status(400).json({ error: 'Previous hold not found' });

  res.json({ oldHold, newHold, difficulty: moveDifficulty(oldHold, newHold) });
});

app.get('/api/holddifficulty', (req, res) => res.json(holdData));

app.listen(3000, () => console.log('Server running on http://localhost:3000'));




/* -----------------------------
   DIGITAL TWIN HELPERS
----------------------------- */

// Helper to get all holds from a route grid, sorted bottom to top
function getSortedRouteHolds(route) {
    const holds = [];
    route.grid.forEach((row, r) => {
        row.forEach((cell, c) => {
            if (cell !== null) holds.push({ row: r, col: c, color: cell });
        });
    });
    return holds.sort((a, b) => b.row - a.row);
}

// The core "Twin" API
app.get('/api/twin/:climbId', async (req, res) => {
    try {
        const climbId = req.params.climbId;
        const attempt = await fs.readJson(path.join(climbsDir, `${climbId}.json`));
        
        // We need the original route to know what the user was TRYING to do
        // Assumes your climb object stores the routeId it was based on
        const routeId = attempt.routeId; 
        if (!routeId) return res.status(400).json({ error: "Attempt has no associated routeId" });
        
        const route = await fs.readJson(path.join(routesDir, `${routeId}.json`));

        const crux = findCrux(route, attempt);
        if (!crux) return res.json({ message: "Route completed! No twin needed.", route });

        // Search 8 neighbors for an easier move
        const offsets = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
        let bestOption = { ...crux.targetHold, difficulty: 999 };

        for (const [dr, dc] of offsets) {
            const nr = crux.targetHold.row + dr;
            const nc = crux.targetHold.col + dc;

            // Stay within grid and avoid invalid holds
            if (holdLevels[nr] && holdLevels[nr][nc] !== -1 && holdLevels[nr][nc] !== undefined) {
                const diff = moveDifficulty(crux.previousHold, { row: nr, col: nc });
                if (diff !== null && diff < bestOption.difficulty) {
                    bestOption = { row: nr, col: nc, difficulty: diff };
                }
            }
        }

        // Create the mutated "Twin" Route
        const twinRoute = JSON.parse(JSON.stringify(route)); // Clone
        // Swap the target hold for the better neighbor
        twinRoute.grid[crux.targetHold.row][crux.targetHold.col] = null;
        twinRoute.grid[bestOption.row][bestOption.col] = "#00FFFF"; // Electric Cyan
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
    // 1. Extract all valid holds from the original route grid
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
    
    // 2. Filter for 'onRoute' to find where the climber actually succeeded
    const successfulMoves = attemptHolds.filter(h => h.onRoute);
    
    let highestRowReached = 18; // Default to just below the grid (the floor)
    let lastSuccessfulHold = { row: 18, col: 8 }; // Default "ground" starting point

    if (successfulMoves.length > 0) {
        // Find the move with the minimum row value (the highest physical point reached)
        const highestMove = successfulMoves.reduce((prev, curr) => 
            (curr.row < prev.row) ? curr : prev
        );
        highestRowReached = highestMove.row;
        lastSuccessfulHold = highestMove;
    }

    // 3. Find the "Target": The closest route hold ABOVE the highest reached point
    // We look for route holds where row < highestRowReached
    let remainingHolds = routeHolds
        .filter(h => h.row < highestRowReached)
        .sort((a, b) => b.row - a.row); // Sort so the lowest-down of the "higher" holds is index 0

    // 4. FALLBACK LOGIC: If they couldn't even start or the "above" search is empty
    if (remainingHolds.length === 0) {
        // Sort all route holds from bottom to top
        const allSorted = [...routeHolds].sort((a, b) => b.row - a.row);
        const lowestRouteHold = allSorted[0];

        // If the user is currently at or below the lowest hold, target that lowest hold
        // This helps users who can't even get off the ground.
        return {
            targetHold: lowestRouteHold,
            previousHold: { row: 18, col: 8 } // Ground level launchpad
        };
    }

    // 5. SUCCESS: Return the hold they missed and the one they launched from
    return {
        targetHold: remainingHolds[0], // The next logical step they failed to reach
        previousHold: lastSuccessfulHold
    };
}
