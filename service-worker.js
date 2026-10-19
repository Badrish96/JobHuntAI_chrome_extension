import { startEasyApplyAssistant } from "./background/application-assistant.js";
import { SCANNER_BUILD, scanActiveTab } from "./background/job-scan.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCAN_ACTIVE_TAB") {
    respondWith(scanActiveTab(message.apiBase, message.token), sendResponse, "Unable to scan this page.");
    return true;
  }
  if (message?.type === "SCAN_PAGINATED") {
    respondWith(scanPaginatedActiveTab(message.apiBase, message.token, message.maxPages), sendResponse, "Unable to scan multiple job-board pages.");
    return true;
  }
  if (message?.type === "DISCOVER_PROFILE_JOBS") {
    respondWith(discoverProfileJobs(message.apiBase, message.token), sendResponse, "Unable to search jobs from your profile.");
    return true;
  }
  if (message?.type === "AUTOFILL_APPLICATION") {
    respondWith(autofillApplication(message.apiBase, message.token), sendResponse, "Unable to autofill this application.");
    return true;
  }
  if (message?.type === "ASSIST_APPLICATION") {
    respondWith(assistApplication(message.apiBase, message.token), sendResponse, "Unable to prepare this application.");
    return true;
  }
  if (message?.type === "MARK_APPLIED") {
    respondWith(markApplied(message.apiBase, message.token), sendResponse, "Unable to update the application status.");
    return true;
  }
  if (message?.type === "GET_HOSTED_TOKEN") {
    respondWith(getHostedToken({ openIfMissing: message.openIfMissing !== false }), sendResponse, "Unable to read the hosted portfolio session.");
    return true;
  }
  if (message?.type === "HOSTED_TOKEN_FOUND" && sender.tab?.url && /^https:\/\/my-portfolio-frontend-chi-five\.vercel\.app\//i.test(sender.tab.url || "") && typeof message.token === "string" && message.token.trim()) {
    chrome.storage.local.set({ token: message.token.trim() });
    sendResponse({ saved: true });
    return true;
  }
  if (message?.type === "APPLICATION_SUBMITTED") {
    respondWith(markSubmittedUrl(message.apiBase, message.token, message.applicationUrl), sendResponse, "Automatic application tracking failed.");
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && /^https:\/\/my-portfolio-frontend-chi-five\.vercel\.app\//i.test(tab?.url || "")) {
    syncHostedTokenFromTabs().catch(() => {});
  }
});

function respondWith(promise, sendResponse, fallbackMessage) {
  let replied = false;
  const reply = (result) => {
    if (replied) return;
    replied = true;
    try { sendResponse(result); } catch { /* The popup may have closed. */ }
  };
  const timeout = setTimeout(() => reply({ message: `${fallbackMessage} The extension worker timed out; reopen the popup and try again.` }), 120_000);
  Promise.resolve(promise)
    .then((result) => { clearTimeout(timeout); reply(result); })
    .catch((error) => { clearTimeout(timeout); reply({ message: error?.message || fallbackMessage }); });
}

async function getProfile(apiBase, token) {
  const response = await fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.user) throw new Error(result.message || `Profile request failed with HTTP ${response.status}.`);
  return result.user;
}

async function getBundledResume() {
  try {
    // The resume is packaged with the extension. The version query prevents
    // Chrome from reusing a stale asset after the extension is reloaded.
    const response = await fetch(chrome.runtime.getURL("assets/Badrish_Choubey_Resume.pdf?version=0.1.19"), { cache: "no-store" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return { name: "Badrish_Choubey_Resume.pdf", type: "application/pdf", base64: btoa(binary), source: "extension-bundle" };
  } catch (error) {
    console.warn("Bundled resume could not be loaded:", error.message);
    return null;
  }
}

async function readHostedTokenFromTab(tab) {
  if (!tab?.id || !/^https:\/\/my-portfolio-frontend-chi-five\.vercel\.app\//i.test(tab.url || "")) return "";
  const [{ result: token }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "",
  });
  return typeof token === "string" ? token : "";
}

async function syncHostedTokenFromTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://my-portfolio-frontend-chi-five.vercel.app/*"] });
  for (const tab of tabs) {
    try {
      const token = await readHostedTokenFromTab(tab);
      if (token) {
        await chrome.storage.local.set({ token });
        return token;
      }
    } catch {
      // The tab may still be loading or may not be scriptable yet.
    }
  }
  return "";
}

async function getHostedToken({ openIfMissing = true } = {}) {
  const hostedUrl = "https://my-portfolio-frontend-chi-five.vercel.app/";
  const syncedToken = await syncHostedTokenFromTabs();
  if (syncedToken) return { token: syncedToken, message: "Hosted portfolio token loaded automatically." };
  if (!openIfMissing) return { message: "No active hosted portfolio session found." };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/my-portfolio-frontend-chi-five\.vercel\.app\//i.test(tab.url || "")) {
    await chrome.tabs.create({ url: `${hostedUrl}login` });
    return { message: "Hosted portfolio login opened. After login, the token will be saved automatically." };
  }
  const token = await readHostedTokenFromTab(tab);
  if (!token) return { message: "No hosted authToken found. Log in to the Vercel portfolio first." };
  await chrome.storage.local.set({ token });
  return { token, message: "Hosted portfolio token loaded. The Render API URL will be used." };
}

async function autofillApplication(apiBase, token) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) return { message: "Open the application page in the active tab first." };
  const profile = await getProfile(apiBase, token);
  const resume = await getBundledResume();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillApplicationFields,
    args: [profile, resume],
  });
  const resumeMessage = result?.resumeAttached ? " Resume attached." : " Resume still needs manual attachment.";
  const manualMessage = result?.manualRequired ? ` ${result.manualRequired} required item(s), such as consent or unsupported files, still need your review.` : "";
  if (!result?.matched && !result?.resumeAttached) return { message: result?.manualRequired ? `No safe profile fields were found.${manualMessage}` : "No matching application fields were found on this page." };
  if (!result.filled) return { message: `Found ${result.matched} matching field(s), but the job site did not accept the profile values.${resumeMessage}${manualMessage} Try opening the dropdowns once, then run autofill again.` };
  return { message: `Filled ${result.filled} of ${result.matched} matching field(s).${resumeMessage}${manualMessage} Review every answer before submitting.` };
}

