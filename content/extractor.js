(() => {
  const site = /linkedin\.com/i.test(location.hostname) ? "linkedin" : "naukri";
  const text = (root, selectors) => selectors.map((selector) => root.querySelector(selector)?.textContent?.trim()).find(Boolean) || "";
  const href = (root, selectors) => selectors.map((selector) => (root.matches?.(selector) ? root.href : root.querySelector(selector)?.href)).find(Boolean) || "";
  const extractJobs = () => {
    const cards = site === "linkedin"
      ? [...document.querySelectorAll('a[href*="/jobs/view/"]')].map((link) => link.closest("li, .job-card-container, .jobs-search-results__list-item") || link.parentElement)
      : [...document.querySelectorAll("article.jobTuple, .srp-jobtuple-wrapper, div.jobTuple, [class*='jobTuple'], [class*='job-tuple'], [class*='jobCard'], [class*='job-card']")];

    const jobs = [...new Map(cards.filter(Boolean).map((card, index) => {
    const applicationUrl = href(card, site === "linkedin"
      ? ['a[href*="/jobs/view/"]', "a"]
      : ["a.title", "a"]);
    const lines = (card.innerText || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const title = text(card, site === "linkedin"
      ? ["h3.base-search-card__title", ".job-card-list__title", "h3", 'a[href*="/jobs/view/"]']
      : [".title", "a.title"]) || lines[0] || "";
    const company = text(card, site === "linkedin"
      ? ["h4.base-search-card__subtitle", ".job-card-container__company-name", "h4"]
      : [".comp-name", ".companyInfo a"]) || lines[1] || "";
    const descriptionText = text(card, site === "linkedin"
      ? [".base-search-card__snippet", ".job-card-list__description"]
      : [".job-desc", ".job-description"]);
    const description = descriptionText || lines.slice(2).join(" ") || lines.join(" ") || `${title} at ${company}.`;
    return [applicationUrl || `${site}-${index}`, {
      source: site,
      externalId: applicationUrl || `${site}-${index}`,
      title,
      company,
      location: text(card, site === "linkedin"
        ? [".job-search-card__location", ".job-card-container__metadata-item"]
        : [".locWdth", ".loc"]) || lines[2] || "",
      description: description || `${title} at ${company}. Review the original listing for the full requirements.`,
      applicationUrl,
      sourceUrl: applicationUrl,
    }];
    }))].map(([, job]) => job).filter((job) => job.title && job.company && job.applicationUrl);

    globalThis.__PORTFOLIO_AI_JOBS__ = jobs;
    return jobs;
  };

  globalThis.__PORTFOLIO_AI_EXTRACT__ = extractJobs;
  extractJobs();
})();
