// @vitest-environment jsdom
//
// content/index.ts is injected via chrome.scripting.executeScript as a
// classic (non-module) script, so it can't have import/export statements —
// see the __SNAG_TEST__ block at the bottom of that file for why these
// tests dynamically-import the REAL shipped file instead of a duplicated
// copy.
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let internals: any;

beforeAll(async () => {
  // jsdom doesn't implement scrollIntoView; applyFill/findField call it as a
  // normal DOM side effect that real browsers support fine.
  (Element.prototype as any).scrollIntoView = () => {};

  (globalThis as any).__SNAG_TEST__ = true;
  (globalThis as any).chrome = {
    runtime: {
      getURL: (p: string) => `chrome-extension://test/${p}`,
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
    },
    storage: { local: { get: () => {} } },
  };
  await import("./index.js");
  internals = (globalThis as any).__snagInternals;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("stableIdFromSelector", () => {
  it("is deterministic for the same selector", () => {
    const a = internals.stableIdFromSelector("div.foo > input:nth-of-type(2)");
    const b = internals.stableIdFromSelector("div.foo > input:nth-of-type(2)");
    expect(a).toBe(b);
  });

  it("differs for different selectors (duplicate-label regression)", () => {
    // Two fields sharing a visible label but at different DOM positions
    // must get different selectors -> different stable ids.
    const idA = internals.stableIdFromSelector("form > div:nth-of-type(1) > textarea");
    const idB = internals.stableIdFromSelector("form > div:nth-of-type(2) > textarea");
    expect(idA).not.toBe(idB);
  });
});

describe("extractFormFields — duplicate labels get distinct stable ids", () => {
  it("assigns different field ids to two same-labeled textareas", () => {
    document.body.innerHTML = `
      <form>
        <div><label>Additional comments</label><textarea></textarea></div>
        <div><label>Additional comments</label><textarea></textarea></div>
      </form>
    `;
    const fields = internals.extractFormFields();
    const commentFields = fields.filter((f: any) => f.label === "Additional comments");
    expect(commentFields).toHaveLength(2);
    expect(commentFields[0].id).not.toBe(commentFields[1].id);
    expect(commentFields[0].selector).not.toBe(commentFields[1].selector);
  });
});

describe("isTruthyValue", () => {
  it("recognizes common truthy strings", () => {
    for (const v of ["true", "Yes", "1", "ON", "agree"]) {
      expect(internals.isTruthyValue(v)).toBe(true);
    }
  });

  it("recognizes common falsy strings", () => {
    for (const v of ["false", "No", "0", "off", ""]) {
      expect(internals.isTruthyValue(v)).toBe(false);
    }
  });

  it("treats other non-empty text (an option's own label) as truthy", () => {
    expect(internals.isTruthyValue("Authorized to work")).toBe(true);
  });
});

describe("selectOption", () => {
  it("matches by visible option text", () => {
    document.body.innerHTML = `<select><option value="us">United States</option><option value="ca">Canada</option></select>`;
    const el = document.querySelector("select")!;
    const ok = internals.selectOption(el, "Canada");
    expect(ok).toBe(true);
    expect(el.value).toBe("ca");
  });

  it("returns false when no option matches", () => {
    document.body.innerHTML = `<select><option value="us">United States</option></select>`;
    const el = document.querySelector("select")!;
    expect(internals.selectOption(el, "Atlantis")).toBe(false);
  });
});

describe("setCheckedState", () => {
  it("checks a radio and dispatches change", () => {
    document.body.innerHTML = `<input type="radio" name="g" value="yes" /><input type="radio" name="g" value="no" checked />`;
    const [yes, no] = Array.from(document.querySelectorAll("input"));
    let changed = false;
    yes.addEventListener("change", () => { changed = true; });

    internals.setCheckedState(yes, true);

    expect((yes as HTMLInputElement).checked).toBe(true);
    expect((no as HTMLInputElement).checked).toBe(false); // native radio-group behavior
    expect(changed).toBe(true);
  });
});

describe("findField — no fuzzy guessing (P1 item #7)", () => {
  it("finds the field by its own stale-but-still-present selector", () => {
    document.body.innerHTML = `<input id="q1" />`;
    const result = internals.findField("#q1");
    expect(result.el).not.toBeNull();
  });

  it("falls back to an exact label match when the selector is stale", () => {
    document.body.innerHTML = `<label>Email</label><input aria-label="Email" />`;
    const result = internals.findField("#gone", "Email");
    expect(result.el).not.toBeNull();
  });

  it("never fuzzy-matches 'Name' onto 'First Name' (would have silently misfired before)", () => {
    document.body.innerHTML = `<input aria-label="First Name" /><input aria-label="Last Name" /><input aria-label="Company Name" />`;
    const result = internals.findField("#gone", "Name");
    expect(result.el).toBeNull();
    expect(result.reason).toBe("not_found");
  });

  it("reports ambiguous rather than guessing when a label matches multiple fields", () => {
    document.body.innerHTML = `<textarea aria-label="Additional comments"></textarea><textarea aria-label="Additional comments"></textarea>`;
    const result = internals.findField("#gone", "Additional comments");
    expect(result.el).toBeNull();
    expect(result.reason).toBe("ambiguous");
  });
});

describe("applyFill — reports failure instead of pretending success", () => {
  it("reports not_found for a missing field, never throws", () => {
    const result = internals.applyFill("#does-not-exist", "some value");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("fills a plain text input and reports success", () => {
    document.body.innerHTML = `<input id="q1" />`;
    const result = internals.applyFill("#q1", "hello");
    expect(result.success).toBe(true);
    expect((document.querySelector("#q1") as HTMLInputElement).value).toBe("hello");
  });
});
