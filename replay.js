let filledSequence = [];
let GRID_ROWS = 5;
let GRID_COLS = 5;
let canvas, ctx;

const FILLED_COLORS = {
    leftHand: "#4CAF50",  // Match your boardStartColor
    rightHand: "#2196F3", // Match your boardHoldColor
    leftFoot: "#FFEB3B",  // Match your boardFootColor
    rightFoot: "#F44336"  // Match your boardEndColor
};

document.addEventListener("DOMContentLoaded", () => {
    canvas = document.getElementById("replay-canvas");
    ctx = canvas.getContext("2d");
    
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Load from session storage
    const idx = sessionStorage.getItem("replayIndex");
    if (idx !== null) {
        loadClimb(parseInt(idx));
    } else {
        // Fallback: load the most recent climb if no index provided
        loadClimb(-1); 
    }
});

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (filledSequence.length) redraw(parseInt(document.getElementById("replaySlider").value));
}

function getGridDimensions() {
    const padding = 60;
    const availableHeight = canvas.height - 250; // Leave room for nav/slider
    const availableWidth = canvas.width - padding;
    
    // Maintain square cells
    const cellSize = Math.min(availableWidth / GRID_COLS, availableHeight / GRID_ROWS);
    
    const gridWidth = cellSize * GRID_COLS;
    const gridHeight = cellSize * GRID_ROWS;
    
    return {
        offsetX: (canvas.width - gridWidth) / 2,
        offsetY: (canvas.height - gridHeight) / 2,
        cellSize,
        gridWidth,
        gridHeight
    };
}

function drawGrid() {
    const { offsetX, offsetY, cellSize, gridWidth, gridHeight } = getGridDimensions();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background grid
    ctx.strokeStyle = "var(--bgColor)"; // var(--accentColor) low opacity
    ctx.lineWidth = 2;

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

function redraw(upToIdx) {
    drawGrid(); // Clears canvas and draws lines
    if (upToIdx === 0) {
        updateMovePanel(-1); // Hide the panel
        return;
    }

    const { offsetX, offsetY, cellSize } = getGridDimensions();

    for (let i = 0; i < upToIdx; i++) {
        const move = filledSequence[i];
        if(!move) continue;

        ctx.fillStyle = FILLED_COLORS[move.limb] || "white";
        
        const padding = cellSize * 0.1;
        const x = offsetX + move.col * cellSize + padding;
        const y = offsetY + move.row * cellSize + padding;
        const size = cellSize - (padding * 2);

        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, 12);
        ctx.fill();
    }
    updateMovePanel(upToIdx - 1);
}

function updateMovePanel(idx) {
    const panel = document.getElementById("currentMovePanel");
    const stepCounter = document.getElementById("sliderStep");
    
    if (idx < 0) {
        panel.style.display = "none";
        stepCounter.textContent = "0";
        return;
    }
    
    stepCounter.textContent = idx + 1;
    panel.style.display = "block";
    const move = filledSequence[idx];
    const limbName = move.limb.replace(/([A-Z])/g, ' $1').toUpperCase();

    panel.innerHTML = `
        <div class="subFont" style="margin-bottom:5px;">SEQUENCE</div>
        <div class="headerFont" style="font-size:24px; margin:0; color:var(--accentColor); margin-left:0;">#${idx + 1}</div>
        <div class="bigDivider" style="margin:10px 0;"></div>
        <div class="subFont">${limbName}</div>
        <div class="textFont" style="font-size:14px; margin-top:4px;">Row ${move.row} • Col ${move.col}</div>
        <div class="textFont" style="font-size:14px; color:var(--accentColor); font-weight:bold;">${(move.duration/1000).toFixed(1)}s Hold</div>
    `;
}

let replayTimer = null;

function loadClimb(idx) {
    const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
    const data = idx === -1 ? climbs[climbs.length - 1] : climbs[idx];
    if (!data) return;

    // Update Header
    document.getElementById("climbDisplayName").textContent = data.name.toUpperCase();

    filledSequence = data.filledSequence;
    GRID_ROWS = data.GRID_ROWS;
    GRID_COLS = data.GRID_COLS;

    const slider = document.getElementById("replaySlider");
    const stepCounter = document.getElementById("sliderStep");
    slider.max = filledSequence.length;

    // --- The Auto-Play Logic ---
    setTimeout(() => {
        let currentStep = 0;
        replayTimer = setInterval(() => {
            currentStep++;
            slider.value = currentStep;
            redraw(currentStep);
            updateSliderFill();

            if (currentStep >= filledSequence.length) {
                clearInterval(replayTimer);
            }
        }, 400); // 0.4s per move for a nice "build-up" feel
    }, 1000); // 1-second delay before starting

    // --- The Manual Slider Logic ---
    slider.addEventListener("input", (e) => {
        // If user touches the slider, stop the auto-play
        if (replayTimer) clearInterval(replayTimer);
        
        const val = parseInt(e.target.value);
        redraw(val);
        updateSliderFill();
    });
    
    redraw(0); // Draw empty grid initially
}

function updateSliderFill() {
    const slider = document.getElementById("replaySlider");
    if (!slider) return;

    // Calculate percentage (handle division by zero if sequence is empty)
    const max = slider.max || 1;
    const percentage = (slider.value / max) * 100;

    // Apply the gradient: Gold on the left, Gray on the right
    slider.style.background = `linear-gradient(to right, var(--accentColor) ${percentage}%, #ddd ${percentage}%)`;
}