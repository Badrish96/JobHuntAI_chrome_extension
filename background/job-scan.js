export const SCANNER_BUILD = "0.1.19-easy-apply-modal";

export async function scanActiveTab(apiBase, token) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
    return { message: "Open a job-results or careers page in the active tab first." };
  }

  const site = /linkedin\.com/i.test(tab.url) ? "linkedin" : /naukri\.com/i.test(tab.url) ? "naukri" : /hirist\.tech/i.test(tab.url) ? "hirist" : /adzuna\.[a-z.]+/i.test(tab.url) ? "adzuna" : /indeed\.[a-z.]+/i.test(tab.url) ? "indeed" : "generic";
  const [{ result: scanResult }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const siteName = /linkedin\.com/i.test(location.hostname) ? "linkedin" : /naukri\.com/i.test(location.hostname) ? "naukri" : /hirist\.tech/i.test(location.hostname) ? "hirist" : /adzuna\.[a-z.]+/i.test(location.hostname) ? "adzuna" : /indeed\.[a-z.]+/i.test(location.hostname) ? "indeed" : "generic";
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const text = (root, selectors) => selectors.map((selector) => normalize(root.querySelector(selector)?.textContent)).find(Boolean) || "";
      const jobCardSelector = 'article.jobTuple, .srp-jobtuple-wrapper, div.jobTuple, [class*="jobTuple"], [class*="job-tuple"], [class*="jobCard"], [class*="job-card"], [class*="vacanc"], [class*="opening"], [class*="position"], [data-testid*="job"], [data-job-id], [data-jobid], [data-jk], .job_seen_beacon, article';
      const cardSignature = () => [...document.querySelectorAll(jobCardSelector)]
        .map((card) => normalize(card.innerText).slice(0, 180)).filter(Boolean).slice(-80).join("|");
      // Indeed appends results to a scrollable feed instead of exposing a
      // numbered pager. Keep scrolling until the visible job set stops growing.
      const findScrollables = () => [document.scrollingElement, ...document.querySelectorAll("*")]
        .filter((element, index, all) => element && all.indexOf(element) === index
          && element.scrollHeight > element.clientHeight + 120
          && (element.clientHeight > 250 || element === document.scrollingElement))
        .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))
        .slice(0, 8);
      let stableScrolls = 0;
      let previousSignature = "";
      for (let index = 0; index < 24 && stableScrolls < 4; index += 1) {
        const before = cardSignature();
        window.scrollTo(0, Math.min(document.documentElement.scrollHeight, window.scrollY + Math.max(window.innerHeight * 0.85, 600)));
        findScrollables().forEach((element) => { element.scrollTop = Math.min(element.scrollHeight, element.scrollTop + Math.max(element.clientHeight * 0.85, 600)); });
        await wait(siteName === "indeed" ? 700 : 400);
        const after = cardSignature();
        if (after === before && after === previousSignature) stableScrolls += 1;
        else stableScrolls = 0;
        previousSignature = after;
      }
      await wait(500);
      const cards = siteName === "linkedin"
        ? [...document.querySelectorAll('a[href*="/jobs/view/"], a[href*="/jobs/collections/"], a[data-job-id], a[data-entity-urn*="jobPosting"], [data-occludable-job-id], [data-job-id], [data-entity-urn*="jobPosting"], [componentkey^="job-card-component-ref-"]')].map((link) => link.closest('li, article, [componentkey^="job-card-component-ref-"], [data-occludable-job-id], [data-job-id], [data-entity-urn*="jobPosting"], .job-card-container, .jobs-search-results__list-item, .job-card-list__entity-lockup') || link.parentElement)
        : [...document.querySelectorAll(jobCardSelector)];
      const isJobLink = (link) => {
        const href = link?.href || "";
        if (siteName === "naukri") {
          try {
            const parsed = new URL(href, location.href);
            return /(?:^|\.)naukri\.com$/i.test(parsed.hostname)
              && /(?:^|[-/])(?:job-listings|jobs?|jobfeed)(?:[-/?]|$)/i.test(parsed.pathname);
          } catch {
            return false;
          }
        }
        if (siteName === "hirist") {
          try {
            const parsed = new URL(href, location.href);
            return /(?:^|\.)hirist\.tech$/i.test(parsed.hostname)
              && !/(login|register|signup|profile|companies|search)/i.test(parsed.pathname)
              && /(?:job|jobs|jobfeed|\/j\/)/i.test(parsed.pathname);
          } catch {
            return false;
          }
        }
        if (siteName === "adzuna") {
          try {
            const parsed = new URL(href, location.href);
            return /(?:^|\.)adzuna\.[a-z.]+$/i.test(parsed.hostname)
              && !/(login|register|signup|account|employer|support)/i.test(parsed.pathname)
              && /(?:job|jobs|details|ad\/)/i.test(`${parsed.pathname} ${parsed.search}`);
          } catch {
            return false;
          }
        }
        if (siteName === "generic") {
          try {
            const parsed = new URL(href, location.href);
            return parsed.origin === location.origin
              && !/(login|register|signup|account|privacy|terms|contact|about|support)/i.test(parsed.pathname)
              && /(?:job|jobs|career|careers|position|opening|vacanc|requisition|apply)/i.test(`${parsed.pathname} ${parsed.search}`);
          } catch {
            return false;
          }
        }
        try {
          const parsed = new URL(href, location.href);
          return /(?:^|\.)indeed\.[a-z.]+$/i.test(parsed.hostname)
            && !/(login|register|signup|account|preferences|employer|support|help)/i.test(parsed.pathname)
            && (parsed.searchParams.has("jk") || /viewjob|jobs?|clk/i.test(parsed.pathname));
        } catch {
          return false;
        }
      };
      if (siteName === "linkedin" && !cards.length) {
        const fallbackCards = [...document.querySelectorAll('a[href*="/jobs/view/"], a[href*="/jobs/collections/"], a[data-job-id], a[data-entity-urn*="jobPosting"], [data-occludable-job-id], [data-job-id], [data-entity-urn*="jobPosting"], [componentkey^="job-card-component-ref-"]')].map((link) => link.closest('li, article, [componentkey^="job-card-component-ref-"], [class*="job"], [class*="Job"], .scaffold-layout__list-item') || link.parentElement);
        cards.push(...fallbackCards);
      }
      const cardHasJobLink = (card) => {
        const links = [...(card.matches?.("a[href]") ? [card] : []), ...card.querySelectorAll("a[href]")];
        return links.some(isJobLink);
      };
      if (siteName === "naukri" && (!cards.length || !cards.some(cardHasJobLink))) {
        const fallbackCards = [...document.querySelectorAll("a[href]")].filter(isJobLink).map((link) => link.closest('article, li, [class*="job"], [class*="Job"], .row') || link.parentElement);
        cards.push(...fallbackCards);
      }
      if ((siteName === "hirist" || siteName === "indeed" || siteName === "adzuna" || siteName === "generic") && (!cards.length || !cards.some(cardHasJobLink))) {
        const fallbackCards = [...document.querySelectorAll("a[href]")].filter(isJobLink).map((link) => link.closest('article, li, [class*="job"], [class*="Job"], [data-testid*="job"], .row') || link.parentElement);
        cards.push(...fallbackCards);
      }
      const jobs = [...new Set(cards.filter(Boolean))].map((card, index) => {
        const indeedJobId = siteName === "indeed" ? card.getAttribute("data-jk") || card.closest("[data-jk]")?.getAttribute("data-jk") || "" : "";
        const linkedinDataId = siteName === "linkedin"
          ? card.getAttribute("data-occludable-job-id")
            || card.getAttribute("data-job-id")
            || card.querySelector("[data-occludable-job-id]")?.getAttribute("data-occludable-job-id")
            || card.querySelector("[data-job-id]")?.getAttribute("data-job-id")
            || card.getAttribute("data-entity-urn")
            || card.querySelector('[data-entity-urn*="jobPosting"]')?.getAttribute("data-entity-urn")
            || card.getAttribute("componentkey")
            || card.querySelector('[componentkey^="job-card-component-ref-"]')?.getAttribute("componentkey")
            || ""
          : "";
        const cardLinks = [...(card.matches?.("a[href]") ? [card] : []), ...card.querySelectorAll("a[href]")];
        const link = siteName === "linkedin"
          ? (card.matches?.('a[href*="/jobs/view/"], a.job-card-container__link, a[href*="/jobs/collections/"]') ? card : card.querySelector('a[href*="/jobs/view/"], a.job-card-container__link, a[href*="/jobs/collections/"]'))
          : siteName === "indeed" && indeedJobId
            ? { getAttribute: () => `/viewjob?jk=${encodeURIComponent(indeedJobId)}`, textContent: "" }
            : cardLinks.find(isJobLink);
        const resolvedLink = link || (siteName === "linkedin" && linkedinDataId
          ? { getAttribute: () => `/jobs/view/${linkedinDataId.match(/\d{6,}/)?.[0] || linkedinDataId}/`, textContent: "" }
          : null);
        if (!resolvedLink) return null;
        if (!card) return null;
        const lines = normalize(card.innerText).split(/\n+/).map(normalize).filter(Boolean);
        const parsedUrl = new URL(resolvedLink.getAttribute("href") || "", location.href);
        const linkedinJobId = siteName === "linkedin"
          ? parsedUrl.pathname.match(/\/jobs\/(?:view|collections)\/(\d+)/i)?.[1] || linkedinDataId.match(/\d{6,}/)?.[0] || ""
          : "";
        const boardJobId = linkedinJobId || (siteName === "indeed" ? parsedUrl.searchParams.get("jk") : "");
        const applicationUrl = linkedinJobId
          ? `${parsedUrl.origin}/jobs/view/${linkedinJobId}/`
          : boardJobId && siteName === "indeed"
          ? `${parsedUrl.origin}/viewjob?jk=${encodeURIComponent(boardJobId)}`
          : boardJobId
            ? `${parsedUrl.origin}${parsedUrl.pathname}`
            : parsedUrl.href;
        const externalId = boardJobId ? `${siteName}-${boardJobId}` : `${siteName}-${applicationUrl.slice(0, 280)}`;
        const title = text(card, siteName === "linkedin"
          ? ["h3.base-search-card__title", ".job-card-list__title", ".job-card-container__link", ".artdeco-entity-lockup__title", '[class*="job-card"] h3', '[class*="job-card"] [class*="title"]']
          : siteName === "naukri" ? [".title", "a.title", '[class*="title"]'] : siteName === "hirist" ? ["h2", "h3", '[class*="title"]', '[class*="job"] a'] : ["h2", "h3", ".jobTitle", 'button[aria-label^="full details of"]', '[data-testid*="jobTitle"]', '[data-testid*="title"]', '[class*="title"]']) || normalize(resolvedLink.textContent) || lines[0] || "";
        const logoCompany = [...card.querySelectorAll("img[alt]")]
          .map((image) => normalize(image.getAttribute("alt")))
          .find((value) => value && !/logo|icon|image|avatar/i.test(value));
        const company = text(card, siteName === "linkedin"
          ? ["h4.base-search-card__subtitle", ".job-card-container__company-name", ".job-card-container__primary-description", ".artdeco-entity-lockup__subtitle", '[class*="job-card"] h4', '[class*="job-card"] [class*="company"]']
          : siteName === "naukri" ? [".comp-name", ".companyInfo a", '[class*="company"]'] : siteName === "hirist" ? [".company", '[class*="company"]', "h4"] : ['[data-testid="company-name"]', '[data-testid*="companyName"]', '[class*="company"]', ".companyName"]) || logoCompany || lines[1] || `${siteName} job listing`;
        const locationText = text(card, siteName === "linkedin"
          ? [".job-search-card__location", ".job-card-container__metadata-item", ".job-card-container__metadata-wrapper", ".artdeco-entity-lockup__caption", '[class*="job-card"] [class*="location"]']
          : siteName === "naukri" ? [".locWdth", ".loc", '[class*="location"]', '[class*="loc"]'] : ['[data-testid="text-location"]', '[data-testid*="jobLocation"]', '[class*="location"]', '[class*="loc"]', ".location"]) || lines.find((line) => /india|remote|bangalore|bengaluru|gurgaon|gurugram|noida|delhi/i.test(line)) || "";
        const descriptionText = text(card, siteName === "linkedin"
          ? [".base-search-card__snippet", ".job-card-list__description"]
          : [".job-desc", ".job-description"]);
        const description = descriptionText || lines.slice(2).join(" ") || lines.join(" ") || `${title} at ${company}${locationText ? ` in ${locationText}` : ""}.`;
        const dateText = text(card, ["time", '[datetime]', '[data-testid*="date"]', '[class*="date"]', '[class*="posted"]']);
        const rawPostedAt = card.querySelector("time[datetime]")?.getAttribute("datetime") || dateText;
        const postedAt = rawPostedAt && !Number.isNaN(Date.parse(rawPostedAt)) ? new Date(rawPostedAt).toISOString() : undefined;
        return { source: siteName, externalId: externalId || `${siteName}-${index}`, title, company, location: locationText, description: description.slice(0, 30000), applicationUrl, sourceUrl: applicationUrl, ...(postedAt ? { postedAt } : {}) };
      }).filter((job) => job && job.title && job.company && job.applicationUrl && (siteName !== "linkedin" || job.applicationUrl.includes("/jobs/")));
      return { jobs: [...new Map(jobs.filter(Boolean).map((job) => [job.externalId, job])).values()], candidateCount: cards.length };
    },
  });
  const jobs = scanResult?.jobs || [];
  if (!jobs.length) return { imported: 0, message: `[${SCANNER_BUILD}] No ${site} jobs found. The page exposed ${scanResult?.candidateCount || 0} candidate job card(s), so the backend was not called. Open the full job-results list, wait for cards to load, and scan again.` };

  let response = await fetch(`${apiBase}/api/jobs/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobs }),
  });
  let result = await response.json().catch(() => ({}));
  if (!response.ok && response.status === 400 && /no valid jobs/i.test(result.message || "")) {
    // Older deployed APIs may not yet recognize a newly added board label.
    // Retry with the generic source while preserving the original board URL.
    response = await fetch(`${apiBase}/api/jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobs: jobs.map((job) => ({ ...job, source: "generic", externalId: `generic-${job.externalId}` })) }),
    });
    result = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    // A page may contain non-job cards or board-specific markup while later
    // pages contain valid listings. Keep pagination moving in that case.
    if (response.status === 400 && /no valid jobs/i.test(result.message || "")) {
      return { imported: 0, message: result.message };
    }
    throw new Error(result.message || `Import failed with HTTP ${response.status}.`);
  }
  return { imported: result.imported || 0, message: `[${SCANNER_BUILD}] Extracted ${jobs.length} of ${scanResult?.candidateCount || jobs.length} candidate card(s). Imported ${result.imported || 0} ${site} jobs. AI scored ${result.aiScored || 0}; failures: ${result.aiFailures || 0}.` };
}
