window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "portfolio-ai" || event.data?.type !== "APPLICATION_SUBMITTED") return;
  chrome.runtime.sendMessage({
    type: "APPLICATION_SUBMITTED",
    apiBase: event.data.apiBase,
    token: event.data.token,
    applicationUrl: event.data.applicationUrl,
  }, () => {
    // Consume runtime.lastError so a background tracking failure does not
    // surface as an unhandled "message port closed" error in the page.
    void chrome.runtime.lastError;
  });
});
