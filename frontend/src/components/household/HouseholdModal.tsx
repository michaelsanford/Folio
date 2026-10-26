import React, { useState } from "react";
import { X, Plus, Trash2, Users, Edit2, Check, Shield } from "lucide-react";
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
      setError("Member name is required.");
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
      setError(err?.message || "Failed to save member.");
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
      setError(err?.message || "Failed to delete member.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-surface border border-default rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-subtle text-accent-subtle flex items-center justify-center">
              <Users className="w-5 h-5 text-accent-main" />
            </div>
            <div>
              <h2 className="text-base font-bold text-main">Household & Collaboration</h2>
              <p className="text-xs text-muted">
                Manage members to track CRA limits, account ownership, and spending attribution.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Canadian Legal Notice */}
        <div className="mx-5 mt-4 p-3 rounded-xl bg-accent-subtle/50 border border-accent-main/20 text-xs text-muted flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-accent-main shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-main">Canadian Registered Accounts Rule: </span>
            The CRA mandates that registered accounts (TFSA, RRSP, FHSA, RESP) are legally held by an individual person. Joint ownership applies to Chequing, Savings, and Mortgages.
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-negative-subtle border border-rose-500/30 text-xs text-negative">
            {error}
          </div>
        )}

        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {/* Member List */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">
              Household Members ({members.length})
            </h3>
            {members.length === 0 ? (
              <div className="p-6 text-center rounded-xl border border-dashed border-default text-xs text-muted">
                No household members defined yet. Add members below to start separating account ownership and tracking individual CRA room.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      editingMember?.id === m.id
                        ? "border-accent-main bg-accent-subtle/30"
                        : "border-default bg-surface-subtle hover:border-subtle"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-2xs"
                        style={{ backgroundColor: m.color || "#3B82F6" }}
                      >
                        {m.name.substring(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-main truncate">{m.name}</div>
                        <div className="text-[11px] text-muted truncate">
                          {m.role || "Member"} {m.notes ? `• ${m.notes}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleStartEdit(m)}
                        className="p-1 rounded-md text-muted hover:text-main hover:bg-surface transition-colors"
                        title="Edit member"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(m.id, m.name)}
                        className="p-1 rounded-md text-muted hover:text-negative hover:bg-surface transition-colors"
                        title="Delete member"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
              <h4 className="text-xs font-bold uppercase tracking-wider text-main">
                {editingMember ? `Edit Member: ${editingMember.name}` : "Add Household Member"}
              </h4>
              {editingMember && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="text-xs text-muted hover:text-main underline"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1">
                  Full Name / Display Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Michael, Sarah"
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main placeholder-muted focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1">
                  Role / Relationship
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                >
                  <option value="Self">Self</option>
                  <option value="Partner">Partner / Spouse</option>
                  <option value="Dependent">Dependent / Child</option>
                  <option value="Other">Other Household</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-muted mb-1.5">
                Badge Accent Color
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_MEMBER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform ${
                      color === c ? "ring-2 ring-offset-2 ring-accent-main scale-110" : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="w-3.5 h-3.5 text-white stroke-3" />}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-muted mb-1">
                Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Primary earner, Student, etc."
                className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main placeholder-muted focus:ring-1 focus:ring-accent-main focus:outline-hidden"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer transition-all"
              >
                {editingMember ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Member</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="p-4 border-t border-subtle bg-surface-subtle flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface border border-default hover:bg-surface-hover text-main text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
