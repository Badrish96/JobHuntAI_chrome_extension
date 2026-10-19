import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const apiBase = (process.env.PORTFOLIO_API_URL || "https://my-portfolio-backend-0ezn.onrender.com").replace(/\/$/, "");
let token = process.env.PORTFOLIO_TOKEN || "";
const targetUrl = process.env.JOB_APPLICATION_URL || process.argv[2] || "";
const profileDir = process.env.PLAYWRIGHT_PROFILE_DIR || "./browser-profile";

if (!apiBase || !targetUrl) {
  console.error("Usage: set PORTFOLIO_API_URL and JOB_APPLICATION_URL, then run npm run apply");
  process.exitCode = 1;
  process.exit();
}

const rl = readline.createInterface({ input, output });
const ask = async (question) => (await rl.question(`${question}\n> `)).trim();

async function getProfile() {
  const response = await fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.user) {
    if (response.status === 401) {
      throw new Error(`Portfolio token was rejected by ${apiBase}. If you logged in at localhost, use the local backend URL (normally http://localhost:5000); local JWTs are not valid against the Render backend. If you want to use Render, log in through the deployed portfolio URL instead.`);
    }
    throw new Error(result.message || `Profile request failed with HTTP ${response.status}`);
  }
  return result.user;
}

function profileValues(profile, pageText) {
  const bangalore = /\b(bangalore|bengaluru)\b/i.test(pageText);
  return {
    firstName: profile.firstName || profile.name?.split(/\s+/)[0] || "",
    middleName: profile.middleName || "",
    lastName: profile.lastName || profile.name?.split(/\s+/).slice(1).join(" ") || "",
    name: profile.name || "",
    email: profile.email || "",
    mobilePhone: profile.mobilePhone || "",
    gender: profile.gender || "",
    nationality: profile.nationality || "",
    location: profile.currentLocation || profile.location || "",
    website: profile.website || profile.portfolioUrl || "",
    skills: (profile.skills || []).join(", "),
    experience: profile.experienceYears == null ? "" : String(profile.experienceYears),
    relevantExperience: profile.relevantExperienceYears == null ? "" : String(profile.relevantExperienceYears),
    currentSalary: profile.currentSalary == null ? "" : String(profile.currentSalary),
    expectedSalary: bangalore ? "1800000" : "1600000",
    compensationHike: bangalore ? "Beyond 30%" : "11% to 20%",
    noticePeriod: Number(profile.availableToJoin ?? 0) === 0 ? "Immediate Joiner" : String(profile.availableToJoin),
    education: profile.educationDetails || "",
    experienceDetails: profile.experienceDetails || "",
    projects: profile.projectDetails || "",
    certifications: profile.certifications || "",
    achievements: profile.achievements || "",
    workAuthorization: profile.workAuthorization || "",
  };
}

const rules = [
  ["firstName", /first\s*name|given\s*name/i],
  ["middleName", /middle\s*name/i],
  ["lastName", /last\s*name|surname|family\s*name/i],
  ["name", /full\s*name|your\s*name|first\s*and\s*last/i],
  ["email", /e[-\s]?mail/i],
  ["mobilePhone", /mobile|phone|telephone|contact\s*number/i],
  ["gender", /gender|sex/i],
  ["nationality", /nationality/i],
  ["location", /current\s*location|city|location|address/i],
  ["website", /website|portfolio|personal\s*site/i],
  ["skills", /skills|technologies|tech\s*stack|programming\s*languages/i],
  ["relevantExperience", /relevant\s*experience|experience.*align|aligned\s*experience/i],
  ["experience", /total.*experience|professional\s*experience|years\s*of\s*experience/i],
  ["currentSalary", /current.*salary|annual.*fixed.*compensation|current.*compensation|current\s*ctc/i],
  ["compensationHike", /compensation\s*hike|salary\s*hike|hike\s*expectation|pay\s*raise/i],
  ["expectedSalary", /expected\s*salary|salary\s*expectations?|desired\s*salary|what.*want.*pay/i],
  ["noticePeriod", /notice\s*period|availability\s*to\s*join|when.*join|lead\s*time(?:\s*to\s*join)?|days?\s*to\s*join/i],
  ["education", /education|degree|qualification|university|college/i],
  ["experienceDetails", /experience\s*details|work\s*experience|employment\s*history/i],
  ["projects", /projects|project\s*experience/i],
  ["certifications", /certifications?|licenses?/i],
  ["achievements", /achievements|awards|accomplishments/i],
  ["workAuthorization", /work\s*authorization|right\s*to\s*work|eligible\s*to\s*work/i],
];

