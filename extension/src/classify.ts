// Field classification + static profile matching, ported from the Python
// backend so it runs entirely client-side (content script / background worker)
// against locally-read profile data — no network round-trip.
//
// Sources:
//   - backend/tools/tools.py::classify_field_heuristic
//   - backend/api/ws.py::match_static_fields / STATIC_FIELD_KEYWORDS / SENSITIVE_STATIC_KEYS
//   - backend/memory/memory_service.py::_is_question_field / NON_QUESTION_KEYWORDS

export interface FieldInfo {
  fieldId: string;
  selector?: string;
  label: string;
  placeholder?: string | null;
  fieldType: string;
  required?: boolean;
  context?: string;
  fieldIndex?: number;
  parentLabel?: string | null;
}

export interface FieldClassification {
  fieldId: string;
  selector: string;
  category: string;
  confidence: number;
  subcategory?: string;
  questionType?: string;
  label: string;
}

interface RawClassification {
  category: string;
  confidence: number;
  subcategory?: string;
  questionType?: string;
}

// Ported from QUESTION_TYPE_PATTERNS in tools.py (regex alternations are valid
// in both Python and JS, so they translate 1:1).
const QUESTION_TYPE_PATTERNS: [RegExp, string][] = [
  [/tell (me|us) about yourself|introduce yourself/, "introduction"],
  [/why (do you want|are you interested|should we hire)/, "motivation"],
  [/where do you see yourself|future goals|career goals/, "career_goals"],
  [/strength|weakness|best quality|area.?.?improve/, "strengths_weaknesses"],
  [/describe a time|tell me about a time|example of|situation where|behavioral/, "behavioral"],
  [/technical challenge|technical problem|difficult problem|complex project/, "technical"],
  [/why (are )?you leaving|reason for leaving/, "resignation_reason"],
  [/salary|compensation|expected|pay/, "salary"],
  [/available to start|start date|notice period|availability/, "availability"],
  [/work authorization|visa|sponsorship|legally authorized/, "work_authorization"],
  [/cover letter|why this role|why this position/, "cover_letter"],
  [/diversity|inclusion|equity/, "diversity"],
  [/teamwork|collaboration|work with others/, "teamwork"],
  [/leadership|manage|mentor/, "leadership"],
  [/conflict|disagreement|challenge with/, "conflict_resolution"],
  [/achievement|accomplishment|proud of/, "achievement"],
  [/customer|client|stakeholder/, "customer_facing"],
  [/project (you )?managed|project (you )?led/, "project_management"],
  [/fail|mistake|error|setback/, "failure"],
];

function detectQuestionType(combined: string): string {
  for (const [pattern, qtype] of QUESTION_TYPE_PATTERNS) {
    if (pattern.test(combined)) return qtype;
  }
  return "general";
}

const GENERIC_LABELS = new Set([
  "type here", "enter text", "please enter", "input", "text", "enter", "edit",
  "answer", "your answer", "write here", "your response", "",
]);

// type -> [category, subcategory | undefined, confidence]
const TYPE_TO_STATIC: Record<string, [string, string | undefined, number]> = {
  email: ["static", "email", 0.85],
  tel: ["static", "phone", 0.85],
  url: ["static", "portfolio", 0.8],
  date: ["static", "date", 0.75],
  file: ["file_upload", undefined, 0.8],
  number: ["static", "unknown", 0.6],
};

// subcategory key -> keywords. Only these map to plain-string profile fields
// that are safe to copy verbatim (see SENSITIVE_STATIC_KEYS for the subset that
// is surfaced for one-click review instead of auto-filled).
const STATIC_MAP: Record<string, string[]> = {
  name: ["name", "full name", "first name", "last name", "middle name"],
  email: ["email", "e-mail", "e mail"],
  phone: ["phone", "telephone", "mobile", "cell", "phone number"],
  address: ["address", "location", "city", "state", "zip", "postal", "country"],
  linkedin: ["linkedin", "linked in", "linkedin url", "linkedin profile"],
  github: ["github", "git hub", "github url", "github profile"],
  portfolio: ["portfolio", "website", "url", "personal website", "link"],
  gender: ["gender", "sex"],
  date_of_birth: ["date of birth", "dob", "birth date"],
  willing_to_relocate: ["relocate", "relocation", "willing to relocate"],
  work_authorization: ["work authorization", "authorized to work", "legally authorized to work", "eligible to work"],
  visa_status: ["visa status", "visa sponsorship", "require sponsorship", "need sponsorship"],
};

