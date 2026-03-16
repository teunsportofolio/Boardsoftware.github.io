/* ================================================================================
   MODULE 1: CONFIGURATION & GLOBAL STATE
   Description: Holds constants, style settings, and the app's living state.
================================================================================
*/
// At the top of MODULE 1: CONFIGURATION & GLOBAL STATE
const draftClimb = JSON.parse(sessionStorage.getItem('draft') || '{}');

let GRID_ROWS = draftClimb.rows || 18;
let GRID_COLS = draftClimb.columns || 16;
let firstFrameReceived = false;

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
// Optimized Grid Initialization
// This function creates a perfect square based on the INTERNAL canvas resolution
const getInitialCorners = () => {
    // Use the internal resolution (1280x720) instead of window size
    const internalW = 1280; 
    const internalH = 720;
    
    // We want a square that is roughly 60% of the screen height
    const squareSize = internalH * 0.6; 
    const half = squareSize / 2;
    const centerX = internalW / 2;
    const centerY = internalH / 2;

    return [
        { x: centerX - (half*2), y: centerY - half }, // Top Left
        { x: centerX + (half*2), y: centerY - half }, // Top Right
        { x: centerX + (half*2), y: centerY + half - 100}, // Bottom Right
        { x: centerX - (half*2), y: centerY + half - 100 }  // Bottom Left
    ];
};

let corners = getInitialCorners();

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

const videoElement = document.getElementById("webcam-video");
const canvas = document.getElementById("detection-canvas");
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
  if (!cvReady) return; 

  try {
    // Create temporary mats
    const srcCoords = [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ];
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, srcCoords);
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1, 0, 1, 1, 0, 1]);

    // Clean up old ones before overwriting
    if (cachedH) cachedH.delete();
    if (cachedHinv) cachedHinv.delete();

    cachedH = cv.getPerspectiveTransform(src, dst);
    cachedHinv = cv.getPerspectiveTransform(dst, src);

    src.delete();
    dst.delete();
    gridNeedsUpdate = false;
    console.log("Homography Updated Successfully");
  } catch (err) {
    console.warn("OpenCV not ready for transform yet...");
  }
}

// Pre-allocate these ONCE at the top of Module 3
let _srcPointMat, _dstPointMat;

function warpPoint(H, x, y) {
    if (!cvReady || !H || typeof H.data32F === 'undefined') return { x: 0, y: 0 };

    // Initialize the reusable mats only once
    if (!_srcPointMat) _srcPointMat = new cv.Mat(1, 1, cv.CV_32FC2);
    if (!_dstPointMat) _dstPointMat = new cv.Mat();

    // Directly set the values instead of creating a new array/Mat
    _srcPointMat.data32F[0] = x;
    _srcPointMat.data32F[1] = y;

    try {
        cv.perspectiveTransform(_srcPointMat, _dstPointMat, H);
        return { x: _dstPointMat.data32F[0], y: _dstPointMat.data32F[1] };
    } catch (e) {
        return { x: 0, y: 0 };
    }
    // We NO LONGER call .delete() here, saving massive CPU cycles
}

function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  
  // Direct mapping since canvas size = screen size
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

// Add these listeners to the canvas so you can move the points with your finger
canvas.addEventListener("mousedown", (e) => {
  const pos = getCanvasCoordinates(e);
  corners.forEach((c, i) => {
    if (Math.hypot(pos.x - c.x, pos.y - c.y) < 30) dragging = i; // 30px hit area for fingers
  });
});

canvas.addEventListener("mousemove", (e) => {
  const pos = getCanvasCoordinates(e);
  detectHover(pos);
  if (dragging !== null) {
    corners[dragging].x = pos.x;
    corners[dragging].y = pos.y;
    gridNeedsUpdate = true;
  }
});

canvas.addEventListener("mouseup", () => dragging = null);

// IMPORTANT: Add Touch Support for Mobile!
canvas.addEventListener("touchstart", (e) => {
    const pos = getCanvasCoordinates(e);
    corners.forEach((c, i) => {
        if (Math.hypot(pos.x - c.x, pos.y - c.y) < 40) dragging = i;
    });
    if (dragging !== null) e.preventDefault(); // Prevent scrolling while dragging
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    if (dragging !== null) {
        const pos = getCanvasCoordinates(e);
        corners[dragging].x = pos.x;
        corners[dragging].y = pos.y;
        gridNeedsUpdate = true;
        e.preventDefault();
    }
}, { passive: false });

