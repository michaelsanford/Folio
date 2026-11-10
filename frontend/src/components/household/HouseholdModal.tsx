import React, { useState } from "react";
import { X, Plus, Trash2, Edit2, Check, Shield } from "lucide-react";
import type { HouseholdMember } from "../../types";
import { api } from "../../services/api";

interface HouseholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: HouseholdMember[];
  onMembersModified: () => void;
}

const PRESET_MEMBER_COLORS = [
  "#3B82F6", // Blue
  "#10B981", // Emerald
  "#8B5CF6", // Purple
  "#F59E0B", // Amber
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#F97316", // Orange
  "#64748B", // Slate
];

export const HouseholdModal: React.FC<HouseholdModalProps> = ({
  isOpen,
  onClose,
  members,
  onMembersModified,
}) => {
  const [editingMember, setEditingMember] = useState<HouseholdMember | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("Partner");
  const [color, setColor] = useState(PRESET_MEMBER_COLORS[0]);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartEdit = (m: HouseholdMember) => {
    setEditingMember(m);
    setName(m.name);
    setRole(m.role || "Partner");
    setColor(m.color || PRESET_MEMBER_COLORS[0]);
    setNotes(m.notes || "");
    setError(null);
  };

  const handleResetForm = () => {
    setEditingMember(null);
    setName("");
    setRole("Partner");
    setColor(PRESET_MEMBER_COLORS[members.length % PRESET_MEMBER_COLORS.length]);
    setNotes("");
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Member name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (editingMember) {
        await api.household.updateMember(editingMember.id, {
          name: name.trim(),
          role: role.trim() || undefined,
          color,
          notes: notes.trim() || undefined,
        });
      } else {
        await api.household.createMember({
          name: name.trim(),
          role: role.trim() || undefined,
          color,
          notes: notes.trim() || undefined,
        });
      }
      handleResetForm();
      onMembersModified();
    } catch (err: any) {
      setError(err?.message || "Couldn’t save member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, memberName: string) => {
    if (!confirm(`Delete ${memberName}? Accounts and transactions assigned to them will be unassigned.`)) {
      return;
    }
    try {
      await api.household.deleteMember(id);
      if (editingMember?.id === id) {
        handleResetForm();
      }
      onMembersModified();
    } catch (err: any) {
      setError(err?.message || "Couldn’t delete member");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-surface border border-default rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-subtle">
          <div>
            <h2 className="text-base font-medium text-main">Household</h2>
            <p className="text-xs text-muted mt-1">
              Members for CRA limits, account ownership and spending attribution
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
            aria-label="Close household settings"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Canadian Legal Notice */}
        <div className="mx-5 mt-4 p-4 rounded-lg bg-surface-subtle text-xs text-sub flex items-start gap-3">
          <Shield className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} />
          <div>
            <span className="font-medium text-main">Registered accounts: </span>
            The CRA mandates that registered accounts (TFSA, RRSP, FHSA, RESP) are legally held by an individual person. Joint ownership applies to Chequing, Savings, and Mortgages.
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 p-3 rounded-lg bg-negative-subtle text-xs text-negative">
            {error}
          </div>
        )}

        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {/* Member List */}
          <div>
            <h3 className="text-base font-medium text-main mb-3">
              Members <span className="text-sm font-normal text-muted">{members.length}</span>
            </h3>
            {members.length === 0 ? (
              <div className="p-6 text-center rounded-xl border border-dashed border-default text-sm text-muted">
                No household members yet. Add members below to separate account ownership and track individual CRA room.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-lg border transition-colors flex items-center justify-between gap-3 ${
                      editingMember?.id === m.id
                        ? "border-accent-main bg-surface-subtle"
                        : "border-default bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-medium text-xs text-white shrink-0"
                        style={{ backgroundColor: m.color || "#3B82F6" }}
                      >
                        {m.name.substring(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-main truncate">{m.name}</div>
                        <div className="text-[11px] text-muted truncate">
                          {m.role || "Member"} {m.notes ? `• ${m.notes}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleStartEdit(m)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
                        title="Edit member"
                        aria-label={`Edit ${m.name}`}
                      >
                        <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDelete(m.id, m.name)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-negative bg-surface-hover transition-colors cursor-pointer"
                        title="Delete member"
                        aria-label={`Delete ${m.name}`}
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add / Edit Form */}
          <form onSubmit={handleSave} className="p-4 rounded-xl border border-default bg-surface-subtle space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-medium text-main">
                {editingMember ? `Edit ${editingMember.name}` : "Add member"}
              </h4>
              {editingMember && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="text-xs text-muted hover:text-main underline cursor-pointer"
                >
                  Cancel edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="household-member-name" className="block text-xs text-sub mb-1">
                  Name
                </label>
                <input
                  id="household-member-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Display name"
                  className="w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]"
                  required
                />
              </div>

              <div>
                <label htmlFor="household-member-role" className="block text-xs text-sub mb-1">
                  Relationship
                </label>
                <select
                  id="household-member-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main focus:outline-none focus:border-[var(--accent-primary)]"
                >
                  <option value="Self">Self</option>
                  <option value="Partner">Partner or spouse</option>
                  <option value="Dependent">Dependent or child</option>
                  <option value="Other">Other household member</option>
                </select>
              </div>
            </div>

            <div>
              <div className="text-xs text-sub mb-2">Colour</div>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_MEMBER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center cursor-pointer ${
                      color === c ? "ring-2 ring-offset-2 ring-offset-[var(--bg-surface-subtle)] ring-accent-main" : ""
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Colour ${c}`}
                    aria-pressed={color === c}
                  >
                    {color === c && <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="household-member-notes" className="block text-xs text-sub mb-1">
                Notes <span className="text-muted">optional</span>
              </label>
              <input
                id="household-member-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                className="w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="h-9 px-4 flex items-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium disabled:opacity-50 cursor-pointer transition-colors active:scale-[0.98]"
              >
                {editingMember ? (
                  <>
                    <Check className="w-4 h-4" strokeWidth={1.5} />
                    <span>Save changes</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" strokeWidth={1.5} />
                    <span>Add member</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="px-5 py-4 border-t border-subtle flex justify-end">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
