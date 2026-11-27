import React, { useEffect, useState } from "react";
import type { Me, Relationship } from "../../types";
import { api } from "../../services/api";
import { inputClass, modalOverlay, modalPanel, primaryButton, secondaryButton } from "../common/ui";

interface WelcomeDialogProps {
  me: Me;
  /** Called after the name is saved (reload the session and members). */
  onSaved: () => void;
  /** "Not now": ask again next session. */
  onSkip: () => void;
}

const RELATIONSHIPS: ReadonlyArray<readonly [Relationship, string]> = [
  ["Self", "Myself, the household owner"],
  ["Partner", "Partner or spouse"],
  ["Dependent", "Dependent or child"],
  ["Roommate", "Roommate or housemate"],
  ["Other", "Other household member"],
];



/** A first guess at a name: the profile name, else the part of the email before the @. */
const suggestedName = (me: Me): string => {
  if (me.display_name) return me.display_name;
  const local = (me.email ?? "").split("@")[0].split(/[._+-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
};

/**
 * Asked once, on first sign-in, of anyone the household doesn't know by name
 * yet: it names them everywhere ("Added by …", the "Mine" filter) and creates
 * their household member.
 */
export const WelcomeDialog: React.FC<WelcomeDialogProps> = ({ me, onSaved, onSkip }) => {
  const [name, setName] = useState(() => suggestedName(me));
  const [relationship, setRelationship] = useState<Relationship>(me.is_owner ? "Self" : "Other");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSkip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter the name you'd like to go by.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.people.welcome({ name: name.trim(), relationship });
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Couldn’t save your name. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className={modalOverlay}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onSubmit={handleSubmit}
        className={`${modalPanel} md:max-w-md space-y-5`}
      >
        <div>
          <h2 id="welcome-title" className="text-base font-medium text-main">
            Welcome to Folio — what should we call you?
          </h2>
          <p className="text-xs text-muted mt-1">
            Your name shows on what you add and change, and links you to your accounts.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-lg bg-negative-subtle text-xs text-negative">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="welcome-name" className="block text-xs text-sub mb-1">
            Your name
          </label>
          <input
            id="welcome-name"
            type="text"
            autoFocus
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="welcome-relationship" className="block text-xs text-sub mb-1">
            In this household you are
          </label>
          <select
            id="welcome-relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as Relationship)}
            className={inputClass}
          >
            {RELATIONSHIPS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className={secondaryButton}
          >
            Not now
          </button>
          <button
            type="submit"
            disabled={saving}
            className={primaryButton}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
};