async function discoverProfileJobs(apiBase, token) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const [generalResponse, careerResponse] = await Promise.all([
    fetch(`${apiBase}/api/jobs/discover`, { method: "POST", headers, body: "{}" }),
    fetch(`${apiBase}/api/jobs/discover-careers`, { method: "POST", headers, body: "{}" }),
  ]);
  const general = await generalResponse.json().catch(() => ({}));
  const careers = await careerResponse.json().catch(() => ({}));
  if (!generalResponse.ok && !careerResponse.ok) throw new Error(general.message || careers.message || "Profile job search failed.");
  return {
    message: `Found ${general.discovered || 0} job-board jobs and ${careers.discovered || 0} career-page jobs using your saved profile.${general.aiFailures || careers.aiFailures ? " Some AI scores could not be calculated." : ""}`,
  };
}

async function assistApplication(apiBase, token) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) return { message: "Open a job application page first." };
  const profile = await getProfile(apiBase, token);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: startEasyApplyAssistant,
    args: [profile, apiBase, token],
  });
  return { message: result?.message || "Application prepared. Review it before submitting." };
}

async function markApplied(apiBase, token) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) return { message: "Open the submitted job application page first." };
  let jobHints = {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const read = (selectors) => selectors
          .map((selector) => document.querySelector(selector)?.innerText?.trim())
          .find((value) => value && value.length <= 200) || "";
        const titleCandidates = [
          read(['[data-automation="job-title"]', '[data-testid*="job-title" i]', 'main h1', 'main h2', "h1"]),
          document.querySelector('meta[property="og:title"]')?.content || "",
          document.title || "",
        ].map((value) => value.trim()).filter((value) => value && !/easy apply|personal information|application form|careers? at/i.test(value));
        let company = read(['[data-automation*="company" i]', '[data-testid*="company" i]', '[class*="company-name" i]', '[class*="companyName"]']);
        if (!company) {
          const segment = location.pathname.match(/\/company\/([^/]+)\/publication\//i)?.[1] || "";
          company = decodeURIComponent(segment).replace(/\d+$/, "").replace(/[-_]+/g, " ");
        }
        return { title: titleCandidates[0] || "", company };
      },
    });
    jobHints = result || {};
  } catch {
    // The URL and stable job ID are still sent if the page blocks inspection.
  }
  return markSubmittedUrl(apiBase, token, tab.url, jobHints);
}