const FILE_UPLOAD_KEYWORDS = ["resume", "cover", "upload", "attach", "browse", "choose file", ".doc", ".pdf", ".docx"];

const SALARY_RANGE_PATTERNS = ["salary range", "salary and currency", "expected salary", "salary expectation", "compensation expected", "pay expectation"];

// Real application questions that have no plain-string profile field to copy
// from (salary/notice-period aren't stored) or whose profile field is structured
// data needing summarization — these route into the reviewable long_answer
// pipeline (LLM) rather than a "static" category nothing can actually fill.
const LLM_ANSWERABLE_SHORT_FIELDS = [
  "ctc", "lpa", "salary", "compensation", "pay",
  "notice period", "availability", "start date", "available",
  "expected", "current", "inhand", "in hand",
  "lakhs", "k per annum", "per annum",
  "years of experience", "total experience", "work experience",
  "education", "qualification", "degree", "college", "university",
  "graduation", "passing year", "year of passing",
  "language", "proficiency",
  "referral", "source", "how did you hear",
  "nationality",
];

export function classifyFieldHeuristic(
  label: string,
  placeholder: string | null | undefined,
  fieldType: string,
): RawClassification {
  const labelLower = (label || "").toLowerCase();
  const placeholderLower = (placeholder || "").toLowerCase();
  const combined = `${labelLower} ${placeholderLower}`;

  if (GENERIC_LABELS.has(labelLower)) {
    const t = TYPE_TO_STATIC[fieldType];
    if (t) {
      const [cat, sub, conf] = t;
      const r: RawClassification = { category: cat, confidence: conf };
      if (sub) r.subcategory = sub;
      return r;
    }
  }

  for (const [key, keywords] of Object.entries(STATIC_MAP)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      return { category: "static", subcategory: key, confidence: 0.92 };
    }
  }

  if (fieldType === "file" || FILE_UPLOAD_KEYWORDS.some((kw) => combined.includes(kw))) {
    return { category: "file_upload", confidence: 0.9 };
  }

  if (fieldType === "select" || fieldType === "select-one" || fieldType === "select-multiple" || fieldType === "dropdown") {
    return { category: "select", confidence: 0.85 };
  }

  if (fieldType === "checkbox") {
    return { category: "checkbox", subcategory: "checkbox", confidence: 0.95 };
  }

  if (fieldType === "radio") {
    return { category: "checkbox", subcategory: "radio", confidence: 0.9 };
  }

  if (SALARY_RANGE_PATTERNS.some((p) => combined.includes(p)) &&
      (fieldType === "textarea" || fieldType === "text" || fieldType === "unknown" || fieldType === "")) {
    return { category: "long_answer", questionType: detectQuestionType(combined), confidence: 0.82 };
  }

  if (LLM_ANSWERABLE_SHORT_FIELDS.some((kw) => combined.includes(kw))) {
    return { category: "long_answer", questionType: detectQuestionType(combined), confidence: 0.8 };
  }

  if (fieldType === "textarea" || fieldType === "text" || label.length > 15) {
    return { category: "long_answer", questionType: detectQuestionType(combined), confidence: 0.78 };
  }

  return { category: "unknown", confidence: 0.35 };
}

export function classifyFields(fields: FieldInfo[]): FieldClassification[] {
  return fields.map((f) => {
    const r = classifyFieldHeuristic(f.label, f.placeholder, f.fieldType);
    const c: FieldClassification = {
      fieldId: f.fieldId,
      selector: f.selector || "",
      category: r.category,
      confidence: r.confidence,
      label: f.label,
    };
    if (r.subcategory) c.subcategory = r.subcategory;
    if (r.questionType) c.questionType = r.questionType;
    return c;
  });
}

// ---------------------------------------------------------------------------
// Static profile matching (ported from ws.py::match_static_fields)
// ---------------------------------------------------------------------------