canvas.addEventListener("touchend", () => dragging = null);

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
  modelComplexity: 0,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
pose.onResults(onResults);

// Start camera immediately on load, but keep 'appActive' false until button press
async function startDetection() {
  const constraints = {
    video: {
      facingMode: "user", // Forced Front Camera
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    
    videoElement.onloadedmetadata = () => {
      videoElement.play();
      resizeCanvas(); // Ensure canvas matches screen
      requestAnimationFrame(predictWebcam);
    };
  } catch (err) {
    console.error("Camera failed:", err);
    alert("Please enable camera permissions and use HTTPS.");
  }
}

// The detection loop runs, but does nothing until appActive is true
let lastProcessingTime = 0;
const MAX_FPS = 30; // Limit AI to 30 frames per second

async function predictWebcam() {
    const now = performance.now();
    
    // Only send to AI if enough time has passed
    if (videoElement.readyState >= 2 && (now - lastProcessingTime) > (1000 / MAX_FPS)) {
        lastProcessingTime = now;
        await pose.send({ image: videoElement });
    }
    requestAnimationFrame(predictWebcam);
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

    if (autoMode) {
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
    // Draw Lines ONLY if we have a valid homography matrix
    if (Hinv && typeof Hinv.data32F !== 'undefined') {
        ctx.strokeStyle = "rgba(255, 255, 255, 1)";
        ctx.lineWidth = 1.5;

        // Horizontal
        for (let i = 0; i <= GRID_ROWS; i++) {
            ctx.beginPath();
            for (let j = 0; j <= GRID_COLS; j++) {
                const p = warpPoint(Hinv, j / GRID_COLS, i / GRID_ROWS);
                if (j === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        // Vertical
        for (let j = 0; j <= GRID_COLS; j++) {
            ctx.beginPath();
            for (let i = 0; i <= GRID_ROWS; i++) {
                const p = warpPoint(Hinv, j / GRID_COLS, i / GRID_ROWS);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
    }

    // ALWAYS draw the corner handles
    corners.forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, (i === dragging) ? 15 : 10, 0, 2 * Math.PI);
        
        // Logic for color:
        // 1. If dragging: Blue
        // 2. If AutoMode is ON and Marker is visible: Green
        // 3. Otherwise: White
        if (i === dragging) {
            ctx.fillStyle = "#3b5683"; 
        } else if (autoMode && markers[i] && markers[i].visible) {
            ctx.fillStyle = "#4CAF50"; // Snapped Green
        } else {
            ctx.fillStyle = "white";
        }
        
        ctx.fill();
        // Add a stroke to make them pop
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
    if (!firstFrameReceived) {
          firstFrameReceived = true;
          const loader = document.getElementById("loading-overlay");
          if (loader) loader.classList.add("hidden"); // This triggers the CSS fade
          console.log("First AI frame received. Hiding loader.");
      }
    // 1. Calculate aspect ratio fitting (Always happens)
    const inputWidth = results.image.width;
    const inputHeight = results.image.height;
    const outputAspect = canvas.width / canvas.height;
    const inputAspect = inputWidth / inputHeight;

    let drawWidth, drawHeight, offsetX, offsetY;
    if (inputAspect > outputAspect) {
        drawHeight = inputHeight;
        drawWidth = inputHeight * outputAspect;
        offsetX = (inputWidth - drawWidth) / 2;
        offsetY = 0;
    } else {
        drawWidth = inputWidth;
        drawHeight = inputWidth / outputAspect;
        offsetX = 0;
        offsetY = (inputHeight - drawHeight) / 2;
    }

    // 2. Draw Video Frame (Always happens)
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width, 0); // Mirror for Selfie
    ctx.scale(-1, 1);
    ctx.drawImage(results.image, offsetX, offsetY, drawWidth, drawHeight, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // 3. Grid & Homography Management
    // We update math whenever the grid moves, even if not "climbing" yet
    if (gridNeedsUpdate) {
        updateHomographies();
        gridNeedsUpdate = false; // Reset the flag immediately
    }

    // ALWAYS draw the grid lines and corner dots so the user can calibrate
    // We pass cachedHinv here instead of null so the lines show up immediately
    drawPerspectiveGrid(cachedHinv);

    // 4. THE GATEKEEPER
    // If the app isn't "Active" (button not pressed), we stop here.
    // This means no limb dots, no progress rings, and no BLE data.
    if (!appActive) return; 

    // 5. Active Limb Detection Logic
    const ledData = { leftHand: null, rightHand: null, leftFoot: null, rightFoot: null };

    if (results.poseLandmarks) {
        for (let i = 0; i < LIMB_KEYS.length; i++) {
            const limbName = LIMB_KEYS[i];
            const lm = results.poseLandmarks[LIMB_LANDMARKS[i]];

            // Only process if landmark is visible enough
            if (!lm || lm.visibility < CONFIDENCE_THRESHOLD) {
                holdTimers[limbName].currentKey = null;
                holdTimers[limbName].start = 0;
                continue;
            }

            // Remap coordinates to mirrored canvas
            const mirroredX = (1 - lm.x); 
            const px = (mirroredX * inputWidth - offsetX) * (canvas.width / drawWidth);
            const py = (lm.y * inputHeight - offsetY) * (canvas.height / drawHeight);
            
            // Transform screen point to grid 0.0 - 1.0 coordinates
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

                // Draw active hold feedback
                highlightCell(cachedHinv, row, col, LIMB_COLORS[limbName]);

                // Draw Progress Ring around the joint
                ctx.beginPath();
                ctx.arc(px, py, 20, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
                ctx.strokeStyle = LIMB_COLORS[limbName];
                ctx.lineWidth = 6;
                ctx.stroke();

                if (duration >= HOLD_DURATION) {
                    markFilledCell(limbName, row, col, duration);
                }
                
                ledData[limbName] = [row, col];
            }

            // Draw the Joint Dot (White indicator)
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, 2 * Math.PI);
            ctx.fillStyle = "white";
            ctx.fill();
        }
    }

    // 6. Draw Persistent History (Cells you have already "held")
    LIMB_KEYS.forEach((limb) => {
        Object.keys(filledCells[limb]).forEach((k) => {
            const [r, c] = k.split(",").map(Number);
            highlightCell(cachedHinv, r, c, FILLED_COLORS[limb]);
        });
    });

    // 7. Prepare data for BLE (Only updates latestBuffer when appActive)
    if (characteristic) {
        const buffer = new Uint8Array(8);
        LIMB_KEYS.forEach((limb, i) => {
            if (ledData[limb]) {
                buffer[i * 2] = ledData[limb][0];
                buffer[i * 2 + 1] = ledData[limb][1];
            } else {
                buffer[i * 2] = 255; 
                buffer[i * 2 + 1] = 255;
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

function resetGrid() {
  // Clear the history of held cells
  Object.keys(filledCells).forEach((l) => (filledCells[l] = {}));
  // Clear the timers so hands don't "ghost" stay active
  Object.keys(holdTimers).forEach((l) => {
    holdTimers[l].currentKey = null;
    holdTimers[l].start = 0;
  });
  filledSequence = [];
  moveCounter = 0;
  console.log("Grid and Timers Reset");
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

const modeToggleBtn = document.getElementById("modeToggleBtn");

modeToggleBtn.onclick = () => {
    // 1. Flip the state
    autoMode = !autoMode;
    
    // 2. Update UI based on new state
    if (autoMode) {
        modeToggleBtn.classList.add("active-mode"); // Use this for a green/accent glow
    } else {
        modeToggleBtn.classList.remove("active-mode");
    }
    
    // 3. Optional: Reset dragging state if switching to Auto
    if (autoMode) dragging = null;
    
    console.log("Auto Mode is now:", autoMode);
};

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
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;

    // Scale corners relatively so they stay in position on screen rotate
    if (canvas.width > 0) {
        const scaleX = newWidth / canvas.width;
        const scaleY = newHeight / canvas.height;
        corners.forEach(c => {
            c.x *= scaleX;
            c.y *= scaleY;
        });
    }

    canvas.width = newWidth;
    canvas.height = newHeight;
    gridNeedsUpdate = true;
}

window.addEventListener('resize', resizeCanvas);
// Initialize the camera immediately
window.addEventListener("DOMContentLoaded", () => {
    resizeCanvas();
    startDetection(); 
});




/* ================================================================================
   MODULE 8: Save and Replay climbs
   Description: Saving the data for each climb
================================================================================
*/

/* --- Unified Save & End Sequence --- */
function endClimb() {
    // 1. Safety Check: If nothing was recorded, just reset and stop
    if (filledSequence.length === 0) {
        alert("No moves recorded! Grid reset.");
        appActive = false;
        resetGrid();
        return;
    }

    // 2. STOP the app logic immediately
    appActive = false;
    
    // 3. Update the Start Button UI to show we aren't recording anymore
    const startBtn = document.getElementById("startBtn");
    if (startBtn) {
        startBtn.style.backgroundColor = ""; 
    }

    // 4. Prepare the Modal elements
    const modal = document.getElementById("saveModal");
    const input = document.getElementById("climbNameInput");
    const confirmBtn = document.getElementById("confirmSave");
    const cancelBtn = document.getElementById("cancelSave");
    const modalStats = document.getElementById("modalStats");

    // 5. Inject Stats
    const stats = computeStats();
    if (modalStats) {
        modalStats.innerHTML = `Total Moves: <strong>${stats.totalMoves}</strong> | Max Hold: <strong>${(stats.maxHold / 1000).toFixed(1)}s</strong>`;
    }

    // 6. SHOW THE MODAL
    modal.classList.remove("hidden");
    input.value = `Climb ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    
    // Use a small delay before focusing to avoid mobile keyboard "glitches"
    setTimeout(() => input.focus(), 100);

    // 7. THE FIX: Assign clean click handlers with e.preventDefault()
    // This stops the click from "bleeding through" to the background
    confirmBtn.onclick = (e) => {
        e.preventDefault(); 
        e.stopPropagation();

        const name = input.value || "Unnamed Climb";

        // Save Data
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

        // Set Replay Index and Redirect
        sessionStorage.setItem("replayIndex", climbs.length - 1);
        
        console.log("Saving complete. Navigating to replay...");
        window.location.href = "replay.html";
    };

    cancelBtn.onclick = (e) => {
        e.preventDefault();
        modal.classList.add("hidden");
        resetGrid(); 
        console.log("Climb discarded.");
    };
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

canvas.addEventListener("mousedown", (e) => {
    // If the click is actually on a button, don't do grid dragging!
    if (e.target.tagName === 'BUTTON') return;
    
    if (!autoMode && !reviewMode) {
        const pos = getCanvasCoordinates(e);
        detectHover(pos);
        if (hoverIndex !== null) dragging = hoverIndex;
    }
});

/* ================================================================================ 
   MODULE 9: ROBUST INITIALIZATION & BUTTON LOGIC
   Description: Waits for OpenCV and Camera/DOM to be ready before starting.
================================================================================ */

// 1. Define the missing function
async function waitForDependencies() {
    console.log("Waiting for dependencies...");
    
    // Wait for OpenCV to initialize
    let checkCount = 0;
    while (!cvReady && checkCount < 50) { // Timeout after 5 seconds
        await new Promise(r => setTimeout(r, 100));
        checkCount++;
    }
    
    // Wait for MediaPipe Pose library to be available in window
    while (typeof Pose === 'undefined') {
        await new Promise(r => setTimeout(r, 100));
    }
    
    console.log("All dependencies loaded!");
    return true;
}

// 2. The Main Loader
window.addEventListener("load", async () => {
    try {
        const statusText = document.getElementById("loading-status"); 
        // Run the dependency check
        if (statusText) statusText.textContent = "Loading AI Models...";
        await waitForDependencies();

        // Reference the buttons
        const startBtn = document.getElementById("startBtn");

        // Force initial button state
        if (startBtn) {
            
            // Use 'onclick' to ensure it overrides any other listeners
            startBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();

              if (!firstFrameReceived) return;

              if (!appActive) {
                  // --- STARTING ---
                  appActive = true;
                  resetGrid(); // Clear previous moves
                  startBtn.style.backgroundColor = "var(--accentColor)";
              } else {
                  // --- STOPPING ---
                  // We do NOT flip appActive here manually, endClimb() will handle the state
                  endClimb(); 
              }
          };
        }

        // Start the camera immediately (appActive remains false)
        if (statusText) statusText.textContent = "Starting Camera...";
          startDetection(); 
        console.log("Initialization complete. Camera started.");

    } catch (err) {
        console.error("Initialization failed:", err);
        // If it fails, show a helpful message on the screen
        const debugDiv = document.createElement('div');
        debugDiv.style = "position:fixed; top:0; background:red; color:white; z-index:10000; padding:10px;";
        debugDiv.textContent = "App Error: " + err.message;
        document.body.appendChild(debugDiv);
    }
});