async function markSubmittedUrl(apiBase, token, applicationUrl, jobHints = {}) {
  const response = await fetch(`${apiBase}/api/applications/mark-submitted`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicationUrl, title: jobHints.title, company: jobHints.company }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Status update failed with HTTP ${response.status}.`);
  return { message: `Marked as applied: ${result.application?.job?.title || "job"}.` };
}

async function fillApplicationFields(profile, resumeAsset) {
  const fullName = profile.name || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");
  const currentLocation = profile.currentLocation || profile.location || profile.preferredLocations?.[0] || "";
  const address = profile.address || "E141 Dharam colony palam vihar Near Geeta properties Gurugram Haryana 122017";
  const city = profile.city || "Gurugram";
  const state = profile.state || "Haryana";
  const postalCode = profile.postalCode || "122017";
  const country = profile.country || "India";
  const phoneDigits = String(profile.mobilePhone || "").replace(/[^0-9]/g, "");
  const countryCode = String(profile.countryCode || "+91").replace(/[^0-9+]/g, "") || "+91";
  const mobilePhone = phoneDigits ? `${countryCode.startsWith("+") ? countryCode : `+${countryCode}`}${phoneDigits}` : "";
  const currentSalary = profile.currentSalary ?? "";
  const expectedSalary = profile.expectedSalary ?? profile.expectedCompensation ?? "";
  const noticePeriod = profile.noticePeriod || (Number(profile.availableToJoin ?? 0) === 0 ? "Immediate Joiner" : String(profile.availableToJoin ?? ""));
  const values = {
    firstName: profile.firstName || fullName.split(/\s+/)[0] || "",
    middleName: profile.middleName || "",
    lastName: profile.lastName || fullName.split(/\s+/).slice(1).join(" ") || "",
    name: fullName,
    email: profile.email || "",
    username: profile.username || "",
    mobilePhone,
    countryCode,
    gender: profile.gender || "",
    nationality: profile.nationality || "",
    dateOfBirth: profile.dateOfBirth || "",
    city,
    address,
    location: city,
    state,
    province: state,
    postalCode,
    zipCode: postalCode,
    pinCode: postalCode,
    country,
    phoneCountry: country,
    website: profile.website || "",
    bio: profile.bio || "",
    skills: (profile.skills || []).join(", "),
    roles: (profile.preferredRoles || []).join(", "),
    experience: profile.experienceYears == null ? "" : String(profile.experienceYears),
    relevantExperience: profile.relevantExperienceYears == null ? "" : String(profile.relevantExperienceYears),
    experienceDetails: profile.experienceDetails || "",
    currentSalary: currentSalary == null ? "" : String(currentSalary),
    currentSalaryCurrency: profile.currentSalaryCurrency || "",
    compensationHikeExpectations: profile.compensationHikeExpectations || "",
    expectedSalary: expectedSalary == null ? "" : String(expectedSalary),
    expectedSalaryCurrency: profile.expectedSalaryCurrency || "",
    availableToJoin: profile.availableToJoin == null ? "" : String(profile.availableToJoin),
    resumeSummary: profile.resumeSummary || profile.bio || "",
    education: profile.educationDetails || "",
    projects: profile.projectDetails || "",
    certifications: profile.certifications || "",
    achievements: profile.achievements || "",
    languages: profile.languages || "",
    workAuthorization: profile.workAuthorization || "",
    noticePeriod: noticePeriod == null ? "" : String(noticePeriod),
    linkedin: profile.linkedinUrl || "",
    github: profile.githubUrl || "",
    portfolio: profile.portfolioUrl || profile.website || "",
  };
  const rules = [
    { key: "firstName", patterns: /(^|\b)(first[ -]?name|given name)(\b|$)/i },
    { key: "middleName", patterns: /(^|\b)middle[ -]?name(\b|$)/i },
    { key: "lastName", patterns: /(^|\b)(last[ -]?name|surname|family name)(\b|$)/i },
    { key: "name", patterns: /(^|\b)(full[ -]?name|your name|first and last name)(\b|$)/i },
    { key: "email", patterns: /(^|\b)(e[ -]?mail|email address)(\b|$)/i },
    { key: "username", patterns: /(^|\b)(username|user name)(\b|$)/i },
    { key: "phoneCountry", patterns: /(^|\b)(phone\s*country|country for (?:phone|mobile)|mobile country)(\b|$)/i },
    { key: "countryCode", patterns: /(^|\b)(country|phone)[ -]?(code|dialing code|dial code)(\b|$)/i },
    { key: "mobilePhone", patterns: /(^|\b)(mobile|phone|telephone|contact number)(\b|$)/i },
    { key: "gender", patterns: /(^|\b)(gender|sex)(\b|$)/i },
    { key: "nationality", patterns: /(^|\b)nationality(\b|$)/i },
    { key: "dateOfBirth", patterns: /(^|\b)(date of birth|birth date|dob)(\b|$)/i },
    { key: "address", patterns: /(^|\b)(address|current residence address|residence address|street address|mailing address|home address)(\b|$)/i },
    { key: "city", patterns: /(^|\b)(location\s*\(?\s*city|city|town)(\b|$)/i },
    { key: "state", patterns: /(^|\b)(state|province|region)(\b|$)/i },
    { key: "postalCode", patterns: /(^|\b)(pin|pin code|postal|postal code|zip|zip code)(\b|$)/i },
    { key: "country", patterns: /(^|\b)(country|country\/region|country region)(\b|$)/i },
    { key: "location", patterns: /(^|\b)(current location|location)(\b|$)/i },
    { key: "linkedin", patterns: /(^|\b)(linkedin|linkedin profile|linkedin url)(\b|$)/i },
    { key: "github", patterns: /(^|\b)(github|github profile|github url)(\b|$)/i },
    { key: "portfolio", patterns: /(^|\b)(portfolio|portfolio url|personal site)(\b|$)/i },
    { key: "website", patterns: /(^|\b)(website|personal website|website url)(\b|$)/i },
    { key: "resumeSummary", patterns: /(^|\b)(professional summary|summary|about me|about you|profile|career objective|introduction)(\b|$)/i },
    { key: "skills", patterns: /(^|\b)(skills|technologies|tech stack|programming languages)(\b|$)/i },
    { key: "roles", patterns: /(^|\b)(desired role|preferred role|job title|position)(\b|$)/i },
    { key: "relevantExperience", patterns: /(^|\b)(relevant experience|experience in the role|experience aligns?|aligned experience|how much.*experience.*(align|relevant))(\b|$)/i },
    { key: "experience", patterns: /(^|\b)(total( professional)? experience|years of experience|experience years|professional experience years)(\b|$)/i },
    { key: "experienceDetails", patterns: /(^|\b)(experience details|relevant experience description|professional experience|work experience|employment history)(\b|$)/i },
    { key: "education", patterns: /(^|\b)(education|academic background|degree|qualification|college|university)(\b|$)/i },
    { key: "projects", patterns: /(^|\b)(projects|portfolio projects|project experience|personal projects)(\b|$)/i },
    { key: "certifications", patterns: /(^|\b)(certifications?|licenses?)(\b|$)/i },
    { key: "achievements", patterns: /(^|\b)(achievements|awards|accomplishments)(\b|$)/i },
    { key: "languages", patterns: /(^|\b)(languages|spoken languages)(\b|$)/i },
    { key: "workAuthorization", patterns: /(^|\b)(work authorization|right to work|visa sponsorship|eligible to work)(\b|$)/i },
    { key: "noticePeriod", patterns: /(^|\b)(notice period|notice period obligation|current notice|availability to join|joining availability|available to join|when can you join|lead time(?: to join)?|days? to join)(\b|$)/i },
    { key: "currentSalaryCurrency", patterns: /(^|\b)(current salary currency|current compensation currency)(\b|$)/i },
    { key: "currentSalary", patterns: /(^|\b)(current salary|current annual salary|annual salary|current annual fixed compensation|annual fixed compensation|current fixed compensation|current annual compensation|current compensation|current ctc|current package|current pay)(\b|$)/i },
    { key: "compensationHikeExpectations", patterns: /(^|\b)(compensation hike|hike expectations?|salary hike|expected hike|increment expectations?|pay raise|raise expectations?)(\b|$)/i },
    { key: "expectedSalaryCurrency", patterns: /(^|\b)(expected salary currency|desired salary currency)(\b|$)/i },
    { key: "expectedSalary", patterns: /(^|\b)(expected salary|desired salary|salary expectations?|expected compensation|desired compensation|pay expectations?|desired pay|what.*want.*(pay|salary)|salary range)(\b|$)/i },
    { key: "availableToJoin", patterns: /(^|\b)(available to join|joining days|notice period|days? to join|lead time(?: to join)?)(\b|$)/i },
  ];
  const queryDeep = (root, selector) => {
    const matches = [...root.querySelectorAll(selector)];
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) matches.push(...queryDeep(element.shadowRoot, selector));
    }
    return matches;
  };
  let filled = 0;
  let matched = 0;
  let manualRequired = 0;
  let resumeAttached = 0;
  const fields = [...new Set(queryDeep(document, "input, textarea, select, [role='combobox']"))];
  const waitForDropdown = () => new Promise((resolve) => setTimeout(resolve, 80));
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").replace(/\s+/g, " ").trim();
  const directDescriptionFor = (field) => {
    const parts = [field.name, field.id, field.placeholder, field.getAttribute("aria-label"), field.getAttribute("autocomplete")].filter(Boolean);
    const labels = [field.labels?.[0], field.closest("label")].filter(Boolean);
    labels.forEach((label) => parts.push(label.textContent || ""));
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  const descriptionFor = (field) => {
    const parts = [directDescriptionFor(field)];
    let node = field.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1) {
      const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 180) parts.push(text);
      node = node.parentElement || node.getRootNode?.().host || null;
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  const setInputValue = (field, value) => {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(field, value); else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  };
  const key = (field, name) => {
    const event = { key: name, code: name, bubbles: true, cancelable: true, composed: true };
    field.dispatchEvent(new KeyboardEvent("keydown", event));
    field.dispatchEvent(new KeyboardEvent("keypress", event));
    field.dispatchEvent(new KeyboardEvent("keyup", event));
  };
  const salaryBandQuery = (amount) => {
    const bands = [[0, 500000, "0"], [500001, 800000, "500,001"], [800001, 1000000, "800,001"], [1000001, 1200000, "1,000,001"], [1200001, 1400000, "1,200,001"], [1400001, 1600000, "1,400,001"], [1600001, 1800000, "1,600,001"], [1800001, 2000000, "1,800,001"], [2000001, 2200000, "2,000,001"], [2200001, 2500000, "2,200,001"], [2500001, 3000000, "2,500,001"], [3000001, 3500000, "3,000,001"]];
    return bands.find(([min, max]) => amount >= min && amount <= max)?.[2] || String(amount);
  };
  const comboboxQueries = (ruleKey, value) => {
    if (["currentSalary", "expectedSalary"].includes(ruleKey)) return [salaryBandQuery(Number(value)), String(value), Number(value).toLocaleString("en-IN")];
    if (ruleKey === "countryCode") return [String(value), String(value).replace(/^\+/, ""), "India"];
    if (ruleKey === "phoneCountry") return [String(value), "India"];
    if (ruleKey === "compensationHikeExpectations") return [String(value)];
    if (ruleKey === "noticePeriod") return /immediate/i.test(String(value)) || Number(value) === 0 ? ["Immediate Joiner", "Immediate", "0"] : [String(value), `${value} days`];
    if (["experience", "relevantExperience"].includes(ruleKey)) return Number(value) >= 4 && Number(value) <= 7 ? ["4 to 7", "4 to 7 Year", String(value)] : [String(value)];
    return [String(value)];
  };
  const chooseComboboxOption = async (field, ruleKey, value) => {
    const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects?.().length));
    const expectedSelection = (selected, query) => {
      const actual = String(selected || "").toLowerCase().replace(/[,\s]/g, "");
      const wanted = String(query || "").toLowerCase().replace(/[,\s]/g, "");
      if (!actual) return false;
      if (["currentSalary", "expectedSalary"].includes(ruleKey)) return actual.includes(wanted);
      if (["experience", "relevantExperience"].includes(ruleKey)) return /4to7/.test(actual);
      if (ruleKey === "noticePeriod") return actual.includes(wanted) || (/immediate/i.test(String(query)) && /immediatejoiner|immediate/.test(actual));
      return actual.includes(wanted);
    };
    for (const query of comboboxQueries(ruleKey, value)) {
      field.focus();
      field.click();
      setInputValue(field, "");
      setInputValue(field, query);
      await waitForDropdown();
      const normalizedQuery = query.toLowerCase().replace(/[,\s]/g, "");
      const options = queryDeep(document, "[role='option'], [role='listbox'] li").filter(visible);
      const option = options.find((candidate) => {
        const text = String(candidate.innerText || candidate.textContent || "").trim();
        const normalizedText = text.toLowerCase().replace(/[,\s]/g, "");
        return text && (normalizedText === normalizedQuery || normalizedText.startsWith(normalizedQuery) || normalizedText.includes(normalizedQuery));
      });
      if (option) {
        option.click();
        await waitForDropdown();
        if (expectedSelection(field.value, query)) {
          field.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          return true;
        }
      }
      if (field.getAttribute("aria-expanded") === "true" && options.length) {
        key(field, "ArrowDown");
        key(field, "Enter");
        await waitForDropdown();
        if (expectedSelection(field.value, query)) {
          field.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          return true;
        }
      }
    }
    return false;
  };
  const selectOption = (field, value, ruleKey) => {
    const rawValues = ruleKey === "countryCode"
      ? [value, String(value).replace(/^\+/, ""), "India"]
      : ruleKey === "phoneCountry" ? [value, "India"] : comboboxQueries(ruleKey, value);
    const wantedValues = rawValues.map(normalize).filter(Boolean);
    const option = [...field.options].find((item) => {
      const optionText = normalize(`${item.value} ${item.text}`);
      return wantedValues.some((wanted) => optionText === wanted || optionText.includes(wanted));
    });
    if (!option) return false;
    field.value = option.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const attachFile = (field) => {
    try {
      if (!resumeAsset?.base64 || field.files?.length) return false;
      const binary = atob(resumeAsset.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const file = new File([bytes], resumeAsset.name, { type: resumeAsset.type || "application/pdf" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      field.files = transfer.files;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return field.files?.length === 1;
    } catch {
      return false;
    }
  };
  for (const field of fields) {
    if (field.disabled || field.readOnly) continue;
    const directDescription = directDescriptionFor(field);
    const description = descriptionFor(field);
    const normalizedDescription = normalize(description);
    if (field.type === "file") {
      const isResumeField = /resume|curriculum vitae|(^|\b)cv(\b|\/)/i.test(`${description} ${field.accept || ""}`) && !/cover\s*letter/i.test(description);
      if (isResumeField && attachFile(field)) resumeAttached += 1;
      else if (field.required || field.getAttribute("aria-required") === "true") manualRequired += 1;
      continue;
    }
    if (field.type === "checkbox" || field.type === "radio") {
      if (!field.checked && (field.required || field.getAttribute("aria-required") === "true" || /privacy|agree|consent|terms/.test(normalizedDescription))) manualRequired += 1;
      continue;
    }
    const currencySelect = field.tagName === "SELECT" && [...field.options].some((option) => /^[A-Z]{3}$/.test(option.value.trim()) || /^[A-Z]{3}$/.test(option.text.trim()));
    const phoneCodeSelect = field.tagName === "SELECT" && [...field.options].some((option) => /^\+\d/.test(option.value.trim()) || /^\+\d/.test(option.text.trim()));
    let rule = rules.find((item) => item.patterns.test(directDescription)) || rules.find((item) => item.patterns.test(description));
    if (phoneCodeSelect && /phone|mobile|country|dial/i.test(description)) rule = rules.find((item) => item.key === "countryCode");
    if (!phoneCodeSelect && /phone\s*country|country for (?:phone|mobile)/i.test(description)) rule = rules.find((item) => item.key === "phoneCountry");
    if (currencySelect && /(current salary|current (annual )?(fixed )?compensation|annual fixed compensation|current ctc|current package)/i.test(description)) rule = rules.find((item) => item.key === "currentSalaryCurrency");
    if (currencySelect && /expected salary|desired salary/i.test(description)) rule = rules.find((item) => item.key === "expectedSalaryCurrency");
    if (!rule && field.type === "email") rule = rules.find((item) => item.key === "email");
    if (!rule && field.type === "tel") rule = rules.find((item) => item.key === "mobilePhone");
    if (!rule || values[rule.key] === "" || values[rule.key] == null) continue;
    if (String(field.value || "").trim()) continue;
    const value = values[rule.key];
    matched += 1;
    if (field.getAttribute("role") === "combobox") {
      if (await chooseComboboxOption(field, rule.key, value)) filled += 1;
      continue;
    }
    if (field.tagName === "SELECT") {
      if (selectOption(field, value, rule.key)) filled += 1;
      continue;
    } else {
      const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(field, value); else field.value = value;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    filled += 1;
  }
  return { filled, matched, manualRequired, resumeAttached: resumeAttached > 0 };
}

/*
 * Keep the scan handler below the application handler so both popup actions
 * share the same worker and authentication path.
 */
async function clickNextResultsPage() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return false;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: () => {
      const visible = (element) => Boolean(element && !element.disabled && element.getAttribute("aria-disabled") !== "true" && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      const label = (element) => `${element.innerText || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim();
      // Naukri uses a custom numbered pager. Its controls do not reliably
      // expose aria-current/rel=next, so resolve the next number explicitly.
      if (/(^|\.)naukri\.com$/i.test(location.hostname)) {
        const controls = [...document.querySelectorAll('a, button, [role="button"]')]
          .filter((element) => visible(element));
        const pagerContainers = [...document.querySelectorAll('nav, [class*="pagination" i], [class*="pager" i], [class*="page" i]')]
          .filter((element) => visible(element))
          .filter((element) => {
            const text = (element.innerText || "").replace(/\s+/g, " ").trim();
            return /\b(?:previous|prev|next)\b/i.test(text) && /\b\d+\b/.test(text);
          });
        const pager = pagerContainers.sort((left, right) => left.querySelectorAll('a, button, [role="button"]').length - right.querySelectorAll('a, button, [role="button"]').length)[0] || null;
        const scopedControls = pager
          ? controls.filter((element) => pager.contains(element))
          : [];
        const usableControls = scopedControls.length ? scopedControls : controls;
        const pageControls = usableControls.filter((element) => /^\d+$/.test((element.innerText || "").trim()));
        const selected = usableControls.find((element) => {
          const text = label(element);
          const className = typeof element.className === "string" ? element.className : "";
          return element.getAttribute("aria-current") === "page"
            || element.getAttribute("aria-current") === "true"
            || element.getAttribute("aria-selected") === "true"
            || /\b(active|selected|current)\b/i.test(className)
            || /\b(?:active|selected|current)\b/i.test(text);
        });
        const url = new URL(location.href);
        const urlPage = Number.parseInt(url.searchParams.get("page"), 10);
        const selectedPage = Number.parseInt((selected?.innerText || selected?.getAttribute("aria-label") || "").match(/\d+/)?.[0] || "", 10);
        const currentPage = Number.isFinite(urlPage) && urlPage > 0
          ? urlPage
          : (Number.isFinite(selectedPage) && selectedPage > 0 ? selectedPage : 1);
        const targetPage = currentPage + 1;
        const numericNext = pageControls.find((element) => (element.innerText || "").trim() === String(targetPage));
        const labeledNext = usableControls.find((element) => {
          const text = label(element);
          return /\bnext\b/i.test(text) || /^\s*[>\u203a\u00bb]\s*$/.test(text);
        });
        const nextControl = numericNext || labeledNext;
        if (nextControl) {
          const before = marker();
          nextControl.scrollIntoView({ behavior: "smooth", block: "center" });
          if (nextControl.tagName === "A" && nextControl.href && new URL(nextControl.href, location.href).origin === location.origin) {
            return { clicked: true, before, href: new URL(nextControl.href, location.href).toString(), expectedPage: targetPage };
          }
          nextControl.click();
          return { clicked: true, before, expectedPage: targetPage };
        }
        // Some Naukri builds render page numbers without an href. Make the
        // next result page addressable while preserving all search filters.
        url.searchParams.set("page", String(targetPage));
        return { clicked: true, before: marker(), href: url.toString(), expectedPage: targetPage };
      }
      let naukriNext = null;
      // Naukri's pager is often rendered as plain numbered controls without
      // stable aria attributes. Prefer the next number over generic Next
      // matches, which can point at unrelated site navigation.
      if (/(^|\.)naukri\.com$/i.test(location.hostname)) {
        const url = new URL(location.href);
        const currentFromUrl = Number.parseInt(url.searchParams.get("page"), 10);
        const controls = [...document.querySelectorAll('a, button, [role="button"]')]
          .filter((element) => visible(element));
        const selected = controls.find((element) => {
          const className = typeof element.className === "string" ? element.className : "";
          return element.getAttribute("aria-current") === "page"
            || element.getAttribute("aria-current") === "true"
            || element.getAttribute("aria-selected") === "true"
            || /\b(active|selected|current)\b/i.test(className);
        });
        const selectedPage = Number.parseInt((selected?.innerText || "").trim(), 10);
        const currentPage = Number.isFinite(currentFromUrl) && currentFromUrl > 0
          ? currentFromUrl
          : (Number.isFinite(selectedPage) && selectedPage > 0 ? selectedPage : 1);
        const targetPage = currentPage + 1;
        naukriNext = controls.find((element) => {
          if ((element.innerText || "").trim() !== String(targetPage)) return false;
          const parentText = element.parentElement?.parentElement?.innerText || "";
          return /\b(?:previous|prev|next)\b/i.test(parentText) || /\b\d+\b/.test(parentText);
        }) || controls.find((element) => /\bnext\b/i.test(label(element)));
        if (!naukriNext) {
          url.searchParams.set("page", String(targetPage));
          return { clicked: true, before: marker(), href: url.toString(), expectedPage: targetPage };
        }
      }
      const selectors = [
        '[aria-label*="next" i]', '[title*="next" i]',
        '.artdeco-pagination__button--next',
        '[data-testid*="next" i]', '[class*="next" i]',
      ];
      const candidates = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
        .filter(visible)
        .filter((element) => /\bnext\b|›|»|→/i.test(label(element)));
      const fallback = [...document.querySelectorAll("button, a")].find((element) => visible(element) && /^\s*(next|next page|›|»|→)\s*$/i.test(label(element)));
      const next = candidates[0] || fallback;
      if (!next) return false;
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      next.click();
      return true;
    },
  });
  return Boolean(result);
}

