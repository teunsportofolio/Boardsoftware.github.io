/* ================================================
   replay.js – Fully fixed version
================================================= */

let filledSequence = [];
let GRID_ROWS = 5;
let GRID_COLS = 5;

let canvas, ctx;
let replayPanel,
  replaySlider,
  replayResetBtn,
  profileBtn,
  replayBar,
  currentMovePanel;

const FILLED_COLORS = {
  leftHand: "rgba(180,100,100,0.25)",
  rightHand: "rgba(100,100,180,0.25)",
  leftFoot: "rgba(100,180,100,0.25)",
  rightFoot: "rgba(180,180,100,0.25)",
};

document.addEventListener("DOMContentLoaded", () => {
  // --- Canvas setup ---
  canvas = document.querySelector(".output_canvas");
  if (!canvas) {
    console.error("Canvas not found.");
    return;
  }
  ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.width = canvas.width + "px";
  canvas.style.height = canvas.height + "px";

  // --- UI elements ---
  replayPanel = document.getElementById("replayPanel");
  replaySlider = document.getElementById("replaySlider");
  profileBtn = document.getElementById("profileBtn");
  replayResetBtn = document.getElementById("replayResetBtn");
  replayBar = document.getElementById("replayBar");
  currentMovePanel = document.getElementById("currentMovePanel");

  // --- Responsive canvas ---
  window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";
    if (filledSequence.length) drawSimpleGrid();
  });

  // --- Load replay if session storage has index ---
  const idx = sessionStorage.getItem("replayIndex");
  if (idx !== null) {
    loadClimb(parseInt(idx));
    sessionStorage.removeItem("replayIndex");
  }
});

/* ==========================
   GRID & DRAWING UTILITIES
========================== */
function getReplayGridDimensions() {
  const cellHeight = (canvas.height * 0.7) / GRID_ROWS;
  const cellSize = cellHeight;

  const gridWidth = cellSize * GRID_COLS;
  const gridHeight = cellSize * GRID_ROWS;

  const offsetX = (canvas.width - gridWidth) / 2;
  const offsetY = (canvas.height - gridHeight) / 2;

  return { gridWidth, gridHeight, offsetX, offsetY, cellSize };
}

function drawSimpleGrid() {
  if (!ctx) return;
  const { gridWidth, gridHeight, offsetX, offsetY, cellSize } =
    getReplayGridDimensions();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= GRID_COLS; i++) {
    ctx.beginPath();
    ctx.moveTo(offsetX + i * cellSize, offsetY);
    ctx.lineTo(offsetX + i * cellSize, offsetY + gridHeight);
    ctx.stroke();
  }

  for (let j = 0; j <= GRID_ROWS; j++) {
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + j * cellSize);
    ctx.lineTo(offsetX + gridWidth, offsetY + j * cellSize);
    ctx.stroke();
  }
}

function highlightCellSimple(row, col, color) {
  const { offsetX, offsetY, cellSize } = getReplayGridDimensions();
  ctx.fillStyle = color;
  ctx.fillRect(
    offsetX + col * cellSize,
    offsetY + row * cellSize,
    cellSize,
    cellSize,
  );
}

/* ==========================
   MOVE PANEL & BAR
========================== */
function showReplayBar() {
  if (!replayBar) return;
  const height = replayBar.offsetHeight + 20;
  replayBar.style.display = "flex";
  replayBar.style.transform = `translate(-50%, ${height}px)`;
  replayBar.style.transition = "transform 0.5s ease";
  replayBar.getBoundingClientRect();
  replayBar.style.transform = "translate(-50%, 0)";
}

function hideReplayBar() {
  if (!replayBar) return;
  replayBar.style.transition = "transform 0.5s ease";
  replayBar.style.transform = `translate(-50%, ${replayBar.offsetHeight + 20}px)`;
  replayBar.addEventListener(
    "transitionend",
    () => {
      replayBar.style.display = "none";
    },
    { once: true },
  );
}

