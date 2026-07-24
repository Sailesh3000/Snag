const SIDEBAR_URL = chrome.runtime.getURL("sidebar/index.html");

interface FormField {
  id: string;
  selector: string;
  label: string;
  placeholder: string | null;
  type: string;
  required: boolean;
  context: string;
  fieldIndex: number;
  parentLabel: string | null;
}

let sidebarIframe: HTMLIFrameElement | null = null;
let isFilling = false;
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let lastFieldCount = 0;
let lastSentAt = 0;
let mutationObserver: MutationObserver | null = null;

function isGenericPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "type here", "enter text", "please enter", "input",
    "enter your", "type your", "fill in", "provide",
    "enter value", "type value", "text", "enter", "edit",
    "your answer", "answer", "write here", "your response",
  ].some((g) => lower === g || lower.startsWith(g + " "));
}

function debouncedSendPageUpdate(): void {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    if (isFilling) return;
    const now = Date.now();
    if (now - lastSentAt < 5000) return;
    const fields = extractFormFields();
    const interactiveFields = fields.filter(
      (f) => f.type !== "hidden" && f.type !== "submit" && f.type !== "button"
    );
    if (interactiveFields.length !== lastFieldCount && interactiveFields.length > 0) {
      lastFieldCount = interactiveFields.length;
      lastSentAt = now;
      sendPageUpdate();
    }
  }, 3000);
}

function getFieldContext(el: Element): string {
  const ancestors = [
    el.closest("fieldset, section, .section, .panel, .application-panel, [class*='section']"),
    el.parentElement?.parentElement,
    el.parentElement?.parentElement?.parentElement,
  ].filter(Boolean) as Element[];

  for (const ancestor of ancestors) {
    const heading = ancestor.querySelector(
      "h1, h2, h3, h4, h5, h6, legend, [role=heading], [class*='title'], [class*='header']"
    );
    if (heading?.textContent?.trim()) return heading.textContent.trim();
  }
  return "";
}

function getAccessibleName(el: HTMLElement): string {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const texts = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (texts.length) return texts.join(" ");
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  if ("labels" in el && (el as HTMLInputElement).labels && (el as HTMLInputElement).labels!.length > 0) {
    const t = (el as HTMLInputElement).labels![0].textContent?.trim();
    if (t) return t;
  }

  const title = el.getAttribute("title");
  if (title) return title;

  return "";
}

function walkSiblings(el: HTMLElement, maxLevels: number): string {
  let current: HTMLElement | null = el;
  for (let level = 0; level < maxLevels && current; level++) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;

    const kids = Array.from(parent.children);
    const idx = kids.indexOf(current);

    for (let i = idx - 1; i >= 0; i--) {
      const sib = kids[i] as HTMLElement;
      if (sib.matches("input, textarea, select, [role=textbox], [contenteditable=true], button")) break;

      const t = sib.textContent?.trim();
      if (t && isLabelHumanReadable(t) && !isGenericPlaceholder(t) && t.length < 80) return t;

      for (const child of Array.from(sib.children) as HTMLElement[]) {
        const ct = child.textContent?.trim();
        if (ct && isLabelHumanReadable(ct) && !isGenericPlaceholder(ct) && ct.length < 80) return ct;
      }
    }

    current = parent;
  }
  return "";
}

