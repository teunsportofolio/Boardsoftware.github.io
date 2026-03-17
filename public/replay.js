let filledSequence = [];
let GRID_ROWS = 5;
let GRID_COLS = 5;
let canvas, ctx;
let plannedRouteData = null;

const FILLED_COLORS = {
    leftHand: "#F44336",  // Match your boardStartColor
    rightHand: "#2196F3", // Match your boardHoldColor
    leftFoot: "#4CAF50",  // Match your boardFootColor
    rightFoot: "#FFEB3B" // Match your boardEndColor
};

document.addEventListener("DOMContentLoaded", async () => {
    canvas = document.getElementById("replay-canvas");
    ctx = canvas.getContext("2d");
    
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const replayId = sessionStorage.getItem("replayId");
    const localIdx = sessionStorage.getItem("replayIndex");
    
    if (replayId) {
        try {
            const res = await fetch(`/api/climbs/${replayId}`);
            if (res.ok) {
                const climbData = await res.json();
                
                // --- NEW LOGIC START ---
                // If the climb doesn't have the grid, but has a routeId, fetch the route!
                if (!climbData.grid && climbData.routeId) {
                    const routeRes = await fetch(`/api/routes/${climbData.routeId}`);
                    if (routeRes.ok) {
                        const routeData = await routeRes.json();
                        climbData.grid = routeData.grid; // Attach the grid to our data
                    }
                }
                // --- NEW LOGIC END ---

                setupReplay(climbData);
            }
        } catch (err) {
            console.error("Replay fetch failed", err);
        }
    } else if (localIdx !== null) {
        // Fallback to LocalStorage
        const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
        setupReplay(climbs[localIdx]);
    }
});

// Helper to initialize the UI with fetched data
function setupReplay(data) {
    if (!data) return;
    
    plannedRouteData = data.grid || null; 
    filledSequence = data.filledSequence || [];
    GRID_ROWS = data.rows || 18; 
    GRID_COLS = data.cols || 16; 

    // DISPLAY DIFFERENTIATION
    const nameDisplay = document.getElementById("climbDisplayName");
    if (nameDisplay) {
        const attemptLabel = data.name.toUpperCase();
        const routeLabel = data.routeName ? data.routeName.toUpperCase() : "ORIGINAL ROUTE";
        
        // Show as: ATTEMPT NAME (ROUTE NAME)
        nameDisplay.innerHTML = `
            <span style="color:var(--accentColor);">${attemptLabel}</span> 
            <small style="opacity:0.6; font-size: 0.6em; margin-left:10px;">ON ${routeLabel}</small>
        `;
    }

    const slider = document.getElementById("replaySlider");
    if (slider) {
        slider.max = filledSequence.length;
        slider.value = 0; 
    }
    
    redraw(0); 
    startAutoPlay();
}

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

    // 1. Draw your grid lines (sharp)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; 
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

    // 2. Draw the Ghost Holds from your saved Route
    if (plannedRouteData) {
        plannedRouteData.forEach((row, r) => {
            row.forEach((color, c) => {
                if (color && color !== "erase") {
                    // Use your hexToRgba helper here
                    ctx.fillStyle = hexToRgba(color, 0.2); 
                    
                    ctx.beginPath();
                    ctx.arc(
                        offsetX + c * cellSize + cellSize / 2,
                        offsetY + r * cellSize + cellSize / 2,
                        cellSize / 3,
                        0, Math.PI * 2
                    );
                    ctx.fill();
                }
            });
        });
    }
}

function redraw(upToIdx) {
    // 1. Reset and draw the base grid + ghost holds
    drawGrid(); 

    // 2. Safety: If we're at the very start, just update UI and exit
    if (upToIdx <= 0) {
        updateMovePanel(-1);
        updateSliderFill();
        return;
    }

    const { offsetX, offsetY, cellSize } = getGridDimensions();

    // 3. Draw the active sequence moves up to the current index
    for (let i = 0; i < upToIdx; i++) {
        const move = filledSequence[i];
        if (!move) continue;

        // Get the specific color for the limb used (Hand, Foot, etc.)
        const baseColor = FILLED_COLORS[move.limb] || "#FFFFFF";
        
        // We use 0.9 alpha for sequence moves so they are distinct but slightly soft
        ctx.fillStyle = hexToRgba(baseColor, 0.9);
        
        const padding = cellSize * 0.15;
        const x = offsetX + move.col * cellSize + padding;
        const y = offsetY + move.row * cellSize + padding;
        const size = cellSize - (padding * 2);

        // Draw the sequence move as a rounded rectangle
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, size, size, 8);
        } else {
            // Fallback for older browsers
            ctx.rect(x, y, size, size);
        }
        ctx.fill();

        // 4. Highlight the "Current" move (the very last one in the sequence)
        if (i === upToIdx - 1) {
            ctx.strokeStyle = "white";
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    // 5. Sync the UI panel and slider
    updateMovePanel(upToIdx - 1);
    updateSliderFill();
}

/**
 * Helper to convert Hex strings to RGBA for localized opacity
 */
function hexToRgba(hex, alpha) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function startAutoPlay() {
    const slider = document.getElementById("replaySlider");
    let currentStep = 0;
    
    // Clear any existing timers to prevent "double speed" replays
    if (replayTimer) clearInterval(replayTimer);

    setTimeout(() => {
        replayTimer = setInterval(() => {
            currentStep++;
            slider.value = currentStep;
            redraw(currentStep);
            updateSliderFill();

            if (currentStep >= filledSequence.length) {
                clearInterval(replayTimer);
            }
        }, 400); 
    }, 1000);
}

// Update loadClimb to use the new structure
function loadClimb(idx) {
    const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
    const data = idx === -1 ? climbs[climbs.length - 1] : climbs[idx];
    if (!data) return;

    setupReplay(data);
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



const slider = document.getElementById("replaySlider");

slider.addEventListener("input", (e) => {
    // Stop autoplay if the user touches the slider
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
    }
    
    const val = parseInt(e.target.value);
    redraw(val);
    updateSliderFill();
});