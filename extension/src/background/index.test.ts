import { describe, expect, it } from "vitest";

// background/index.ts registers chrome.* listeners at module scope (it's a
// service worker) — stub just enough of the API surface for import to
// succeed without a real extension runtime. Must run BEFORE the dynamic
// import below, so it's plain top-level code, not a beforeAll callback.
(globalThis as any).chrome = {
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  runtime: { onMessage: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} } },
  action: { onClicked: { addListener: () => {} } },
  storage: { local: { get: (_key: string, cb: (v: object) => void) => cb({}) } },
};

const { parseResumeExtractionJson } = await import("./index.js");

describe("parseResumeExtractionJson", () => {
  it("parses a plain JSON object", () => {
    const json = JSON.stringify({ first_name: "Ada", last_name: "Lovelace", skills: ["Python"] });
    const result = parseResumeExtractionJson(json);
    expect(result.first_name).toBe("Ada");
    expect(result.skills).toEqual(["Python"]);
  });

  it("strips a ```json fenced block the model wasn't supposed to add", () => {
    const json = "```json\n" + JSON.stringify({ first_name: "Ada" }) + "\n```";
    expect(parseResumeExtractionJson(json).first_name).toBe("Ada");
  });

  it("strips a bare ``` fenced block", () => {
    const json = "```\n" + JSON.stringify({ first_name: "Ada" }) + "\n```";
    expect(parseResumeExtractionJson(json).first_name).toBe("Ada");
  });

  it("throws on non-JSON output instead of silently returning garbage", () => {
    expect(() => parseResumeExtractionJson("Sorry, I can't do that.")).toThrow();
  });

  it("throws when the JSON value isn't an object", () => {
    expect(() => parseResumeExtractionJson("[1,2,3]")).not.toThrow(); // arrays are typeof 'object'
    expect(() => parseResumeExtractionJson("42")).toThrow();
    expect(() => parseResumeExtractionJson("null")).toThrow();
  });
});