function proximityFallback(el: HTMLElement): string {
  const elRect = el.getBoundingClientRect();
  if (elRect.width === 0 || elRect.height === 0) return "";

  let bestText = "";
  let bestDist = Infinity;
  const MAX_DIST = 150;

  const candidates = document.querySelectorAll("span, div, label, legend, p, h1, h2, h3, h4, h5, h6, td, th");
  for (const node of Array.from(candidates) as HTMLElement[]) {
    if (node.contains(el) || el.contains(node)) continue;

    const t = node.textContent?.trim();
    if (!t || t.length > 80 || !isLabelHumanReadable(t) || isGenericPlaceholder(t)) continue;

    const nodeRect = node.getBoundingClientRect();
    if (nodeRect.width === 0 || nodeRect.height === 0) continue;

    const verticalOverlap =
      nodeRect.top <= elRect.bottom && nodeRect.bottom >= elRect.top;
    const horizontalOverlap =
      nodeRect.left <= elRect.right && nodeRect.right >= elRect.left;

    if (!verticalOverlap && !horizontalOverlap) continue;

    const dx = Math.max(0, Math.max(elRect.left, nodeRect.left) - Math.min(elRect.right, nodeRect.right));
    const dy = Math.max(0, Math.max(elRect.top, nodeRect.top) - Math.min(elRect.bottom, nodeRect.bottom));
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < bestDist && dist < MAX_DIST) {
      bestDist = dist;
      bestText = t;
    }
  }
  return bestText;
}

const TYPE_FALLBACKS: Record<string, string> = {
  email: "Email address",
  tel: "Phone number",
  url: "Website URL",
  date: "Date",
  file: "File upload",
  number: "Number",
};

function extractLabel(el: HTMLElement): string {
  const accessible = getAccessibleName(el);
  if (accessible && isLabelHumanReadable(accessible) && !isGenericPlaceholder(accessible)) {
    return accessible;
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder && isLabelHumanReadable(placeholder) && !isGenericPlaceholder(placeholder)) {
    return placeholder;
  }

  const sibling = walkSiblings(el, 3);
  if (sibling) return sibling;

  const proximity = proximityFallback(el);
  if (proximity) return proximity;

  const inputType = el.getAttribute("type") || el.tagName.toLowerCase();
  if (TYPE_FALLBACKS[inputType]) return TYPE_FALLBACKS[inputType];

  return accessible || "";
}

function isLabelHumanReadable(label: string): boolean {
  if (!label) return false;
  if (/^[a-f0-9-]{20,}$/i.test(label)) return false;
  if (/^[a-f0-9]{8,}-[a-f0-9]{4,}-/i.test(label)) return false;
  if (/^(primaryQuestionnaire|secondaryQuestionnaire)--/i.test(label)) return false;
  if (label.length > 80) return false;
  return true;
}

function extractFormFields(): FormField[] {
  const fields: FormField[] = [];
  const selectors = "input, textarea, select, [role=textbox], [role=combobox], [role=listbox], [contenteditable=true]";
  const elements = document.querySelectorAll<HTMLElement>(selectors);

  elements.forEach((el, index) => {
    const placeholder = el.getAttribute("placeholder");
    const inputType = el.getAttribute("type") || el.tagName.toLowerCase();

    const role = el.getAttribute("role");
    let normalizedType = inputType || "unknown";
    if (role === "textbox" || el.getAttribute("contenteditable") === "true") {
      normalizedType = "textarea";
    }

    const label = extractLabel(el);

    if (normalizedType === "hidden" || normalizedType === "submit" || normalizedType === "button") return;

    fields.push({
      id: el.id || `field_${index}`,
      selector: buildSelector(el),
      label,
      placeholder: placeholder || null,
      type: normalizedType,
      required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
      context: getFieldContext(el),
      fieldIndex: index,
      parentLabel: null,
    });
  });

  return fields;
}

function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  for (const attr of ["data-automation-id", "data-testid", "data-field", "data-question"]) {
    const val = el.getAttribute(attr);
    if (val) return `[${attr}="${CSS.escape(val)}"]`;
  }
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    let sel = current.tagName.toLowerCase();
    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).filter((c) => c.length > 1).slice(0, 2);
      if (classes.length) sel += `.${classes.map((c) => CSS.escape(c)).join(".")}`;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) sel += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    path.unshift(sel);
    current = current.parentElement;
  }
  return path.join(" > ");
}