async function scanPaginatedActiveTab(apiBase, token, requestedMaxPages = 5) {
  const maxPages = Math.min(Math.max(Number(requestedMaxPages) || 5, 1), 5);
  let pagesScanned = 0;
  let imported = 0;
  let stoppedEarly = false;
  let stopReason = "";
  const messages = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await scanActiveTab(apiBase, token);
    pagesScanned = page;
    imported += result.imported || 0;
    if (result.message) messages.push(`Page ${page}: ${result.message}`);
    if (page === maxPages) break;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (/indeed\.[a-z.]+/i.test(activeTab?.url || "")) {
      // Indeed's first scan already exhausts the lazy-loaded result feed.
      break;
    }
    const next = await clickAndWaitForNextResultsPage();
    if (!next?.clicked || !next.changed) {
      stoppedEarly = true;
      stopReason = !next?.clicked ? "the next-page control or page URL was not found" : "the page change after clicking Next could not be confirmed";
      break;
    }
  }
  const stopMessage = stoppedEarly ? ` Pagination stopped because ${stopReason || "the next page could not be detected"}.` : "";
  const [finalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pagingMode = /linkedin\.com/i.test(finalTab?.url || "") && /\/jobs\/search-results/i.test(finalTab?.url || "")
    ? " LinkedIn offset paging is active."
    : /naukri\.com/i.test(finalTab?.url || "")
      ? " Naukri numbered paging is active."
      : "";
  return { message: `[${SCANNER_BUILD}] Scanned ${pagesScanned} page(s) and imported ${imported} job(s).${pagingMode}${stopMessage} ${messages.join(" ")}`.trim() };
}

