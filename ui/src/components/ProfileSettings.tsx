import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useProfile } from "../hooks/useProfile";

interface FieldDef {
  key: string;
  label: string;
  icon: React.JSX.Element;
  required?: boolean;
}

const icon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const locationIcon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const linkIcon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const emailIcon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const phoneIcon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const docIcon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const workIcon = (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const FIELD_GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Personal",
    fields: [
      { key: "first_name", label: "First Name", icon, required: true },
      { key: "last_name", label: "Last Name", icon, required: true },
      { key: "name", label: "Full Name", icon },
      { key: "email", label: "Email", icon: emailIcon, required: true },
      { key: "phone", label: "Phone", icon: phoneIcon },
      { key: "gender", label: "Gender", icon },
      { key: "date_of_birth", label: "Date of Birth", icon },
    ],
  },
  {
    title: "Location",
    fields: [
      { key: "city", label: "City", icon: locationIcon },
      { key: "state", label: "State", icon: locationIcon },
      { key: "zip_code", label: "Zip Code", icon: locationIcon },
      { key: "country", label: "Country", icon: locationIcon },
      { key: "address", label: "Address", icon: locationIcon },
    ],
  },
  {
    title: "Work",
    fields: [
      { key: "work_authorization", label: "Work Authorization", icon: workIcon },
      { key: "visa_status", label: "Visa Status", icon: workIcon },
      { key: "willing_to_relocate", label: "Willing to Relocate", icon: workIcon },
    ],
  },
  {
    title: "Links",
    fields: [
      { key: "linkedin", label: "LinkedIn", icon: linkIcon },
      { key: "github", label: "GitHub", icon: linkIcon },
      { key: "portfolio", label: "Portfolio", icon: linkIcon },
    ],
  },
  {
    title: "Experience",
    fields: [
      { key: "education", label: "Education", icon: docIcon },
      { key: "experience", label: "Experience", icon: docIcon },
      { key: "skills", label: "Skills", icon: docIcon },
    ],
  },
];

export default function ProfileSettings() {
  const { profile, loading, updateField } = useProfile();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Personal");

  async function handleSave(key: string) {
    await updateField(key, editValue);
    setEditKey(null);
    setEditValue("");
    setSaved(key);
    setTimeout(() => setSaved(null), 1500);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-gray-500">
        <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        <span className="text-[11px]">Loading profile...</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {FIELD_GROUPS.map((group) => {
        const isExpanded = expandedGroup === group.title;
        return (
          <div key={group.title}>
            <button
              onClick={() => setExpandedGroup(isExpanded ? null : group.title)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors"
            >
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{group.title}</span>
              <svg
                className={`w-3 h-3 text-gray-600 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-0.5 pb-1">
                    {group.fields.map((field) => {
                      const value = profile[field.key] || "";
                      const isEditing = editKey === field.key;
                      const justSaved = saved === field.key;

                      return (
                        <motion.div
                          key={field.key}
                          initial={{ opacity: 0, y: 2 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.15 }}
                          className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                            isEditing ? "bg-accent/5" : "hover:bg-white/[0.02]"
                          }`}
                        >
                          <div className="w-4 h-4 flex items-center justify-center text-gray-600 group-hover:text-gray-400 transition-colors">
                            {field.icon}
                          </div>

                          <span className="text-[10px] text-gray-500 w-20 shrink-0 font-medium">
                            {field.label}
                            {field.required && <span className="text-rose-400 ml-0.5">*</span>}
                          </span>

                          {isEditing ? (
                            <div className="flex-1 flex gap-1">
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSave(field.key);
                                  if (e.key === "Escape") setEditKey(null);
                                }}
                                className="flex-1 bg-surface/60 border border-accent/20 rounded-lg px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 transition-all"
                                placeholder={field.label}
                              />
                              <button
                                onClick={() => handleSave(field.key)}
                                className="px-2 py-1 bg-accent/20 rounded-lg text-accent text-[10px] font-semibold hover:bg-accent/30 transition-colors"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <div
                              onClick={() => {
                                setEditKey(field.key);
                                setEditValue(value);
                              }}
                              className="flex-1 flex items-center gap-1 cursor-pointer group/edit"
                              title="Click to edit"
                            >
                              <AnimatePresence mode="wait">
                                {justSaved ? (
                                  <motion.span
                                    key="saved"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="text-[11px] text-emerald-400 flex items-center gap-1"
                                  >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Saved
                                  </motion.span>
                                ) : (
                                  <motion.span
                                    key="value"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className={`text-[11px] truncate transition-colors ${
                                      value ? "text-gray-300 group-hover/edit:text-accent" : "text-gray-600 italic"
                                    }`}
                                  >
                                    {value || "empty"}
                                  </motion.span>
                                )}
                              </AnimatePresence>
                              <svg className="w-2.5 h-2.5 text-gray-700 group-hover/edit:text-gray-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
