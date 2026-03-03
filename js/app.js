/* ================================================================================
   MODULE 1: CONFIGURATION & GLOBAL STATE
   Description: Holds constants, style settings, and the app's living state.
================================================================================
*/
// At the top of MODULE 1: CONFIGURATION & GLOBAL STATE
const draftClimb = JSON.parse(sessionStorage.getItem('draft') || '{}');

let GRID_ROWS = draftClimb.rows || 5;
let GRID_COLS = draftClimb.columns || 5;

const climbNameDiv = document.getElementById("climbName");
if (draftClimb.name && climbNameDiv) {
  climbNameDiv.textContent = `CLIMB: ${draftClimb.name.toUpperCase()} - CLIMBER: ALEX`;
}

const camWidth = 1280;
const camHeight = 720;
const HOLD_DURATION = 1000;

let CONFIDENCE_THRESHOLD = 0.5;
let autoMode = false;
let latestBuffer = null;
let appActive = false;
let reviewMode = false;
let moveCounter = 0;

let cachedH = null;
let cachedHinv = null;
let gridNeedsUpdate = true; // Flag to trigger recalculation
let lastSentBuffer = new Uint8Array(8).fill(255); // To throttle BLE
let frameCounter = 0; // To throttle UI text updates

// Pre-allocate limb objects to avoid Garbage Collection (GC) churn
const LIMB_KEYS = ["leftHand", "rightHand", "leftFoot", "rightFoot"];
const LIMB_LANDMARKS = [15, 16, 27, 28];

// Grid corners for perspective warping
let corners = [
  { x: 200, y: 200 },
  { x: camWidth - 200, y: 200 },
  { x: camWidth - 200, y: camHeight - 200 },
  { x: 200, y: camHeight - 200 },
];

// Tracking limb status
let holdTimers = {
  leftHand: { currentKey: null, start: 0 },
  rightHand: { currentKey: null, start: 0 },
  leftFoot: { currentKey: null, start: 0 },
  rightFoot: { currentKey: null, start: 0 },
};

let filledCells = {
  leftHand: {},
  rightHand: {},
  leftFoot: {},
  rightFoot: {},
};

let speedHistory = {
  leftHand: [],
  rightHand: [],
  leftFoot: [],
  rightFoot: [],
};

let filledSequence = [];

// UI Colors
const LIMB_COLORS = {
  leftHand: "rgba(180,100,100,0.4)",
  rightHand: "rgba(100,100,180,0.4)",
  leftFoot: "rgba(100,180,100,0.4)",
  rightFoot: "rgba(180,180,100,0.4)",
};

const FILLED_COLORS = {
  leftHand: "rgba(180,100,100,0.25)",
  rightHand: "rgba(100,100,180,0.25)",
  leftFoot: "rgba(100,180,100,0.25)",
  rightFoot: "rgba(180,180,100,0.25)",
};
/* ================================================================================
   MODULE 2: DOM ELEMENTS & UI INITIALIZATION
   Description: References to HTML elements used across the script.
================================================================================
*/

const videoElement = document.querySelector(".input_video");
const canvas = document.querySelector(".output_canvas");
const ctx = canvas.getContext("2d");

const topBar = document.querySelector(".top-controls");
const bottomBar = document.querySelector(".bottom-controls");
const resetBtn = document.getElementById("resetBtn");
const gridInput = document.getElementById("gridSize");
const confValDisplay = document.getElementById("confVal");

// Setup Canvas Size
canvas.width = camWidth;
canvas.height = camHeight;
canvas.style.width = "100vw";
canvas.style.height = "auto";

/* ================================================================================
   MODULE 3: MATH & PERSPECTIVE UTILITIES
   Description: OpenCV-based homography and point transformations.
================================================================================
*/

let cvReady = false;
cv["onRuntimeInitialized"] = () => {
  cvReady = true;
  console.log("OpenCV.js is ready.");
};

function updateHomographies() {
  if (!cvReady) return; // Safety check

  // 1. Cleanup old matrices to prevent memory leaks in the WASM heap
  if (cachedH) cachedH.delete();
  if (cachedHinv) cachedHinv.delete();

  let src, dst;
  try {
    src = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y,
    ]);
    dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1, 0, 1, 1, 0, 1]);
    
    cachedH = cv.getPerspectiveTransform(src, dst);
    cachedHinv = cv.getPerspectiveTransform(dst, src);
  } catch (err) {
    console.error("Homography calculation failed:", err);
  } finally {
    // 2. Always delete temporary matrices to free memory
    if (src) src.delete();
    if (dst) dst.delete();
    gridNeedsUpdate = false;
  }
}