async function clickAndWaitForNextResultsPage() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return { clicked: false, changed: false };
  const activeUrl = String(activeTab.url || "");
  if (/linkedin\.com/i.test(activeUrl) && /\/jobs\/search-results/i.test(activeUrl)) {
    const nextUrl = new URL(activeUrl);
    const currentStart = Number.parseInt(nextUrl.searchParams.get("start"), 10) || 0;
    nextUrl.searchParams.set("start", String(currentStart + 25));
    await chrome.tabs.update(activeTab.id, { url: nextUrl.toString() });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const currentTab = await chrome.tabs.get(activeTab.id).catch(() => null);
      if (currentTab && currentTab.status !== "loading") {
        const currentUrl = String(currentTab.url || "");
        const currentOffset = Number.parseInt(new URL(currentUrl).searchParams.get("start"), 10) || 0;
        if (currentOffset >= currentStart + 25 && /linkedin\.com/i.test(currentUrl) && /\/jobs\/search-results/i.test(currentUrl)) return { clicked: true, changed: true };
      }
    }
    return { clicked: true, changed: false };
  }
  const [{ result: clickResult }] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: () => {
      const visible = (element) => Boolean(element && !element.disabled && element.getAttribute("aria-disabled") !== "true" && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      const label = (element) => `${element.innerText || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim();
      const marker = () => {
        const pager = document.querySelector('.jobs-search-pagination, .artdeco-pagination, nav[aria-label*="pagination" i], [class*="pagination"]');
        const pageControl = pager?.querySelector('[aria-current="page"], [aria-current="true"], [class*="active"], [class*="current"]');
        const pageNumber = (pageControl?.innerText || pageControl?.getAttribute("aria-label") || "").match(/\d+/)?.[0] || "";
        const resultLinks = [...document.querySelectorAll("a[href]")]
          .filter(visible)
          .filter((element) => /job|career|position|vacanc|opening/i.test(element.href))
          .map((element) => element.href)
          .filter((href, index, all) => all.indexOf(href) === index)
          .slice(0, 40)
          .join("|");
        const cardText = [...document.querySelectorAll('article, [data-job-id], [data-jobid], [class*="job-card"], [class*="jobCard"], [class*="jobTuple"], [class*="job-tuple"]')]
          .filter(visible)
          .slice(0, 30)
          .map((element) => label(element).slice(0, 140))
          .join("|");
        return `${location.href}|${pageNumber}|${label(pageControl || {})}|${resultLinks}|${cardText}`;
      };
      // LinkedIn's visible pager is not a stable DOM contract. Handle its
      // search-results offset before inspecting controls so this path works
      // even when the Next control is virtualized or hidden behind the split
      // results pane.
      if (/(^|\.)linkedin\.com$/i.test(location.hostname) && /\/jobs\/search-results/i.test(location.pathname)) {
        const linkedinUrl = new URL(location.href);
        const currentStart = Number.parseInt(linkedinUrl.searchParams.get("start"), 10) || 0;
        linkedinUrl.searchParams.set("start", String(currentStart + 25));
        return { clicked: true, before: marker(), href: linkedinUrl.toString(), expectedPage: Math.floor(currentStart / 25) + 2 };
      }
      if (/(^|\.)linkedin\.com$/i.test(location.hostname)) {
        const pager = document.querySelector('.jobs-search-pagination, .artdeco-pagination, nav[aria-label*="pagination" i], [class*="pagination"]');
        const current = pager?.querySelector('[aria-current="page"], [aria-current="true"], [class*="active"], [class*="current"]');
        const currentNumber = Number.parseInt((current?.innerText || current?.getAttribute("aria-label") || "").match(/\d+/)?.[0] || "", 10);
        if (Number.isFinite(currentNumber)) {
          const targetNumber = currentNumber + 1;
          const numberedNext = [...(pager || document).querySelectorAll('button, a, [role="button"]')]
            .filter((element) => visible(element))
            .find((element) => (element.innerText || "").trim() === String(targetNumber)
              || new RegExp(`\\bpage\\s+${targetNumber}\\b`, "i").test(element.getAttribute("aria-label") || ""));
          const linkedinNext = [...(pager || document).querySelectorAll('button, a, [role="button"]')]
            .filter(visible)
            .find((element) => /next/i.test(label(element)));
          // LinkedIn can show only a sliding window of page numbers. Prefer its
          // Next control so scanning continues after the last visible number.
          const linkedinControl = (visible(linkedinNext) ? linkedinNext : null) || numberedNext;
          if (linkedinControl) {
            const before = marker();
            linkedinControl.scrollIntoView({ behavior: "smooth", block: "center" });
            if (linkedinControl.tagName === "A" && linkedinControl.href && new URL(linkedinControl.href).origin === location.origin) {
              return { clicked: true, before, href: linkedinControl.href, expectedPage: targetNumber };
            }
            linkedinControl.click();
            return { clicked: true, before, expectedPage: targetNumber };
          }
        }
      }
      let next = null;
      // Naukri's pager is often rendered as plain numbered controls without
      // stable aria attributes. Prefer the next number over generic Next
      // matches, which can point at unrelated site navigation.
      if (/(^|\.)naukri\.com$/i.test(location.hostname)) {
        const url = new URL(location.href);
        const currentFromUrl = Number.parseInt(url.searchParams.get("page"), 10);
        const controls = [...document.querySelectorAll('a, button, [role="button"]')]
          .filter((element) => visible(element));
        const selected = controls.find((element) => {
          const className = typeof element.className === "string" ? element.className : "";
          return element.getAttribute("aria-current") === "page"
            || element.getAttribute("aria-current") === "true"
            || element.getAttribute("aria-selected") === "true"
            || /\b(active|selected|current)\b/i.test(className);
        });
        const selectedPage = Number.parseInt((selected?.innerText || "").trim(), 10);
        const currentPage = Number.isFinite(currentFromUrl) && currentFromUrl > 0
          ? currentFromUrl
          : (Number.isFinite(selectedPage) && selectedPage > 0 ? selectedPage : 1);
        const targetPage = currentPage + 1;
        next = controls.find((element) => {
          if ((element.innerText || "").trim() !== String(targetPage)) return false;
          const parentText = element.parentElement?.parentElement?.innerText || "";
          return /\b(?:previous|prev|next)\b/i.test(parentText) || /\b\d+\b/.test(parentText);
        }) || controls.find((element) => /\bnext\b/i.test(label(element)));
        if (!next) {
          url.searchParams.set("page", String(targetPage));
          return { clicked: true, before: marker(), href: url.toString(), expectedPage: targetPage };
        }
      }
      const selectors = [
        '[aria-label*="next" i]', '[title*="next" i]',
        '.artdeco-pagination__button--next', '[data-testid*="next" i]', '[class*="next" i]',
        'button[aria-label*="load more" i]', 'button[aria-label*="show more" i]', '[class*="pagination"] [rel="next"]',
      ];
      const isNext = (element) => /^\s*next(?:\s+(?:page|results))?\s*[>\u203a\u00bb\u2192]?\s*$/i.test(label(element)) || /\bnext\b|load more|show more/i.test(label(element));
      const candidates = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))].filter((element) => visible(element) && isNext(element));
      const linkedinFallback = /(^|\.)linkedin\.com$/i.test(location.hostname)
        ? [...document.querySelectorAll('button, a, [role="button"]')].find((element) => visible(element) && /\bnext\b/i.test(label(element)))
        : null;
      const fallback = linkedinFallback || [...document.querySelectorAll("button, a")].find((element) => visible(element) && isNext(element));
      next = next || candidates[0] || fallback;
      if (!next) {
        const pager = document.querySelector('.jobs-search-pagination, .artdeco-pagination, nav[aria-label*="pagination" i], [class*="pagination"]');
        const current = pager?.querySelector('[aria-current="page"], [aria-current="true"], [class*="active"], [class*="current"]');
        const currentPage = Number.parseInt((current?.innerText || "").trim(), 10);
        if (Number.isFinite(currentPage)) {
          const pageControls = [...document.querySelectorAll('a, button, [role="button"]')]
            .filter((element) => visible(element) && (element.closest("nav, [class*='pagination'], [aria-label*='pagination']")))
            .filter((element) => (element.innerText || "").trim() === String(currentPage + 1));
          next = pageControls[0] || null;
        }
      }
      if (!next) {
        // Some boards expose pagination only as a URL query parameter and do
        // not label the anchor as Next. Follow the next numeric page safely.
        const currentUrl = new URL(location.href);
        const pageKey = ["page", "pageNo", "pageno", "pageNumber", "start"].find((key) => currentUrl.searchParams.has(key));
        const currentPage = pageKey ? Number.parseInt(currentUrl.searchParams.get(pageKey), 10) || 1 : null;
        if (pageKey && currentPage !== null) {
          const targetPage = pageKey === "start" ? currentPage + 25 : currentPage + 1;
          next = [...document.querySelectorAll("a[href]")].find((element) => {
            try {
              const candidate = new URL(element.href, location.href);
              return candidate.origin === location.origin
                && Number.parseInt(candidate.searchParams.get(pageKey), 10) === targetPage
                && /job|search|feed|result/i.test(candidate.pathname);
            } catch {
              return false;
            }
          }) || null;
        }
        if (!next) {
          const currentStart = Number.parseInt(currentUrl.searchParams.get("start"), 10) || 0;
          next = [...document.querySelectorAll("a[href]")].map((element) => {
            try { return { element, url: new URL(element.href, location.href) }; } catch { return null; }
          }).filter((item) => item && item.url.origin === currentUrl.origin
            && item.url.pathname === currentUrl.pathname
            && Number.parseInt(item.url.searchParams.get("start"), 10) > currentStart)
            .sort((left, right) => Number(left.url.searchParams.get("start")) - Number(right.url.searchParams.get("start")))[0]?.element || null;
        }
      }
      if (!next && /(^|\.)linkedin\.com$/i.test(location.hostname) && /\/jobs\/search-results/i.test(location.pathname)) {
        // LinkedIn's pager is frequently rendered as a non-standard control.
        // Its result pages are still addressable by the stable `start` offset.
        const linkedinUrl = new URL(location.href);
        const currentStart = Number.parseInt(linkedinUrl.searchParams.get("start"), 10) || 0;
        linkedinUrl.searchParams.set("start", String(currentStart + 25));
        return { clicked: true, before: marker(), href: linkedinUrl.toString(), expectedPage: Math.floor(currentStart / 25) + 2 };
      }
      if (!next) return { clicked: false, before: marker() };
      const before = marker();
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      const isLinkedIn = /(^|\.)linkedin\.com$/i.test(location.hostname);
      const pager = isLinkedIn ? document.querySelector('.jobs-search-pagination, .artdeco-pagination, nav[aria-label*="pagination" i], [class*="pagination"]') : null;
      const currentPageControl = pager?.querySelector('[aria-current="page"], [aria-current="true"], [class*="active"], [class*="current"]');
      const currentPageNumber = Number.parseInt((currentPageControl?.innerText || currentPageControl?.getAttribute("aria-label") || "").match(/\d+/)?.[0] || "", 10);
      const expectedPage = Number.isFinite(currentPageNumber) ? currentPageNumber + 1 : undefined;
      if (next.tagName === "A" && next.href && new URL(next.href).origin === location.origin) {
        return { clicked: true, before, href: next.href, expectedPage };
      }
      next.click();
      return { clicked: true, before, expectedPage };
    },
  });
  if (!clickResult?.clicked) return { clicked: false, changed: false };
  if (clickResult.href) await chrome.tabs.update(activeTab.id, { url: clickResult.href });
  let previousChangedMarker = "";
  let stableChangedMarkerCount = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const currentTab = await chrome.tabs.get(activeTab.id).catch(() => null);
    if (!currentTab || currentTab.status === "loading") continue;
    try {
      const [{ result: currentMarker }] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
        const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
        const label = (element) => `${element.innerText || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim();
        const pager = document.querySelector('.jobs-search-pagination, .artdeco-pagination, nav[aria-label*="pagination" i], [class*="pagination"]');
        const pageControl = pager?.querySelector('[aria-current="page"], [aria-current="true"], [class*="active"], [class*="current"]');
        const pageNumber = (pageControl?.innerText || pageControl?.getAttribute("aria-label") || "").match(/\d+/)?.[0] || "";
        const resultLinks = [...document.querySelectorAll("a[href]")]
          .filter(visible)
          .filter((element) => /job|career|position|vacanc|opening/i.test(element.href))
          .map((element) => element.href)
          .filter((href, index, all) => all.indexOf(href) === index)
          .slice(0, 40)
          .join("|");
        const cardText = [...document.querySelectorAll('article, [data-job-id], [data-jobid], [class*="job-card"], [class*="jobCard"], [class*="jobTuple"], [class*="job-tuple"]')]
          .filter(visible)
          .slice(0, 30)
          .map((element) => label(element).slice(0, 140))
          .join("|");
        return { marker: `${location.href}|${pageNumber}|${label(pageControl || {})}|${resultLinks}|${cardText}`, pageNumber: Number.parseInt(pageNumber, 10) || null };
        },
      });
      if (Number.isFinite(clickResult.expectedPage)) {
        if (currentMarker?.pageNumber === clickResult.expectedPage) return { clicked: true, changed: true };
      }
      if (currentMarker?.marker && currentMarker.marker !== clickResult.before) {
        if (currentMarker.marker === previousChangedMarker) stableChangedMarkerCount += 1;
        else {
          previousChangedMarker = currentMarker.marker;
          stableChangedMarkerCount = 1;
        }
        if (stableChangedMarkerCount >= 3) return { clicked: true, changed: true };
      } else {
        previousChangedMarker = "";
        stableChangedMarkerCount = 0;
      }
    } catch {
      // Give full-page navigations and board reloads time to finish before retrying.
    }
  }
  return { clicked: true, changed: false };
}