function updateCurrentMovePanel(idx) {
  if (!currentMovePanel) return;
  if (idx < 0 || idx >= filledSequence.length) {
    currentMovePanel.style.display = "none";
    return;
  }

  const move = filledSequence[idx];
  currentMovePanel.style.display = "block";

  const isHand = move.limb.includes("Hand");
  const isLeft = move.limb.includes("left");
  const limbText = move.limb
    .replace("Hand", " HAND")
    .replace("Foot", " FOOT")
    .toUpperCase();
  const seconds = move.duration / 1000;

  const overlayImage = isHand
    ? isLeft
      ? "../images/l-hand.png"
      : "../images/r-hand.png"
    : isLeft
      ? "../images/l-foot.png"
      : "../images/r-foot.png";

  currentMovePanel.innerHTML = `
    <div style="position:relative; width:100%; margin-bottom:14px;">
      <img src="../images/bg.png" style="width:100%; height:auto; display:block; object-fit:contain;">
      <img id="panelOverlay" src="${overlayImage}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:contain; opacity:0; transition:opacity 0.2s ease;">
      <div id="moveBadge" style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.6); padding:4px 8px; font-size:11px; font-weight:600; letter-spacing:1px; border-radius:12px; backdrop-filter:blur(4px); transform:scale(0.8); opacity:0; transition:all 0.25s ease;">#${idx + 1}</div>
    </div>
    <div id="panelTextBlock" style="display:flex; flex-direction:column; gap:6px; text-transform:uppercase; letter-spacing:1px;">
      <div style="font-size:16px; font-weight:600;">${limbText}</div>
      <div style="font-size:12px; opacity:0.8;">ROW ${move.row}  •  COL ${move.col}</div>
      <div style="font-size:12px; opacity:0.8;">HOLD TIME ${seconds.toFixed(1)}S</div>
    </div>
  `;

  const overlay = document.getElementById("panelOverlay");
  const badge = document.getElementById("moveBadge");
  overlay.style.opacity = Math.max(0, Math.min(seconds / 10, 1));
  requestAnimationFrame(() => {
    badge.style.opacity = 1;
    badge.style.transform = "scale(1.15)";
    setTimeout(() => {
      badge.style.transform = "scale(1)";
    }, 120);
  });
}

function hideCurrentMovePanel() {
  if (!currentMovePanel) return;
  currentMovePanel.style.display = "none";
}

/* ==========================
   REPLAY PANEL
========================== */
function showReplayPanel() {
  if (!replayPanel) return;
  const { gridWidth, gridHeight } = getReplayGridDimensions();
  replayPanel.style.width = gridWidth + 32 + "px";
  replayPanel.style.height = gridHeight + 32 + "px";
  replayPanel.style.display = "block";
}

function hideReplayPanel() {
  if (!replayPanel) return;
  replayPanel.style.display = "none";
}

/* ==========================
   REPLAY LOGIC
========================== */
function initReplay() {
  if (!filledSequence.length) return;

  showReplayPanel();
  drawSimpleGrid();
  showReplayBar();

  replaySlider.min = 1;
  replaySlider.max = filledSequence.length;
  replaySlider.value = 1;

  let currentIndex = 1;
  let intervalId;

  function redraw(idx) {
    drawSimpleGrid();
    for (let i = 0; i < idx; i++) {
      const move = filledSequence[i];
      highlightCellSimple(move.row, move.col, FILLED_COLORS[move.limb]);
    }
    currentIndex = idx;
    replaySlider.value = idx;
    updateCurrentMovePanel(idx - 1); // panel still shows current move
  }

  intervalId = setInterval(() => {
    if (currentIndex < filledSequence.length) {
      redraw(currentIndex + 1);
    } else {
      clearInterval(intervalId);
    }
  }, 200);

  replaySlider.addEventListener("input", (e) => {
    clearInterval(intervalId);
    redraw(parseInt(e.target.value));
  });

  profileBtn.onclick = () => {
    clearInterval(intervalId);
    window.location.href = "profile.html"; // path to your local HTML
  };

  replayResetBtn.onclick = () => {
    clearInterval(intervalId);
    window.location.href = "climb.html"; // path to your local HTML
  };
}

function loadClimb(idx) {
  const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
  const data = climbs[idx];
  if (!data) return;

  filledSequence = data.filledSequence || [];
  GRID_ROWS = data.GRID_ROWS || 5;
  GRID_COLS = data.GRID_COLS || 5;

  initReplay();
}

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (filledSequence.length) drawSimpleGrid();
});

document.addEventListener("DOMContentLoaded", () => {
  const idx = sessionStorage.getItem("replayIndex");
  if (idx !== null) {
    loadClimb(parseInt(idx));
    sessionStorage.removeItem("replayIndex");
  }
});
