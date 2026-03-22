// ===== TAB SYSTEM =====
// Manages tab switching between Explorer, Sequence, Listener, and Settings.

let activeTab = 'explorer';

/**
 * Switch to a tab by ID.
 * @param {string} tabId - 'explorer', 'sequence', 'listener', or 'settings'
 */
export function switchTab(tabId) {
  if (tabId === activeTab) return;
  activeTab = tabId;

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.id === 'tab-' + tabId;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });

  // Update desktop tab bar
  document.querySelectorAll('.tab-bar .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update mobile tab bar
  document.querySelectorAll('.tab-bar-mobile .tab-btn-mobile').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
}

/**
 * Get the currently active tab ID.
 * @returns {string}
 */
export function getActiveTab() {
  return activeTab;
}
