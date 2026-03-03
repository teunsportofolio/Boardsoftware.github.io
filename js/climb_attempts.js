// ========================
// LOAD SAVED ATTEMPTS WITH HOLD-TO-DELETE
// ========================
function loadSavedAttempts() {
  const container = document.getElementById("savedAttempts");
  container.innerHTML = "";

  const climbs = JSON.parse(localStorage.getItem("savedClimbs") || "[]");
  document.getElementById("totalClimbs").textContent = climbs.length;

  climbs.forEach((climb, idx) => {
    // Row wrapper
    const climbRow = document.createElement("div");
    climbRow.style.display = "flex";
    climbRow.style.alignItems = "center";
    climbRow.style.gap = "8px";

    // Main button to replay climb
    const btn = document.createElement("button");
    btn.className = "savedClimbBtn";
    btn.textContent = climb.name;
    btn.style.flex = "1";

    btn.onclick = () => {
      sessionStorage.setItem("replayIndex", idx);
      window.location.href = "replay.html";
    };

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "deleteBtn";

    const fill = document.createElement("div");
    fill.className = "fill";

    const icon = document.createElement("span");
    icon.textContent = "✕";

    deleteBtn.appendChild(fill);
    deleteBtn.appendChild(icon);

    let holdTimer;

    const startHold = () => {
      // Animate radial fill
      fill.style.width = "150%";
      fill.style.height = "150%";

      // Wait 1s, then delete
      holdTimer = setTimeout(() => {
        climbs.splice(idx, 1);
        localStorage.setItem("savedClimbs", JSON.stringify(climbs));
        loadSavedAttempts();
      }, 1000);
    };

    const cancelHold = () => {
      clearTimeout(holdTimer);
      fill.style.transition = "none";
      fill.style.width = "0%";
      fill.style.height = "0%";
      setTimeout(() => {
        fill.style.transition = "width 1s linear, height 1s linear";
      }, 10);
    };

    // Mouse events
    deleteBtn.addEventListener("mousedown", startHold);
    deleteBtn.addEventListener("mouseup", cancelHold);
    deleteBtn.addEventListener("mouseleave", cancelHold);

    // Touch events
    deleteBtn.addEventListener("touchstart", startHold);
    deleteBtn.addEventListener("touchend", cancelHold);
    deleteBtn.addEventListener("touchcancel", cancelHold);

    climbRow.appendChild(btn);
    climbRow.appendChild(deleteBtn);
    container.appendChild(climbRow);
  });
}

document.getElementById("goClimbBtn").onclick = () => {
  window.location.href = "climb.html";
};

loadSavedAttempts();