export function startEasyApplyAssistant(profile, apiBase, token) {
  const assistantId = "portfolio-ai-easy-apply-assistant";
  document.getElementById(assistantId)?.remove();

  const values = {
    name: profile.name || "",
    email: profile.email || "",
    location: profile.location || profile.preferredLocations?.[0] || "",
    website: profile.website || "",
    bio: profile.bio || "",
    skills: (profile.skills || []).join(", "),
    roles: (profile.preferredRoles || []).join(", "),
    experience: profile.experienceYears == null ? "" : String(profile.experienceYears),
  };
  const rules = [
    { key: "name", pattern: /full[ -]?name|your name|first and last name/i },
    { key: "email", pattern: /e[ -]?mail|email address/i },
    { key: "location", pattern: /city|location|address|current location/i },
    { key: "website", pattern: /website|portfolio|personal site|github|linkedin profile/i },
    { key: "bio", pattern: /about you|summary|profile|cover letter|introduction/i },
    { key: "skills", pattern: /skills|technologies|tech stack|programming languages/i },
    { key: "roles", pattern: /desired role|preferred role|job title|position/i },
    { key: "experience", pattern: /years of experience|experience years|total experience/i },
  ];

  const visible = (element) => Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  const textOf = (element) => (element.innerText || element.value || element.getAttribute("aria-label") || "").trim();
  const getRoot = () => document.querySelector('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal, form') || document.body;
  const getFields = (root) => [...root.querySelectorAll("input, textarea, select")].filter((field) => visible(field) && !field.disabled && !field.readOnly && field.type !== "hidden");
  const describe = (field) => [field.labels?.[0]?.textContent, field.getAttribute("aria-label"), field.placeholder, field.name, field.id].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const fillKnownFields = (root) => {
    let filled = 0;
    for (const field of getFields(root)) {
      if (field.value && field.value.trim()) continue;
      const rule = rules.find((item) => item.pattern.test(describe(field)));
      if (!rule || !values[rule.key]) continue;
      const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(field, values[rule.key]); else field.value = values[rule.key];
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      filled += 1;
    }
    return filled;
  };

  const missingFields = (root) => getFields(root).filter((field) => {
    if (field.closest(`#${assistantId}`)) return false;
    if (field.type === "file") return Boolean(field.required || field.getAttribute("aria-required") === "true");
    const required = field.required || field.getAttribute("aria-required") === "true" || field.closest("label")?.textContent?.includes("*");
    return required && !String(field.value || "").trim();
  });

  const overlay = document.createElement("div");
  overlay.id = assistantId;
  const dialogRoot = document.querySelector('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal');
  const overlayParent = dialogRoot || document.body || document.documentElement;
  overlay.style.cssText = dialogRoot
    ? "position:absolute;z-index:2147483647!important;top:12px;right:12px;width:360px;max-height:calc(100% - 24px);overflow:auto;padding:18px;background:#173f42;color:#fff;border-radius:14px;box-shadow:0 10px 35px #0007;font:14px Arial,sans-serif;pointer-events:auto"
    : "position:fixed;z-index:2147483647!important;right:20px;bottom:20px;width:360px;max-height:75vh;overflow:auto;padding:18px;background:#173f42;color:#fff;border-radius:14px;box-shadow:0 10px 35px #0007;font:14px Arial,sans-serif;pointer-events:auto";
  if (dialogRoot && getComputedStyle(dialogRoot).position === "static") dialogRoot.style.position = "relative";
  overlayParent.appendChild(overlay);

  let processTimer = null;
  const scheduleProcess = () => {
    clearTimeout(processTimer);
    processTimer = setTimeout(() => processStep(), 450);
  };
  const isAssistantEvent = (event) => Boolean(event.target?.closest?.(`#${assistantId}`));
  const onApplicationInput = (event) => {
    if (!isAssistantEvent(event)) scheduleProcess();
  };
  const onApplicationClick = (event) => {
    if (isAssistantEvent(event)) return;
    const control = event.target?.closest?.('button, input[type="submit"], [role="button"]');
    if (control && event.isTrusted) scheduleProcess();
  };
  document.addEventListener("input", onApplicationInput, true);
  document.addEventListener("change", onApplicationInput, true);
  document.addEventListener("click", onApplicationClick, true);
  const closeAssistant = () => {
    clearTimeout(processTimer);
    document.removeEventListener("input", onApplicationInput, true);
    document.removeEventListener("change", onApplicationInput, true);
    document.removeEventListener("click", onApplicationClick, true);
    overlay.remove();
  };

  const render = ({ title, message, fields = [], actionText = "Continue", onAction }) => {
    overlay.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = title;
    heading.style.display = "block";
    heading.style.marginBottom = "8px";
    const copy = document.createElement("div");
    copy.textContent = message;
    copy.style.lineHeight = "1.4";
    overlay.append(heading, copy);
    const controls = [];
    for (const field of fields) {
      const label = document.createElement("label");
      label.textContent = field.label;
      label.style.cssText = "display:block;margin-top:10px;font-weight:700";
      const input = document.createElement(field.target?.tagName === "SELECT" ? "select" : field.target?.tagName === "TEXTAREA" ? "textarea" : "input");
      input.type = field.target?.type === "file" ? "text" : "text";
      input.placeholder = field.target?.type === "file" ? "Choose this file on the job page" : "Enter answer";
      input.value = field.target?.type === "file" ? "" : field.target?.value || "";
      input.style.cssText = "box-sizing:border-box;width:100%;margin-top:4px;padding:8px;border-radius:7px;border:1px solid #9bd0ce";
      label.appendChild(input);
      overlay.appendChild(label);
      controls.push({ field, input });
    }
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = actionText;
    action.style.cssText = "margin-top:14px;padding:9px 12px;border:0;border-radius:7px;background:#0ea5a4;color:#fff;font-weight:700;cursor:pointer";
    action.addEventListener("click", () => onAction(controls));
    overlay.appendChild(action);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.cssText = "margin:14px 0 0 8px;padding:8px 12px;border:1px solid #9bd0ce;border-radius:7px;background:transparent;color:#fff;cursor:pointer";
    cancel.addEventListener("click", closeAssistant);
    overlay.appendChild(cancel);
  };

  const processStep = async () => {
    const root = getRoot();
    const filled = fillKnownFields(root);
    const missing = missingFields(root);
    if (missing.length) {
      render({
        title: "More information is required",
        message: `I filled ${filled} known field(s). Answer these required fields to continue. File uploads must be selected on the job page.`,
        fields: missing.map((target) => ({ target, label: describe(target) || "Required field" })),
        actionText: "Fill and continue",
        onAction: (controls) => {
          for (const { field, input } of controls) {
            if (field.type === "file") continue;
            const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(field, input.value); else field.value = input.value;
            field.dispatchEvent(new Event("input", { bubbles: true }));
            field.dispatchEvent(new Event("change", { bubbles: true }));
          }
          setTimeout(processStep, 250);
        },
      });
      return;
    }

    const buttons = [...root.querySelectorAll("button, input[type=submit], a")].filter((button) => visible(button) && !button.disabled && !button.closest(`#${assistantId}`));
    const submit = buttons.find((button) => /submit application|send application|finish application/i.test(textOf(button)));
    if (submit) {
      submit.scrollIntoView({ behavior: "smooth", block: "center" });
      submit.style.outline = "4px solid #0ea5a4";
      render({
        title: "Ready to submit",
        message: "All detected required fields are complete. Review the application, then confirm below to submit it.",
        actionText: "Submit application",
        onAction: () => {
          submit.click();
          window.postMessage({ source: "portfolio-ai", type: "APPLICATION_SUBMITTED", applicationUrl: location.href, apiBase, token }, "*");
          closeAssistant();
        },
      });
      return;
    }

    const next = buttons.find((button) => /next|continue|review/i.test(textOf(button)));
    if (next) {
      render({
        title: "Continuing application",
        message: "Required fields are complete. The assistant is moving to the next Easy Apply step. It will stop only if LinkedIn reports a missing or invalid field.",
        actionText: "Stop assistant",
        onAction: closeAssistant,
      });
      setTimeout(() => {
        if (!next.isConnected || next.disabled) return;
        next.click();
        setTimeout(processStep, 900);
      }, 250);
      return;
    }
    render({ title: "Review the application", message: "No standard next or submit control was detected. Complete the form manually, then use the extension's status button.", actionText: "Close", onAction: closeAssistant });
  };

  const easyApply = [...document.querySelectorAll("button, a")].find((button) => visible(button) && /easy apply/i.test(textOf(button)) && !button.disabled);
  if (easyApply) {
    easyApply.click();
    setTimeout(() => {
      processStep();
    }, 700);
    return { message: "Easy Apply opened. The assistant will prompt for any required information." };
  }
  processStep();
  return { message: "Application assistant started on the current form." };
}