function warpPoint(H, x, y) {
  if (!H) return { x: 0, y: 0 };
  const src = cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
  const dst = new cv.Mat();
  cv.perspectiveTransform(src, dst, H);
  const out = { x: dst.data32F[0], y: dst.data32F[1] };
  src.delete();
  dst.delete();
  return out;
}

function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

/* ================================================================================
   MODULE 4: HARDWARE & EXTERNAL INTEGRATIONS (BLE, AR, Pose)
   Description: Connects to ESP32, AR.js markers, and MediaPipe.
================================================================================
*/

// --- BLE ---
let device, characteristic;
async function connectBLE() {
  device = await navigator.bluetooth.requestDevice({
    filters: [{ name: "ESP32_LED_GRID" }],
    optionalServices: ["12345678-1234-1234-1234-1234567890ab"],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(
    "12345678-1234-1234-1234-1234567890ab",
  );
  characteristic = await service.getCharacteristic(
    "abcdefab-1234-1234-1234-abcdefabcdef",
  );
  console.log("Connected to ESP32 via BLE");
}

// --- MediaPipe Pose ---
const pose = new Pose({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
pose.onResults(onResults);
const cameraMP = new Camera(videoElement, {
  onFrame: async () => {
    await pose.send({ image: videoElement });
  },
  width: camWidth,
  height: camHeight,
});

function startDetection() {
  cameraMP.start();
}

// --- AR.js ---
let arToolkitSource,
  arToolkitContext,
  markers = {};
function initAR() {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(camera);
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(camWidth, camHeight);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = "0px";
  renderer.domElement.style.left = "0px";
  renderer.domElement.style.pointerEvents = "none";
  document.body.appendChild(renderer.domElement);

  arToolkitSource = new THREEx.ArToolkitSource({
    sourceType: "webcam",
    sourceWidth: camWidth,
    sourceHeight: camHeight,
  });
  arToolkitSource.init(() => onResize());
  window.addEventListener("resize", () => onResize());

  function onResize() {
    arToolkitSource.onResizeElement();
    arToolkitSource.copyElementSizeTo(renderer.domElement);
    if (arToolkitContext.arController)
      arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
  }

  arToolkitContext = new THREEx.ArToolkitContext({
    cameraParametersUrl:
      "https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat",
    detectionMode: "mono",
  });
  arToolkitContext.init(() =>
    camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()),
  );

  ["../markers/marker0.patt", "../markers/marker1.patt", "../markers/marker2.patt", "../markers/marker3.patt"].forEach(
    (id, index) => {
      const markerRoot = new THREE.Group();
      scene.add(markerRoot);
      markers[index] = markerRoot;
      new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
        type: "pattern",
        patternUrl: id,
      });
    },
  );

  function render() {
    requestAnimationFrame(render);
    if (arToolkitSource.ready)
      arToolkitContext.update(arToolkitSource.domElement);

    if (appActive && autoMode) {
      Object.keys(markers).forEach((i) => {
        const m = markers[i];
        if (!m || !m.visible) return;
        
        const projected = m.position.clone().project(camera);
        
        // Calculate screen position (Mirror-compatible)
        let screenX = canvas.width * (1 - (projected.x + 1) / 2);
        let screenY = canvas.height * (1 - (projected.y + 1) / 2);

        // --- COMPLETE MAPPING ---
        // Map Marker ID (i) to the correct Corner Index
        let targetIndex = i;
        if (i == "0") targetIndex = 1; // Marker 0 -> Top-Right
        if (i == "1") targetIndex = 0; // Marker 1 -> Top-Left
        if (i == "2") targetIndex = 3; // Marker 2 -> Bottom-Left
        if (i == "3") targetIndex = 2; // Marker 3 -> Bottom-Right
        // -------------------------
        
        if (corners[targetIndex]) {
          corners[targetIndex].x = screenX;
          corners[targetIndex].y = screenY;
          gridNeedsUpdate = true; 
        }
      });
    }
    renderer.render(scene, camera);
  }
  render();
}
initAR();

/* ================================================================================
   MODULE 5: CORE APP LOGIC (GRID, POSES & SPEED)
   Description: Drawing the grid, processing landmarks, and tracking speeds.
================================================================================
*/

const hoverScales = new Array(corners.length).fill(0);
let dragging = null;
let hoverIndex = null;

function detectHover(pos) {
  hoverIndex = null;
  corners.forEach((c, i) => {
    if (Math.hypot(pos.x - c.x, pos.y - c.y) < 15) hoverIndex = i;
  });
}

function drawPerspectiveGrid(Hinv) {
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;

  // Horizontal lines (rows)
  for (let i = 0; i <= GRID_ROWS; i++) {
    ctx.beginPath();
    for (let j = 0; j <= GRID_COLS; j++) {
      const p = warpPoint(Hinv, j / GRID_COLS, i / GRID_ROWS);
      if (j === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Vertical lines (columns)
  for (let j = 0; j <= GRID_COLS; j++) {
    ctx.beginPath();
    for (let i = 0; i <= GRID_ROWS; i++) {
      const p = warpPoint(Hinv, j / GRID_COLS, i / GRID_ROWS);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  const animationStep = 0.25;
  corners.forEach((c, i) => {
    if (i === hoverIndex) hoverScales[i] += animationStep;
    else hoverScales[i] -= animationStep;
    if (hoverScales[i] > 1) hoverScales[i] = 1;
    if (hoverScales[i] < 0) hoverScales[i] = 0;
  });

  corners.forEach((c, i) => {
    const radius = 6;
    let innerColor,
      outerColor = null,
      drawOuter = false;
    if (autoMode) innerColor = "#649664";
    else if (i === dragging) {
      innerColor = "#6496C8";
      outerColor = "#6496C8";
      drawOuter = true;
    } else if (i === hoverIndex) {
      innerColor = "#FFFFFF";
      outerColor = "#FFFFFF";
      drawOuter = true;
    } else innerColor = "#FFFFFF";

    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = innerColor;
    ctx.fill();

    if (drawOuter && outerColor) {
      ctx.beginPath();
      const outerRadius = radius + 3 * hoverScales[i];
      ctx.arc(c.x, c.y, outerRadius, 0, 2 * Math.PI);
      ctx.strokeStyle = outerColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

function highlightCell(Hinv, row, col, color) {
  const p1 = warpPoint(Hinv, col / GRID_COLS, row / GRID_ROWS);
  const p2 = warpPoint(Hinv, (col + 1) / GRID_COLS, row / GRID_ROWS);
  const p3 = warpPoint(Hinv, (col + 1) / GRID_COLS, (row + 1) / GRID_ROWS);
  const p4 = warpPoint(Hinv, col / GRID_COLS, (row + 1) / GRID_ROWS);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  ctx.fill();
}

function computeLimbSpeeds() {
  const speeds = {};
  const limbs = ["leftHand", "rightHand", "leftFoot", "rightFoot"];
  limbs.forEach((limb) => {
    const moves = filledSequence.filter((m) => m.limb === limb);
    speeds[limb] = { values: [], avg: 0 };
    if (moves.length >= 2) {
      for (let i = 1; i < moves.length; i++) {
        const prev = moves[i - 1];
        const curr = moves[i];
        const dist = Math.hypot(curr.col - prev.col, curr.row - prev.row);
        const dt = (curr.timestamp - prev.timestamp) / 1000;
        speeds[limb].values.push(dt > 0 ? dist / dt : 0);
      }
      speeds[limb].avg = speeds[limb].values.length
        ? speeds[limb].values.reduce((a, b) => a + b, 0) /
          speeds[limb].values.length
        : 0;
    }
  });
  return speeds;
}

function updateLimbSpeedPanel() {
  const speeds = computeLimbSpeeds();
  let panel = document.getElementById("handSpeedPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "handSpeedPanel";
    panel.style = `position:fixed; top:20px; left:20px; padding:8px 12px; background:rgba(0,0,0,0.6); color:white; border-radius:8px; font-family:appFont; font-size:14px; z-index:1000;`;
    document.body.appendChild(panel);
  }
  Object.keys(speedHistory).forEach((limb) => {
    speedHistory[limb].push(speeds[limb].avg);
    if (speedHistory[limb].length > 50) speedHistory[limb].shift();
  });
  panel.innerHTML = `LH: ${speeds.leftHand.avg.toFixed(2)} moves/sec<br>RH: ${speeds.rightHand.avg.toFixed(2)} moves/sec<br>LF: ${speeds.leftFoot.avg.toFixed(2)} moves/sec<br>RF: ${speeds.rightFoot.avg.toFixed(2)} moves/sec`;
}

function markFilledCell(limb, row, col, duration) {
  const key = `${row},${col}`;
  const now = performance.now();
  if (!filledCells[limb][key]) {
    filledCells[limb][key] = { duration };
    filledSequence.push({
      sequence: ++moveCounter,
      limb,
      row,
      col,
      timestamp: now,
      duration,
    });
  } else {
    const move = filledSequence.find(
      (m) => m.limb === limb && m.row === row && m.col === col,
    );
    if (move) {
      move.duration = Math.max(move.duration, duration);
      filledCells[limb][key].duration = move.duration;
    }
  }
  updateStatsUI();
}

function onResults(results) {
  if (reviewMode || !cvReady || !appActive) return;

  // 1. Draw Video (Canvas operations are already hardware accelerated)
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  // 2. Conditional Math: Only re-calculate if in AutoMode (AR markers moving) 
  // or if a corner was manually dragged.
  if (autoMode || gridNeedsUpdate || !cachedH) {
    updateHomographies();
  }

  // 3. Draw Static Grid using cached Inverse Homography
  drawPerspectiveGrid(cachedHinv);

  const ledData = { leftHand: null, rightHand: null, leftFoot: null, rightFoot: null };

  if (results.poseLandmarks) {
    for (let i = 0; i < LIMB_KEYS.length; i++) {
      const limbName = LIMB_KEYS[i];
      const lm = results.poseLandmarks[LIMB_LANDMARKS[i]];

      if (!lm || lm.visibility < CONFIDENCE_THRESHOLD) {
        // Reset timer if limb disappears
        holdTimers[limbName].currentKey = null;
        holdTimers[limbName].start = 0;
        continue;
      }

      const px = (1 - lm.x) * canvas.width;
      const py = lm.y * canvas.height;
      const warped = warpPoint(cachedH, px, py);

      if (warped.x >= 0 && warped.x <= 1 && warped.y >= 0 && warped.y <= 1) {
        const col = Math.floor(warped.x * GRID_COLS);
        const row = Math.floor(warped.y * GRID_ROWS);
        const key = `${row},${col}`;

        if (holdTimers[limbName].currentKey !== key) {
          holdTimers[limbName].currentKey = key;
          holdTimers[limbName].start = performance.now();
        }

        const duration = performance.now() - holdTimers[limbName].start;
        const progress = Math.min(duration / HOLD_DURATION, 1);

        highlightCell(cachedHinv, row, col, LIMB_COLORS[limbName]);

        // Draw Progress Ring
        ctx.beginPath();
        ctx.arc(px, py, 8, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
        ctx.strokeStyle = LIMB_COLORS[limbName];
        ctx.lineWidth = 2;
        ctx.stroke();

        if (duration >= HOLD_DURATION) markFilledCell(limbName, row, col, duration);
        ledData[limbName] = [row, col];
      }

      // Draw Joint Dot
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "white";
      ctx.fill();
    }
  }

  // 4. Draw Persistent History
  LIMB_KEYS.forEach((limb) => {
    Object.keys(filledCells[limb]).forEach((k) => {
      const [r, c] = k.split(",").map(Number);
      highlightCell(cachedHinv, r, c, FILLED_COLORS[limb]);
    });
  });

  // 5. Throttled UI Updates (Update speeds every 5 frames to save CPU)
  frameCounter++;
  if (frameCounter % 5 === 0) {
    updateLimbSpeedPanel();
  }

  // 6. Prepare BLE Buffer
  if (characteristic) {
    const buffer = new Uint8Array(8);
    LIMB_KEYS.forEach((limb, i) => {
      if (ledData[limb]) {
        buffer[i * 2] = ledData[limb][0];
        buffer[i * 2 + 1] = ledData[limb][1];
      } else {
        buffer[i * 2] = buffer[i * 2 + 1] = 255;
      }
    });
    latestBuffer = buffer;
  }
}

// We check every 50ms, but we only "talk" if there is something new to say
setInterval(() => {
  if (appActive && characteristic && latestBuffer) {
    
    // .some() checks if any value in the array is different from our last "mail"
    const hasChanged = latestBuffer.some((val, i) => val !== lastSentBuffer[i]);
    
    if (hasChanged) {
      // Only send if the climber actually moved to a new cell
      characteristic.writeValueWithoutResponse(latestBuffer);
      
      // Update our "memory" so we don't send this again next time
      lastSentBuffer = new Uint8Array(latestBuffer); 
      console.log("BLE: Data sent (Movement detected)");
    }
  }
}, 50);

/* ================================================================================
   MODULE 6: REPLAY, STATISTICS & UI ANIMATION
   Description: Logic for ending the climb and replaying the sequence.
================================================================================
*/

function hideControls() {
  const topHeight = topBar.offsetHeight + 20;
  const bottomHeight = bottomBar.offsetHeight + 20;
  topBar.style.transition = bottomBar.style.transition = "transform 0.5s ease";
  topBar.style.transform = `translate(-50%, -${topHeight}px)`;
  bottomBar.style.transform = `translate(-50%, ${bottomHeight}px)`;
  setTimeout(() => {
    topBar.style.transform = `translate(-50%, -500px)`;
  }, 500);
}

function showControls() {
  topBar.style.transform = bottomBar.style.transform = "translate(-50%, 0)";
}

function resetGrid() {
  Object.keys(filledCells).forEach((l) => (filledCells[l] = {}));
  Object.keys(holdTimers).forEach((l) => (holdTimers[l] = {}));
  filledSequence = [];
}

function computeStats() {
  const stats = {
    totalMoves: filledSequence.length,
    leftMoves: filledSequence.filter((m) => m.limb === "leftHand").length,
    rightMoves: filledSequence.filter((m) => m.limb === "rightHand").length,
    leftFootMoves: filledSequence.filter((m) => m.limb === "leftFoot").length,
    rightFootMoves: filledSequence.filter((m) => m.limb === "rightFoot").length,
    avgHoldLeft: 0,
    avgHoldRight: 0,
    maxHold: 0,
  };
  const lDurs = filledSequence
    .filter((m) => m.limb === "leftHand")
    .map((m) => m.duration);
  const rDurs = filledSequence
    .filter((m) => m.limb === "rightHand")
    .map((m) => m.duration);
  stats.avgHoldLeft = lDurs.length
    ? lDurs.reduce((a, b) => a + b, 0) / lDurs.length
    : 0;
  stats.avgHoldRight = rDurs.length
    ? rDurs.reduce((a, b) => a + b, 0) / rDurs.length
    : 0;
  stats.maxHold = filledSequence.length
    ? Math.max(...filledSequence.map((m) => m.duration))
    : 0;
  return stats;
}

function updateStatsUI() {
  computeStats();
}

function endClimb() {
  if (reviewMode || filledSequence.length === 0) {
    if (filledSequence.length === 0) alert("No moves recorded to replay!");
    return;
  }

  const climbIndex = saveCurrentClimb();
  if (climbIndex === null) return;

  appActive = false;
  cameraMP.stop();

  // Read climbs from localStorage to get latest index
  const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
  sessionStorage.setItem("replayIndex", climbs.length - 1);

  window.location.href = "replay.html";
}

/* ================================================================================
   MODULE 7: EVENT LISTENERS & RESIZING
   Description: Wire up buttons and global window events.
================================================================================
*/

if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    Object.keys(filledCells).forEach((l) => (filledCells[l] = {}));
    Object.keys(holdTimers).forEach((l) => (holdTimers[l] = {}));
    filledSequence = [];
  });
}

document.getElementById("manualBtn").onclick = () => (autoMode = false);
document.getElementById("autoBtn").onclick = () => (autoMode = true);

// Pointer Events for Corner Dragging
canvas.addEventListener("mousedown", (e) => {
  if (!autoMode && !reviewMode) {
    const pos = getCanvasCoordinates(e);
    detectHover(pos);
    if (hoverIndex !== null) dragging = hoverIndex;
  }
});
canvas.addEventListener("mousemove", (e) => {
  const pos = getCanvasCoordinates(e);
  if (!autoMode && !reviewMode) detectHover(pos);
  if (dragging !== null && !autoMode && !reviewMode) {
    corners[dragging].x = pos.x;
    corners[dragging].y = pos.y;
    gridNeedsUpdate = true; // <--- This triggers the recalc only when needed
  }
});
canvas.addEventListener("mouseup", () => (dragging = null));
canvas.addEventListener("mouseleave", () => (dragging = null));
canvas.addEventListener(
  "touchstart",
  (e) => {
    if (!autoMode && !reviewMode) {
      const pos = getCanvasCoordinates(e);
      detectHover(pos);
      if (hoverIndex !== null) dragging = hoverIndex;
    }
  },
  { passive: false },
);
canvas.addEventListener("touchmove", (e) => {
  const pos = getCanvasCoordinates(e);
  if (dragging !== null && !autoMode && !reviewMode) {
    corners[dragging].x = pos.x;
    corners[dragging].y = pos.y;
    gridNeedsUpdate = true; // <--- Add this line here
  }
}, { passive: false });
canvas.addEventListener("touchend", () => (dragging = null));

function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let newWidth = vw;
  let newHeight = vw * (camHeight / camWidth);
  if (newHeight > vh) {
    const scale = vh / newHeight;
    newWidth *= scale;
    newHeight *= scale;
  }
  const scaleX = newWidth / canvas.width;
  const scaleY = newHeight / canvas.height;
  corners.forEach((c) => {
    c.x *= scaleX;
    c.y *= scaleY;
  });
  canvas.width = newWidth;
  canvas.height = newHeight;
  canvas.style.width = `${newWidth}px`;
  canvas.style.height = `${newHeight}px`;
  if (reviewMode) showReplayPanel();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas(); // Init call



/* ================================================================================
   MODULE 8: Save and Replay climbs
   Description: Saving the data for each climb
================================================================================
*/

function saveCurrentClimb() {
  if (filledSequence.length === 0) {
    alert("No moves recorded to save!");
    return null;
  }

  const name = prompt(
    "Enter a name for this climb:",
    `Climb ${new Date().toLocaleString()}`
  );
  if (!name) return null;

  const climbData = {
    name,
    filledSequence,
    GRID_ROWS,
    GRID_COLS,
    HOLD_DURATION,
    timestamp: Date.now(),
  };

  let climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
  climbs.push(climbData);

  localStorage.setItem("savedClimbs", JSON.stringify(climbs));

  return climbs.length - 1; // return index of new climb
}

function refreshClimbList() {
  const climbListDiv = document.getElementById("climbList");
  climbListDiv.innerHTML = "";

  const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
  climbs.forEach((climb, idx) => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "space-between";
    container.style.marginBottom = "4px";

    // Load button
    const btn = document.createElement("button");
    btn.innerText = climb.name;
    btn.style.flexGrow = "1";
    btn.style.fontSize = "12px";
    btn.style.cursor = "pointer";
    btn.onclick = () => loadClimb(idx);

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.innerText = "🗑️";
    delBtn.style.marginLeft = "4px";
    delBtn.style.fontSize = "12px";
    delBtn.style.cursor = "pointer";
    delBtn.onclick = (e) => {
      e.stopPropagation(); // prevent triggering loadClimb
      if (confirm(`Delete climb "${climb.name}"?`)) {
        climbs.splice(idx, 1);
        localStorage.setItem("savedClimbs", JSON.stringify(climbs));
        refreshClimbList();
      }
    };

    container.appendChild(btn);
    container.appendChild(delBtn);
    climbListDiv.appendChild(container);
  });
}

function loadClimb(idx) {
  const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
  if (!climbs[idx]) return;

  const data = climbs[idx];

  // Initialize replay with the loaded sequence
  initReplay(data.filledSequence);

  alert(`Climb "${data.name}" loaded! Use the replay slider to review.`);
}


/* ================================================================================ 
   MODULE 9: ROBUST INITIALIZATION
   Description: Waits for OpenCV and Camera/DOM to be ready before starting.
================================================================================ */

async function waitForDependencies() {
  console.log("Waiting for dependencies...");
  
  // 1. Wait for OpenCV
  while (!cvReady) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  // 2. Wait for MediaPipe Pose (check if class exists)
  while (typeof Pose === 'undefined') {
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log("All dependencies loaded!");
  return true;
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for the libraries to finish downloading
    await waitForDependencies();

    // Activate the app
    appActive = true;

    // Show UI bars
    if (topBar) topBar.style.display = "flex";
    if (bottomBar) bottomBar.style.display = "flex";

    // Now start everything
    startDetection();
    
    // Sometimes AR.js needs a tiny delay to ensure the DOM is ready
    setTimeout(() => {
        // initAR() is already called in your code, 
        // if it's already running, you don't need to call it again here.
        console.log("App initialization complete.");
    }, 500);

    document.getElementById("endClimbBtn").addEventListener("click", endClimb);
    
  } catch (err) {
    console.error("Initialization failed:", err);
    alert("App failed to load. Please refresh.");
  }
});
