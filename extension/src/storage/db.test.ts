import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import * as db from "./db.js";

const DB_NAME = "snag";
const STORES = ["profile", "resumes", "answers"] as const;

// The module caches one open connection, and fake-indexeddb keeps a single
// in-memory DB per factory, so we clear every store between tests for isolation.
async function clearAll(): Promise<void> {
  await db.openDB(); // ensure the stores exist
  for (const store of STORES) {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onsuccess = () => {
        const t = req.result.transaction(store, "readwrite");
        t.objectStore(store).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

beforeEach(clearAll);

describe("profile", () => {
  it("returns {} when empty", async () => {
    expect(await db.getProfile()).toEqual({});
  });

  it("stores and returns verified fields", async () => {
    await db.setProfileField("email", "a@b.com");
    await db.setProfileField("name", "John Doe");
    expect(await db.getProfile()).toEqual({ email: "a@b.com", name: "John Doe" });
  });

  it("excludes unverified fields from getProfile but keeps them in getAllProfileFields", async () => {
    await db.setProfileField("email", "a@b.com");
    await db.setProfileField("ssn", "123", false);
    expect(await db.getProfile()).toEqual({ email: "a@b.com" });
    expect(await db.getAllProfileFields()).toEqual({
      email: { value: "a@b.com", verified: true },
      ssn: { value: "123", verified: false },
    });
  });

  it("overwrites an existing field", async () => {
    await db.setProfileField("phone", "111");
    await db.setProfileField("phone", "222");
    expect((await db.getProfile()).phone).toBe("222");
  });

  it("deletes a field", async () => {
    await db.setProfileField("email", "a@b.com");
    await db.deleteProfileField("email");
    expect(await db.getProfile()).toEqual({});
  });
});

describe("resumes", () => {
  it("adds, lists (metadata only), fetches (with blob), and deletes", async () => {
    const id = await db.addResume("a.pdf", new Blob(["pdf-bytes"]), "extracted text");
    expect(id).toMatch(/^res_/);

    const list = await db.getResumes();
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("a.pdf");
    expect(list[0].extractedText).toBe("extracted text");
    expect("blob" in list[0]).toBe(false); // blob stripped from listing

    const full = await db.getResume(id);
    expect(full).toBeDefined();
    expect(full!.blob).toBeInstanceOf(Blob);
    expect(await full!.blob.text()).toBe("pdf-bytes");

    await db.deleteResume(id);
    expect(await db.getResumes()).toEqual([]);
  });

  it("getResume returns undefined for a missing id", async () => {
    expect(await db.getResume("nope")).toBeUndefined();
  });
});

describe("answers", () => {
  it("saves with defaults and returns the record", async () => {
    const rec = await db.saveAnswer({ question: "Why?", answer: "Because" });
    expect(rec.id).toMatch(/^ans_/);
    expect(rec.approved).toBe(true);
    expect(rec.embedding).toBeNull();
    expect(rec.company).toBe("");
  });

  it("upserts by (question, company, role) instead of duplicating", async () => {
    await db.saveAnswer({ question: "Why?", answer: "v1", company: "Acme" });
    await db.saveAnswer({ question: "Why?", answer: "v2", company: "Acme" });
    const all = await db.getAnswers();
    expect(all).toHaveLength(1);
    expect(all[0].answer).toBe("v2");
  });

  it("keeps separate entries for different companies", async () => {
    await db.saveAnswer({ question: "Why?", answer: "a", company: "Acme" });
    await db.saveAnswer({ question: "Why?", answer: "b", company: "Globex" });
    expect(await db.getAnswers()).toHaveLength(2);
  });

  it("stores an embedding vector when provided", async () => {
    const rec = await db.saveAnswer({ question: "Q", answer: "A", embedding: [0.1, 0.2, 0.3] });
    const all = await db.getAnswers();
    expect(all[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(rec.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("updates answer text in place", async () => {
    const rec = await db.saveAnswer({ question: "Q", answer: "old" });
    expect(await db.updateAnswer(rec.id, "new")).toBe(true);
    expect((await db.getAnswers())[0].answer).toBe("new");
    expect(await db.updateAnswer("missing", "x")).toBe(false);
  });

  it("deletes an answer", async () => {
    const rec = await db.saveAnswer({ question: "Q", answer: "A" });
    expect(await db.deleteAnswer(rec.id)).toBe(true);
    expect(await db.getAnswers()).toEqual([]);
    expect(await db.deleteAnswer(rec.id)).toBe(false);
  });
});

describe("embeddingIdFor", () => {
  it("is deterministic and distinguishes inputs", () => {
    expect(db.embeddingIdFor("Q", "A", "R")).toBe(db.embeddingIdFor("Q", "A", "R"));
    expect(db.embeddingIdFor("Q", "A", "R")).not.toBe(db.embeddingIdFor("Q", "B", "R"));
    expect(db.embeddingIdFor("Q", "A", "R")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("ephemeral sessions / pending fills (in-memory)", () => {
  it("stores and retrieves a session", () => {
    db.upsertSession({ id: "s1", company: "Acme", role: "Eng", url: "u", jobDescription: "jd" });
    expect(db.getSession("s1")).toMatchObject({ company: "Acme" });
    db.deleteSession("s1");
    expect(db.getSession("s1")).toBeUndefined();
  });

  it("setPendingFill + takePendingFill pops exactly once", () => {
    db.setPendingFill("r1", { sessionId: "s1", question: "Q", finalAnswer: "A", company: "", role: "" });
    expect(db.takePendingFill("r1")).toMatchObject({ question: "Q" });
    expect(db.takePendingFill("r1")).toBeUndefined();
  });

  it("deleteSession purges that session's pending fills only", () => {
    db.setPendingFill("r1", { sessionId: "s1", question: "Q", finalAnswer: "A", company: "", role: "" });
    db.setPendingFill("r2", { sessionId: "s2", question: "Q", finalAnswer: "A", company: "", role: "" });
    db.deleteSession("s1");
    expect(db.takePendingFill("r1")).toBeUndefined();
    expect(db.takePendingFill("r2")).toMatchObject({ sessionId: "s2" });
  });
});
