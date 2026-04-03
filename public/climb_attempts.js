async function loadSavedAttempts() {
    const container = document.getElementById("savedAttempts");
    const totalDisplay = document.getElementById("totalClimbs");
    if (!container) return;

    container.innerHTML = `<div class="subFont" style="text-align:center; padding:40px; opacity:0.5;">Accessing Attempts...</div>`;

    try {
        const response = await fetch('/api/climbs');
        if (!response.ok) throw new Error("Database path not found");
        
        const attempts = await response.json();
        
        if (totalDisplay) totalDisplay.textContent = attempts.length;
        container.innerHTML = "";

        if (attempts.length === 0) {
            container.innerHTML = `<div class="subFont" style="text-align:center; margin-top:40px; opacity:0.5;">No recorded attempts found.</div>`;
            return;
        }

        attempts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        attempts.forEach((climb, idx) => {
            const climbRow = document.createElement("div");
            climbRow.className = "climb-item";
            // Ensure the row behaves as a flex container so items stay on one line
            climbRow.style.display = "flex";
            climbRow.style.alignItems = "center";

            const moveCount = climb.moveCount || 0; 
            const movesText = moveCount === 1 ? "1 move" : `${moveCount} moves`;
            const dateStr = climb.timestamp ? new Date(climb.timestamp).toLocaleDateString() : "Recent";

            const infoArea = document.createElement("div");
            infoArea.className = "climb-info";
            infoArea.style.flex = "1"; // This pushes the buttons to the right
            infoArea.innerHTML = `
                <div class="climb-name">${climb.name || "Unnamed Attempt"}</div>
                <div class="climb-meta">${dateStr} • ${movesText}</div>
            `;

            infoArea.onclick = () => {
                sessionStorage.removeItem("replayIndex");
                const idToUse = climb.id || climb._id;
                sessionStorage.setItem("replayId", idToUse);
                window.location.href = "replay.html";
            };

            // --- DIGITAL TWIN BUTTON ---
            let twinBtn = null;
            if (climb.routeId && climb.completed === false) {
                twinBtn = document.createElement("div");
                twinBtn.className = "delete-btn-container"; 
                twinBtn.style.background = "var(--digitalTwinColor)";
                twinBtn.style.flexShrink = "0";    // Prevent it from squishing
                
                twinBtn.innerHTML = `
                    <span class="material-symbols-rounded" style="color: var(--mainColor); font-size: 20px;">psychology</span>
                `;

                twinBtn.onclick = (e) => {
                    e.stopPropagation();
                    const idToUse = climb.id || climb._id;
                    window.location.href = `index.html?id=${climb.routeId}&twinOf=${idToUse}`;
                };
            }

            // 2. DELETE BUTTON
            const delBtn = document.createElement("div");
            delBtn.className = "delete-btn-container";
            delBtn.style.flexShrink = "0"; // Keep it circular
            delBtn.innerHTML = `
                <div class="delete-fill" id="fill-${idx}"></div>
                <span class="material-symbols-rounded">close</span>
            `;

            // 3. DELETE LOGIC (Unchanged)
            let holdTimer;
            const fill = delBtn.querySelector('.delete-fill');
            const startHold = (e) => {
                e.stopPropagation();
                fill.style.width = "250%";
                fill.style.height = "250%";
                holdTimer = setTimeout(async () => {
                    const id = climb.id || climb._id;
                    const res = await fetch(`/api/climbs/${id}`, { method: 'DELETE' });
                    if (res.ok) loadSavedAttempts();
                }, 1000);
            };
            const cancelHold = (e) => {
                e.stopPropagation();
                clearTimeout(holdTimer);
                fill.style.transition = "none";
                fill.style.width = "0%";
                fill.style.height = "0%";
                setTimeout(() => { fill.style.transition = "width 1s linear, height 1s linear"; }, 10);
            };

            delBtn.addEventListener("mousedown", startHold);
            delBtn.addEventListener("mouseup", cancelHold);
            delBtn.addEventListener("touchstart", startHold, { passive: false });
            delBtn.addEventListener("touchend", cancelHold, { passive: false });
            delBtn.onclick = (e) => e.stopPropagation();

            // --- FINAL ASSEMBLY (Order is key) ---
            climbRow.appendChild(infoArea);  // Left side
            if (twinBtn) climbRow.appendChild(twinBtn); // Middle
            climbRow.appendChild(delBtn);    // Right side
            
            container.appendChild(climbRow);
        });
    } catch (err) {
        console.error("Load Error:", err);
        container.innerHTML = `<div class="subFont" style="text-align:center; padding:20px; color:var(--accentColor);">Error connecting to server.</div>`;
    }
}

document.addEventListener("DOMContentLoaded", loadSavedAttempts);