(() => {
  let extensionContextActive = true;
  let timerId;

  const sync = () => {
    if (!extensionContextActive) return;
    const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "";
    if (!token) return;
    try {
      chrome.storage.local.set({ token }, () => {
        // Reading lastError prevents Chrome from reporting a noisy warning when
        // the extension is reloaded while this page remains open.
        void chrome.runtime.lastError;
      });
    } catch {
      // The content script can outlive a manually reloaded/removed extension.
      extensionContextActive = false;
      if (timerId) window.clearInterval(timerId);
    }
  };

  sync();
  timerId = window.setInterval(sync, 5000);
})();
