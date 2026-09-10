import { describe, expect, it } from "vitest";
import {
  classifyFieldHeuristic,
  classifyFields,
  matchStaticFields,
  isQuestionField,
  type FieldInfo,
} from "./classify.js";

function field(overrides: Partial<FieldInfo> = {}): FieldInfo {
  return {
    fieldId: "f1",
    selector: "#f1",
    label: "",
    placeholder: null,
    fieldType: "text",
    ...overrides,
  };
}

describe("classifyFieldHeuristic", () => {
  it("maps name/email/phone labels to static subcategories", () => {
    expect(classifyFieldHeuristic("Full Name", null, "text")).toMatchObject({
      category: "static",
      subcategory: "name",
      confidence: 0.92,
    });
    expect(classifyFieldHeuristic("Email Address", null, "email")).toMatchObject({
      category: "static",
      subcategory: "email",
    });
    expect(classifyFieldHeuristic("Phone Number", null, "tel")).toMatchObject({
      category: "static",
      subcategory: "phone",
    });
  });

  it("uses the input type for generic labels", () => {
    expect(classifyFieldHeuristic("Type Here", null, "email")).toMatchObject({
      category: "static",
      subcategory: "email",
      confidence: 0.85,
    });
    expect(classifyFieldHeuristic("Enter", null, "tel")).toMatchObject({
      category: "static",
      subcategory: "phone",
    });
  });

  it("classifies file uploads by type or keyword", () => {
    expect(classifyFieldHeuristic("Resume", null, "file")).toMatchObject({
      category: "file_upload",
      confidence: 0.9,
    });
    expect(classifyFieldHeuristic("Upload your CV", null, "text")).toMatchObject({
      category: "file_upload",
    });
  });

  it("classifies select/checkbox/radio by type", () => {
    // Note: "Country" would classify as static/address (the backend's STATIC_MAP
    // matches "country" before the type check) — so use a non-colliding label.
    expect(classifyFieldHeuristic("Option", null, "select")).toMatchObject({
      category: "select",
      confidence: 0.85,
    });
    expect(classifyFieldHeuristic("Agree?", null, "checkbox")).toMatchObject({
      category: "checkbox",
      subcategory: "checkbox",
      confidence: 0.95,
    });
    expect(classifyFieldHeuristic("Yes/No", null, "radio")).toMatchObject({
      category: "checkbox",
      subcategory: "radio",
    });
  });

  it("routes salary-range textareas to long_answer with a question type", () => {
    expect(classifyFieldHeuristic("Expected Salary Range", null, "textarea")).toMatchObject({
      category: "long_answer",
      questionType: "salary",
      confidence: 0.82,
    });
  });

  it("routes llm-answerable short fields to long_answer", () => {
    expect(classifyFieldHeuristic("Years of Experience", null, "text")).toMatchObject({
      category: "long_answer",
      confidence: 0.8,
    });
  });

  it("detects the question type for free-form long answers", () => {
    expect(classifyFieldHeuristic("Describe a time you handled a conflict", null, "textarea")).toMatchObject({
      category: "long_answer",
      questionType: "behavioral",
      confidence: 0.78,
    });
    expect(classifyFieldHeuristic("Tell us about yourself", null, "textarea")).toMatchObject({
      category: "long_answer",
      questionType: "introduction",
    });
  });

  it("falls back to unknown for short, non-matching fields", () => {
    expect(classifyFieldHeuristic("X", null, "unknown")).toMatchObject({
      category: "unknown",
      confidence: 0.35,
    });
  });
});

describe("classifyFields", () => {
  it("attaches fieldId, selector, and label to each classification", () => {
    const out = classifyFields([
      field({ fieldId: "a", selector: "#a", label: "Full Name" }),
      field({ fieldId: "b", selector: "#b", label: "Describe a time you led a project" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fieldId: "a", selector: "#a", category: "static", label: "Full Name" });
    expect(out[1]).toMatchObject({ fieldId: "b", selector: "#b", category: "long_answer" });
  });
});

describe("matchStaticFields", () => {
  const profile = {
    first_name: "Chandra",
    last_name: "Sailesh",
    name: "Chandra Sailesh",
    email: "c@example.com",
    phone: "5551234",
  };

  it("auto-fills confident, non-sensitive profile values", () => {
    const { autoFills, sensitiveSuggestions } = matchStaticFields(
      [
        field({ fieldId: "n", label: "Full Name" }),
        field({ fieldId: "e", label: "Email" }),
        field({ fieldId: "p", label: "Phone" }),
      ],
      profile,
    );
    expect(autoFills.map((f) => f.key).sort()).toEqual(["email", "name", "phone"]);
    expect(autoFills.find((f) => f.key === "name")?.value).toBe("Chandra Sailesh");
    expect(sensitiveSuggestions).toEqual([]);
  });

  it("surfaces sensitive keys as review suggestions instead of auto-fills", () => {
    const { autoFills, sensitiveSuggestions } = matchStaticFields(
      [field({ fieldId: "g", label: "Gender" }), field({ fieldId: "e", label: "Email" })],
      { ...profile, gender: "Male" },
    );
    expect(autoFills.map((f) => f.key)).toEqual(["email"]);
    expect(sensitiveSuggestions).toHaveLength(1);
    expect(sensitiveSuggestions[0]).toMatchObject({ key: "gender", value: "Male" });
  });

  it("derives first/last name from a full name when parts are missing", () => {
    const { autoFills } = matchStaticFields(
      [field({ fieldId: "fn", label: "First Name" }), field({ fieldId: "ln", label: "Last Name" })],
      { name: "Ada Lovelace King" },
    );
    expect(autoFills.find((f) => f.key === "first_name")?.value).toBe("Ada");
    expect(autoFills.find((f) => f.key === "last_name")?.value).toBe("Lovelace King");
  });

  it("emits nothing when the profile has no value for the field", () => {
    const { autoFills, sensitiveSuggestions } = matchStaticFields(
      [field({ fieldId: "p", label: "Phone" })],
      {}, // empty profile
    );
    expect(autoFills).toEqual([]);
    expect(sensitiveSuggestions).toEqual([]);
  });
});

describe("isQuestionField", () => {
  it("accepts substantial free-text questions", () => {
    expect(isQuestionField("Tell me about yourself")).toBe(true);
    expect(isQuestionField("What is your greatest achievement?")).toBe(true);
  });

  it("rejects short labels, file-ish keywords, and prefixed ids", () => {
    expect(isQuestionField("Why?")).toBe(false);
    expect(isQuestionField("Upload your resume file")).toBe(false);
    expect(isQuestionField("customquestions.0.about you")).toBe(false);
  });
});