function normalize(text) { return String(text || "").replace(/\s+/g, " ").trim(); }
function fieldDescription(field) {
  return normalize([field.getAttribute("aria-label"), field.getAttribute("placeholder"), field.getAttribute("name"), field.getAttribute("id")].filter(Boolean).join(" "));
}
function labelFor(field) {
  return normalize(field.evaluate((element) => {
    const label = element.labels?.[0];
    if (label) return label.textContent;
    const parent = element.closest("label, fieldset, [data-testid], .form-group");
    return parent?.textContent || "";
  }));
}
function ruleFor(text) { return rules.find(([, pattern]) => pattern.test(text))?.[0] || ""; }
function isRequired(field, label) { return field.getAttribute("required") !== null || field.getAttribute("aria-required") === "true" || /\*/.test(label); }

async function selectValue(page, field, value) {
  const tag = await field.evaluate((element) => element.tagName);
  if (tag === "SELECT") {
    const options = await field.locator("option").allTextContents();
    const match = options.find((option) => option.toLowerCase().includes(String(value).toLowerCase()));
    if (match) await field.selectOption({ label: match });
    return Boolean(match);
  }
  await field.fill(String(value));
  await page.waitForTimeout(250);
  const option = page.locator("[role=option], [role=listbox] li, li").filter({ hasText: String(value) }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return true;
  }
  await field.press("ArrowDown").catch(() => {});
  await field.press("Enter").catch(() => {});
  return Boolean(await field.inputValue().catch(() => ""));
}

let browser;
let context;
let ownsBrowser = false;
if (process.env.PLAYWRIGHT_CDP_URL) {
  browser = await chromium.connectOverCDP(process.env.PLAYWRIGHT_CDP_URL);
  context = browser.contexts()[0];
} else {
  context = await chromium.launchPersistentContext(profileDir, { headless: false });
  ownsBrowser = true;
}
const page = context.pages()[0] || await context.newPage();
if (!token || token === "your-token") {
  const loginUrl = process.env.PORTFOLIO_LOGIN_URL || "https://my-portfolio-frontend-chi-five.vercel.app/login";
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await ask("Log in to the portfolio website in the browser, then press Enter");
  token = await page.evaluate(() => localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "");
  if (!token) throw new Error("No portfolio authToken was found. Log in at the local portfolio page before continuing.");
}
const profile = await getProfile();
await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
console.log("Browser opened. Log in if needed; the runner will wait for you.");
await ask("When the application form is visible, press Enter");

const pageText = await page.locator("body").innerText().catch(() => "");
const values = profileValues(profile, pageText);
const fields = page.locator("input:not([type=hidden]):not([type=file]), textarea, select");
let filled = 0;
const missing = [];

for (let index = 0; index < await fields.count(); index += 1) {
  const field = fields.nth(index);
  if (!(await field.isVisible().catch(() => false)) || await field.isDisabled().catch(() => true)) continue;
  const label = labelFor(field);
  const key = ruleFor(`${label} ${fieldDescription(field)}`);
  const value = values[key];
  if (!key || !value) {
    if (isRequired(field, label) && !(await field.inputValue().catch(() => "")).trim()) missing.push({ field, label: label || fieldDescription(field) || `Required field ${index + 1}` });
    continue;
  }
  if ((await field.inputValue().catch(() => "")).trim()) continue;
  if (await selectValue(page, field, value)) filled += 1;
}

for (const item of missing) {
  const answer = await ask(`Missing required field: ${item.label}`);
  if (answer) await selectValue(page, item.field, answer);
}

console.log(`Filled ${filled} saved-profile field(s). Review the page and resolve any remaining questions.`);
const confirmation = await ask("Type SUBMIT to click the final application button, or press Enter to leave it for manual submission");
if (confirmation === "SUBMIT") {
  const submit = page.getByRole("button", { name: /submit application|send application|finish application|submit|apply/i }).last();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    console.log("Submitted button clicked. Verify the job board confirmation page.");
  } else {
    console.log("No supported submit button was detected; no submission was made.");
  }
}
await rl.close();
if (ownsBrowser) await context.close();