function injectSidebar() {
  if (document.getElementById("applypilot-sidebar")) return;

  const container = document.createElement("div");
  container.id = "applypilot-sidebar";
  container.style.cssText = `
    position: fixed; top: 0; right: 0; z-index: 2147483647;
    width: 380px; height: 100vh; border: none;
    box-shadow: -4px 0 24px rgba(0,0,0,0.15);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;

  const iframe = document.createElement("iframe");
  iframe.src = SIDEBAR_URL;
  iframe.style.cssText = "width:100%;height:100%;border:none;background:transparent;";
  iframe.allow = "clipboard-read; clipboard-write; storage-access; autoplay";
  container.appendChild(iframe);
  sidebarIframe = iframe;

  const toggle = document.createElement("button");
  toggle.id = "applypilot-toggle";
  toggle.textContent = "AP";
  toggle.style.cssText = `
    position: fixed; right: 0; top: 50%; z-index: 2147483647;
    width: 32px; height: 32px; border-radius: 8px 0 0 8px;
    background: #6366f1; color: white; border: none;
    cursor: pointer; font-weight: bold; font-size: 12px;
    display: none; align-items: center; justify-content: center;
    box-shadow: -2px 0 8px rgba(0,0,0,0.1);
  `;
  toggle.onclick = () => {
    const shown = container.style.transform === "translateX(0px)";
    container.style.transform = shown ? "translateX(100%)" : "translateX(0px)";
    toggle.style.right = shown ? "0" : "380px";
    toggle.style.borderRadius = shown ? "8px 0 0 8px" : "0 8px 8px 0";
  };
  document.body.appendChild(toggle);
  document.body.appendChild(container);
  setTimeout(() => { toggle.style.display = "flex"; }, 500);
}

function findField(selector: string, label?: string): HTMLElement | null {
  let el = document.querySelector<HTMLElement>(selector);
  if (el) return el;
  if (!label) return null;
  const all = document.querySelectorAll<HTMLElement>("input, textarea, select, [role=textbox], [contenteditable=true]");
  for (const candidate of all) {
    const candidateLabel = extractLabel(candidate);
    if (candidateLabel.toLowerCase().includes(label.toLowerCase())) return candidate;
  }
  return null;
}

function applyFill(selector: string, value: string, highlightColor = "#6366f1", label?: string): boolean {
  try {
    const el = findField(selector, label);
    if (!el) return false;

    el.focus();
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        (el as HTMLInputElement | HTMLTextAreaElement).value = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (
      el.getAttribute("contenteditable") === "true" ||
      el.getAttribute("role") === "textbox"
    ) {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.innerHTML = "";
      const lines = value.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(lines[i]));
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.setAttribute("value", value);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    el.dispatchEvent(new Event("blur", { bubbles: true }));

    el.style.transition = "box-shadow 0.3s ease, outline 0.3s ease";
    el.style.outline = `2px solid ${highlightColor}`;
    el.style.outlineOffset = "2px";
    setTimeout(() => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    }, 3000);
    return true;
  } catch {
    return false;
  }
}

function highlightField(selector: string, color: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.style.transition = "box-shadow 0.3s ease, outline 0.3s ease";
  el.style.outline = `2px solid ${color}`;
  el.style.outlineOffset = "2px";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearHighlights(): void {
  document.querySelectorAll<HTMLElement>("[style*='outline']").forEach((el) => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  });
}

function forwardToSidebar(msg: unknown): void {
  if (sidebarIframe?.contentWindow) {
    sidebarIframe.contentWindow.postMessage({ source: "applypilot", msg }, "*");
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "activate") {
    init();
    return;
  }

  if (msg.type === "deactivate") {
    cleanup();
    return;
  }

  const payload = msg.payload || {};

  if (msg.type === "profile:fills") {
    const fills = payload.fills as Array<{ fieldId: string; selector: string; value: string; key?: string }> | undefined;
    if (!fills) return;
    isFilling = true;
    for (const fill of fills) {
      const ok = applyFill(fill.selector, fill.value, "#6366f1", fill.key);
      chrome.runtime.sendMessage({ type: "fill:execute", payload: { ...fill, success: ok } });
    }
    setTimeout(() => { isFilling = false; }, 500);
  }

  if (msg.type === "fill:preview") {
    const selector = payload.selector as string;
    const label = payload.label as string | undefined;
    if (selector) {
      highlightField(selector, "#f59e0b");
    } else if (label) {
      const el = findField("", label);
      if (el) {
        el.style.transition = "box-shadow 0.3s ease, outline 0.3s ease";
        el.style.outline = "2px solid #f59e0b";
        el.style.outlineOffset = "2px";
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  if (msg.type === "fill:executed") {
    const selector = payload.selector as string;
    const value = payload.value as string;
    const label = payload.label as string | undefined;
    isFilling = true;
    if (selector && value) applyFill(selector, value, "#10b981", label);
    setTimeout(() => { isFilling = false; }, 500);
  }

  if (msg.type === "fill:rejected") {
    clearHighlights();
  }

  forwardToSidebar(msg);
});

window.addEventListener("message", (event) => {
  if (event.data?.source === "applypilot" && event.data?.type) {
    chrome.runtime.sendMessage({ type: event.data.type, payload: event.data.payload });
  }
});

function sendPageUpdate() {
  const fields = extractFormFields();

  const jobTitleSelectors = [
    '[data-automation-id*="jobTitle"]',
    "h1",
    ".job-title",
    ".posting-title",
    '[class*="job"] h1',
    '[class*="title"] h1',
  ];
  let jobTitle: string | undefined;
  for (const sel of jobTitleSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el?.textContent?.trim()) {
      jobTitle = el.textContent.trim();
      break;
    }
  }

  const companySelectors = [
    '[data-automation-id*="company"]',
    ".company-name",
    ".employer-name",
    '[class*="company"]',
    '[class*="employer"]',
  ];
  let company: string | undefined;
  for (const sel of companySelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el?.textContent?.trim()) {
      company = el.textContent.trim();
      break;
    }
  }

  chrome.runtime.sendMessage({
    type: "page:update",
    payload: {
      url: window.location.href,
      fields,
      jobTitle: jobTitle || null,
      company: company || null,
    },
  });

  const capture = (obj: Record<string, unknown>, depth = 0) => {
    if (depth > 2) return "...";
    const items: string[] = [];
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (typeof v === "string") {
        items.push(`${k}:${JSON.stringify(v)}`);
      } else if (typeof v === "number" || typeof v === "boolean") {
        items.push(`${k}:${v}`);
      } else if (Array.isArray(v) && v.length > 0) {
        const first = v[0];
        if (typeof first === "object" && first !== null) {
          items.push(`${k}:[{...}]`);
        } else if (typeof first === "string") {
          items.push(`${k}:${first}`);
        } else {
          items.push(`${k}:[${v.length} items]`);
        }
      } else {
        items.push(`${k}:...`);
      }
    }
    return `{${items.join(", ")}}`;
  };

  console.log(
    `%c [ApplyPilot] WS Payload`,
    "color:green;background:black;padding:2px;border-radius:3px;",
    JSON.stringify(capture({ url: window.location.href, fields, jobTitle, company }), null, 2),
  );
}

const isTopFrame = window.top === window.self;

function init() {
  if (isTopFrame) {
    injectSidebar();
  }
  sendPageUpdate();

  mutationObserver = new MutationObserver(() => {
    if (!isFilling) debouncedSendPageUpdate();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
}

function cleanup() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  if (isTopFrame) {
    const toggle = document.getElementById("applypilot-toggle");
    if (toggle) toggle.remove();

    const sidebar = document.getElementById("applypilot-sidebar");
    if (sidebar) sidebar.remove();

    sidebarIframe = null;
  }

  isFilling = false;
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
  lastFieldCount = 0;
  lastSentAt = 0;
}