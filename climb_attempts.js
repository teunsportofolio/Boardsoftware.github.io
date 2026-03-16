function loadSavedAttempts() {
    const container = document.getElementById("savedAttempts");
    const totalDisplay = document.getElementById("totalClimbs");
    if (!container) return;

    container.innerHTML = "";
    const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
    
    if (totalDisplay) totalDisplay.textContent = climbs.length;

    climbs.forEach((climb, idx) => {
        // 1. Main Row Wrapper
        const climbRow = document.createElement("div");
        climbRow.className = "climb-item";

        // 2. Info Area (This is the clickable part for Replay)
        const infoArea = document.createElement("div");
        infoArea.className = "climb-info";
        
        const dateStr = climb.timestamp ? new Date(climb.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : "Recently";
        
        infoArea.innerHTML = `
            <span class="climb-name">${climb.name || "Unnamed Climb"}</span>
            <span class="climb-meta">${dateStr} • ${climb.filledSequence ? climb.filledSequence.length : 0} moves</span>
        `;

        // Click logic for the info area only
        infoArea.onclick = (e) => {
            sessionStorage.setItem("replayIndex", idx);
            window.location.href = "replay.html";
        };

        // 3. Delete Button Container
        const delBtn = document.createElement("div");
        delBtn.className = "delete-btn-container";
        delBtn.innerHTML = `
            <div class="delete-fill" id="fill-${idx}"></div>
            <span class="material-symbols-rounded">close</span>
        `;

        // STOP PROPAGATION: Prevents the row from ever seeing clicks meant for delete
        delBtn.onclick = (e) => e.stopPropagation();

        let holdTimer;
        const fill = delBtn.querySelector('.delete-fill');

        const startHold = (e) => {
            e.stopPropagation(); // Stop parent row from highlighting
            fill.style.width = "250%";
            fill.style.height = "250%";

            holdTimer = setTimeout(() => {
                climbs.splice(idx, 1);
                localStorage.setItem("savedClimbs", JSON.stringify(climbs));
                loadSavedAttempts(); // Refresh list
            }, 1000);
        };

        const cancelHold = (e) => {
            e.stopPropagation();
            clearTimeout(holdTimer);
            fill.style.transition = "none";
            fill.style.width = "0%";
            fill.style.height = "0%";
            setTimeout(() => {
                fill.style.transition = "width 1s linear, height 1s linear";
            }, 10);
        };

        // Attach listeners to Delete Button
        delBtn.addEventListener("mousedown", startHold);
        delBtn.addEventListener("mouseup", cancelHold);
        delBtn.addEventListener("mouseleave", cancelHold);
        
        delBtn.addEventListener("touchstart", startHold, { passive: false });
        delBtn.addEventListener("touchend", cancelHold, { passive: false });
        delBtn.addEventListener("touchcancel", cancelHold);

        // Assemble
        climbRow.appendChild(infoArea);
        climbRow.appendChild(delBtn);
        container.appendChild(climbRow);
    });
}

document.addEventListener("DOMContentLoaded", loadSavedAttempts);