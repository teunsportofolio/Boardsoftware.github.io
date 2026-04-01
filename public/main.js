function toggleModal(modalId, show = true) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    if (show) {
        modal.classList.remove("hidden");
    } else {
        modal.classList.add("hidden");
    }
}

// Usage in your endClimb function:
toggleModal('saveModal', true);

// Usage in your cancel button:
toggleModal('saveModal', false);