export const STATIC_FIELD_KEYWORDS: Record<string, string[]> = {
  first_name: ["first name", "given name", "local given name"],
  last_name: ["last name", "family name", "surname", "local family name"],
  name: ["full name"],
  email: ["email", "e-mail", "e mail"],
  phone: ["phone", "telephone", "mobile", "cell"],
  city: ["city", "town", "locality"],
  state: ["state", "province", "region"],
  zip_code: ["zip", "postal", "zipcode", "zip code", "postal code", "pincode"],
  country: ["country", "nation"],
  address: ["address", "location", "street", "line 1", "line 2"],
  linkedin: ["linkedin", "linked in"],
  github: ["github", "git hub"],
  portfolio: ["portfolio", "website", "url", "link"],
  gender: ["gender", "sex"],
  date_of_birth: ["date of birth", "dob", "birth date"],
  willing_to_relocate: ["relocate", "relocation", "willing to relocate"],
  work_authorization: ["work authorization", "authorized to work", "legally authorized to work", "eligible to work"],
  visa_status: ["visa status", "visa sponsorship", "require sponsorship", "need sponsorship"],
};

// Legally/personally sensitive fields are never silently auto-filled even when
// Snag has a confident profile value. They're surfaced as reviewable
// suggestions (same Accept/Edit/Skip flow) instead of written into the DOM
// unattended.
export const SENSITIVE_STATIC_KEYS = new Set([
  "work_authorization", "visa_status", "gender", "date_of_birth",
]);

export interface StaticFill {
  fieldId: string;
  selector: string;
  label: string;
  value: string;
  key: string;
}

export function matchStaticFields(
  fields: FieldInfo[],
  profile: Record<string, string>,
): { autoFills: StaticFill[]; sensitiveSuggestions: StaticFill[] } {
  let first_name = profile["first_name"] || "";
  let last_name = profile["last_name"] || "";
  let full_name = profile["name"] || "";

  if (!first_name && !last_name && full_name) {
    const parts = full_name.trim().split(/\s+/).filter(Boolean);
    first_name = parts[0] || "";
    last_name = parts.length > 1 ? parts.slice(1).join(" ") : "";
  }

  if (!full_name && first_name) {
    full_name = `${first_name} ${last_name}`.trim();
  }

  const nameMap: Record<string, string> = {
    first_name,
    last_name,
    name: full_name,
  };

  const autoFills: StaticFill[] = [];
  const sensitiveSuggestions: StaticFill[] = [];

  const emit = (field: FieldInfo, profileKey: string, val: string) => {
    const entry: StaticFill = {
      fieldId: field.fieldId,
      selector: field.selector || "",
      label: field.label,
      value: val,
      key: profileKey,
    };
    (SENSITIVE_STATIC_KEYS.has(profileKey) ? sensitiveSuggestions : autoFills).push(entry);
  };

  for (const field of fields) {
    const labelLower = (field.label || "").toLowerCase();
    let matched = false;

    for (const [profileKey, keywords] of Object.entries(STATIC_FIELD_KEYWORDS)) {
      if (keywords.some((kw) => labelLower.includes(kw))) {
        const val = profileKey in nameMap ? nameMap[profileKey] : profile[profileKey];
        if (val) emit(field, profileKey, val);
        matched = true;
        break;
      }
    }

    if (!matched && GENERIC_LABELS.has(labelLower)) {
      const typeProfileMap: Record<string, string> = {
        email: "email",
        tel: "phone",
        url: "portfolio",
      };
      const profileKey = typeProfileMap[field.fieldType];
      if (profileKey) {
        const val = profile[profileKey];
        if (val) emit(field, profileKey, val);
      }
    }
  }

  return { autoFills, sensitiveSuggestions };
}

// ---------------------------------------------------------------------------
// Question-field filter (ported from memory_service.py::_is_question_field)
// ---------------------------------------------------------------------------

const NON_QUESTION_KEYWORDS = new Set([
  "upload", "file", "drop", "select", "attach", "browse", "choose",
  "resume", "cv", "document", "pdf", "doc", "docx", "image", "photo",
  "screenshot", "recaptcha", "captcha", "robot", "verify", "security",
]);

export function isQuestionField(label: string): boolean {
  const labelLower = label.toLowerCase().trim();
  if (labelLower.length < 10) return false;
  for (const kw of NON_QUESTION_KEYWORDS) {
    if (labelLower.includes(kw)) return false;
  }
  if (labelLower.startsWith("customquestions.")) return false;
  return true;
}
