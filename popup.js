const apiBaseInput = document.querySelector("#apiBase");
const tokenInput = document.querySelector("#token");
const scanButton = document.querySelector("#scan");
const assistButton = document.querySelector("#assist");
const autofillButton = document.querySelector("#autofill");
const markAppliedButton = document.querySelector("#markApplied");
const hostedTokenButton = document.querySelector("#hostedToken");
const status = document.querySelector("#status");

function showRuntimeError() {
  const message = chrome.runtime.lastError?.message || "The extension background worker is unavailable. Reload it from chrome://extensions.";
  status.textContent = message;
}

chrome.storage.local.get(["apiBase", "token"], (saved) => {
  if (saved.apiBase) apiBaseInput.value = saved.apiBase;
  if (saved.token) tokenInput.value = saved.token;
  syncHostedTokenAutomatically(Boolean(saved.token));
});

function syncHostedTokenAutomatically(hasStoredToken) {
  chrome.runtime.sendMessage({ type: "GET_HOSTED_TOKEN", openIfMissing: false }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.token) {
      tokenInput.value = response.token;
      chrome.storage.local.set({ token: response.token });
      if (!hasStoredToken) status.textContent = "Hosted portfolio token loaded automatically.";
    }
  });
}

hostedTokenButton.addEventListener("click", () => {
  hostedTokenButton.disabled = true;
  status.textContent = "Opening or reading the hosted portfolio login...";
  chrome.runtime.sendMessage({ type: "GET_HOSTED_TOKEN" }, (response) => {
    hostedTokenButton.disabled = false;
    if (chrome.runtime.lastError) {
      showRuntimeError();
      return;
    }
    if (response?.token) {
      tokenInput.value = response.token;
      chrome.storage.local.set({ token: response.token });
    }
    status.textContent = response?.message || "Hosted token loaded.";
  });
});

scanButton.addEventListener("click", async () => {
  const { apiBase, token } = getCredentials();
  if (!apiBase || !token) {
    status.textContent = "Enter the API URL and portfolio login token first.";
    return;
  }

  scanButton.disabled = true;
  status.textContent = "Scanning this page and available pages (up to 5)...";
  chrome.storage.local.set({ apiBase, token });
  try {
    const boardMessage = await sendRuntimeMessage({ type: "SCAN_PAGINATED", apiBase, token, maxPages: 5 });
    const profileMessage = await sendRuntimeMessage({ type: "DISCOVER_PROFILE_JOBS", apiBase, token });
    scanButton.disabled = false;
    status.textContent = `Board scan: ${boardMessage?.message || "finished."}\nProfile feed: ${profileMessage?.message || "finished."}`;
  } catch (error) {
    scanButton.disabled = false;
    status.textContent = error.message || "Unable to scan jobs.";
  }
});

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error("The extension background worker stopped before replying. Open chrome://extensions, reload Portfolio AI Job Scanner, and try again."));
      else resolve(response || {});
    });
  });
}

autofillButton.addEventListener("click", () => {
  const { apiBase, token } = getCredentials();
  if (!apiBase || !token) {
    status.textContent = "Enter the API URL and portfolio login token first.";
    return;
  }

  scanButton.disabled = true;
  autofillButton.disabled = true;
  status.textContent = "Loading your portfolio profile and filling the application...";
  chrome.runtime.sendMessage({ type: "AUTOFILL_APPLICATION", apiBase, token }, (response) => {
    scanButton.disabled = false;
    autofillButton.disabled = false;
    if (chrome.runtime.lastError) {
      showRuntimeError();
      return;
    }
    status.textContent = response?.message || "Autofill finished. Review the form before submitting.";
  });
});

assistButton.addEventListener("click", () => {
  const { apiBase, token } = getCredentials();
  if (!apiBase || !token) {
    status.textContent = "Enter the API URL and portfolio login token first.";
    return;
  }

  assistButton.disabled = true;
  status.textContent = "Opening and preparing the application form...";
  chrome.storage.local.set({ apiBase, token });
  chrome.runtime.sendMessage({ type: "ASSIST_APPLICATION", apiBase, token }, (response) => {
    assistButton.disabled = false;
    if (chrome.runtime.lastError) {
      showRuntimeError();
      return;
    }
    status.textContent = response?.message || "Application prepared. Review it before submitting.";
  });
});

markAppliedButton.addEventListener("click", () => {
  const { apiBase, token } = getCredentials();
  if (!apiBase || !token) {
    status.textContent = "Enter the API URL and portfolio login token first.";
    return;
  }

  markAppliedButton.disabled = true;
  status.textContent = "Updating your application status...";
  chrome.storage.local.set({ apiBase, token });
  chrome.runtime.sendMessage({ type: "MARK_APPLIED", apiBase, token }, (response) => {
    markAppliedButton.disabled = false;
    if (chrome.runtime.lastError) {
      showRuntimeError();
      return;
    }
    status.textContent = response?.message || "Application status updated.";
  });
});

function getCredentials() {
  return {
    apiBase: apiBaseInput.value.trim().replace(/\/$/, ""),
    token: tokenInput.value.trim(),
  };
}
