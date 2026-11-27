import React, { useCallback, useEffect, useState } from "react";
import { X, Plus, Trash2, Edit2, Check, Shield, Mail, MoreHorizontal } from "lucide-react";
import type { HouseholdMember, Person, PersonRole, Relationship } from "../../types";
import { api } from "../../services/api";
import { useSession } from "../../hooks/useSession";
import { PeoplePanel, ROLE_HINTS, ROLE_LABELS } from "./PeoplePanel";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { ActionSheet, type SheetAction } from "../common/ActionSheet";
import { dangerIconButton, iconButton, inputClass, modalOverlay, primaryButton, secondaryButton } from "../common/ui";

interface HouseholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: HouseholdMember[];
  onMembersModified: () => void;
}

type Access = "invite" | "none";

/** Who usually signs in: a dependent or yourself is bookkeeping only by default. */
const defaultAccess = (relationship: string): Access =>
  relationship === "Dependent" || relationship === "Self" ? "none" : "invite";

const ACCESS_BADGE: Record<string, string> = {
  ACTIVE: "Signs in",
  INVITED: "Invited",
  DISABLED: "No access",
};

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
  const { me } = useSession();
  const canEdit = me?.can_edit ?? true;
  // Owners of a household where people sign in add people in one step.
  const canInvite = !!me?.can_manage_people;
  const isPhone = useIsPhone();
  const [sheetMember, setSheetMember] = useState<HouseholdMember | null>(null);
  const [access, setAccess] = useState<Access>(defaultAccess("Partner"));
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<PersonRole>("MEMBER");
  const [notice, setNotice] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleVersion, setPeopleVersion] = useState(0);
  // Inline "Invite" for a member who has no sign-in yet.
  const [invitingMember, setInvitingMember] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<PersonRole>("MEMBER");

  const loadPeople = useCallback(async () => {
    if (!me?.shared_household) return;
    try {
      setPeople((await api.people.list()).people);
    } catch {
      // The badges are a convenience; the Sign-ins list reports its own errors.
    }
  }, [me?.shared_household]);

  useEffect(() => {
    if (isOpen) void loadPeople();
  }, [isOpen, loadPeople, peopleVersion]);

  if (!isOpen) return null;

  const signInFor = (memberId: string) =>
    people.find((p) => p.member_id === memberId && p.status !== "DISABLED") ??
    people.find((p) => p.member_id === memberId);

  const peopleChanged = () => {
    setPeopleVersion((v) => v + 1);
    onMembersModified();
  };

  const handleRelationship = (value: string) => {
    setRole(value);
    if (!editingMember) {
      const next = defaultAccess(value);
      setAccess(next);
      setInviteRole(value === "Dependent" ? "VIEWER" : "MEMBER");
    }
  };

  const handleInviteMember = async (m: HouseholdMember) => {
    const address = memberEmail.trim().toLowerCase();
    if (!address) return;
    setError(null);
    setNotice(null);
    try {
      await api.people.invite({ email: address, role: memberRole, member_id: m.id, display_name: m.name });
      setNotice(`Invitation sent to ${address}. They’ll get an email with a temporary password.`);
      setInvitingMember(null);
      setMemberEmail("");
      peopleChanged();
    } catch (err: any) {
      setError(err?.message || "Couldn’t send the invitation");
    }
  };

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
    setAccess(defaultAccess("Partner"));
    setEmail("");
    setInviteRole("MEMBER");
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

    const inviting = !editingMember && canInvite && access === "invite";
    if (inviting && !email.trim()) {
      setError("Enter their email address to invite them, or choose no sign-in.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      if (!editingMember && canInvite) {
        const added = await api.people.add({
          name: name.trim(),
          relationship: (role || "Other") as Relationship,
          color,
          access: inviting ? "invite" : "none",
          email: inviting ? email.trim().toLowerCase() : null,
          role: inviting ? inviteRole : null,
        });
        if (notes.trim()) {
          await api.household.updateMember(added.member_id, { notes: notes.trim() });
        }
        setNotice(
          inviting
            ? `${added.member_name} added. Invitation sent to ${email.trim().toLowerCase()}.`
            : `${added.member_name} added.`
        );
        handleResetForm();
        peopleChanged();
        return;
      }
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
    <div className={modalOverlay}>
      <div className="relative w-full md:max-w-2xl bg-surface border border-default rounded-t-2xl md:rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[90vh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-subtle">
          <div>
            <h2 className="text-base font-medium text-main">Household</h2>
            <p className="text-xs text-muted mt-1">
              Members for CRA limits, account ownership and spending attribution, and who can sign in
            </p>
          </div>
          <button
            onClick={onClose}
            className={iconButton}
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
          <div role="alert" className="mx-5 mt-3 p-3 rounded-lg bg-negative-subtle text-xs text-negative">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mx-5 mt-3 p-3 rounded-lg bg-surface-subtle text-xs text-sub">
            {notice}
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
                    className={`p-3 rounded-lg border transition-colors flex flex-wrap items-center justify-between gap-3 ${
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
                        <div className="font-medium text-sm text-main break-words">{m.name}</div>
                        <div className="text-xs text-muted break-words">
                          {m.role || "Member"}
                          {me?.shared_household
                            ? ` · ${signInFor(m.id) ? ACCESS_BADGE[signInFor(m.id)!.status] : "No sign-in"}`
                            : ""}
                        </div>
                        {m.notes && <div className="text-xs text-muted break-words whitespace-pre-line">{m.notes}</div>}
                      </div>
                    </div>
                    {canEdit && isPhone && (
                      <button
                        type="button"
                        onClick={() => setSheetMember(m)}
                        aria-label={`${m.name}: actions`}
                        className={iconButton}
                      >
                        <MoreHorizontal className="w-5 h-5" strokeWidth={1.75} />
                      </button>
                    )}
                    {canEdit && !isPhone && (
                    <div className="flex items-center gap-1 shrink-0">
                      {canInvite && !signInFor(m.id) && (
                        <button
                          onClick={() => {
                            setInvitingMember(invitingMember === m.id ? null : m.id);
                            setMemberEmail("");
                            setMemberRole(m.role === "Dependent" ? "VIEWER" : "MEMBER");
                          }}
                          className={iconButton}
                          title="Invite to sign in"
                          aria-label={`Invite ${m.name} to sign in`}
                        >
                          <Mail className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      )}
                      <button
                        onClick={() => handleStartEdit(m)}
                        className={iconButton}
                        title="Edit member"
                        aria-label={`Edit ${m.name}`}
                      >
                        <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDelete(m.id, m.name)}
                        className={dangerIconButton}
                        title="Delete member"
                        aria-label={`Delete ${m.name}`}
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                    )}
                    {invitingMember === m.id && (
                      <form
                        aria-label={`Invite ${m.name}`}
                        className="basis-full w-full flex flex-col sm:flex-row gap-2 pt-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleInviteMember(m);
                        }}
                      >
                        <input
                          type="email"
                          required
                          aria-label={`${m.name}’s email address`}
                          placeholder="name@example.com"
                          value={memberEmail}
                          onChange={(e) => setMemberEmail(e.target.value)}
                          className={`flex-1 ${inputClass}`}
                        />
                        <select
                          aria-label="What they can do"
                          value={memberRole}
                          onChange={(e) => setMemberRole(e.target.value as PersonRole)}
                          className="h-11 md:h-9 px-3 rounded-lg border border-default bg-input text-base md:text-sm text-main"
                        >
                          {(Object.keys(ROLE_LABELS) as PersonRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className={primaryButton}
                        >
                          Send invitation
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add / Edit Form */}
          {canEdit && (
          <form onSubmit={handleSave} className="p-4 rounded-xl border border-default bg-surface-subtle space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-medium text-main">
                {editingMember ? `Edit ${editingMember.name}` : canInvite ? "Add someone" : "Add member"}
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
                  className={inputClass}
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
                  onChange={(e) => handleRelationship(e.target.value)}
                  className={inputClass}
                >
                  <option value="Self">Self</option>
                  <option value="Partner">Partner or spouse</option>
                  <option value="Dependent">Dependent or child</option>
                  <option value="Roommate">Roommate or housemate</option>
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
                    className={`size-10 md:size-6 rounded-full flex items-center justify-center cursor-pointer ${
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

            {!editingMember && canInvite && (
              <fieldset className="space-y-2">
                <legend className="text-xs text-sub mb-2">Access</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    ["invite", "Can sign in", "We email them an invitation with a temporary password."],
                    ["none", "No sign-in (bookkeeping only)", "For a child or anyone whose accounts you manage. You can invite them later."],
                  ] as const).map(([value, label, hint]) => (
                    <label
                      key={value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer bg-surface ${
                        access === value ? "border-[var(--accent-primary)]" : "border-default"
                      }`}
                    >
                      <input
                        type="radio"
                        name="household-access"
                        value={value}
                        checked={access === value}
                        onChange={() => setAccess(value)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm text-main">{label}</span>
                        <span className="block text-xs text-muted">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {access === "invite" && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                    <input
                      type="email"
                      aria-label="Email address"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                    />
                    <select
                      aria-label="What they can do"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as PersonRole)}
                      className="h-11 md:h-9 px-3 rounded-lg border border-default bg-input text-base md:text-sm text-main"
                    >
                      {(Object.keys(ROLE_LABELS) as PersonRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <p className="sm:col-span-2 text-xs text-muted">{ROLE_HINTS[inviteRole]}.</p>
                  </div>
                )}
              </fieldset>
            )}

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
                className={inputClass}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className={primaryButton}
              >
                {editingMember ? (
                  <>
                    <Check className="w-4 h-4" strokeWidth={1.5} />
                    <span>Save changes</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" strokeWidth={1.5} />
                    <span>{canInvite && access === "invite" ? "Add and invite" : "Add"}</span>
                  </>
                )}
              </button>
            </div>
          </form>
          )}

          <PeoplePanel me={me} members={members} onChanged={peopleChanged} refreshKey={peopleVersion} />
        </div>

        <div className="px-5 py-4 border-t border-subtle flex justify-end">
          <button
            onClick={onClose}
            className={secondaryButton}
          >
            Done
          </button>
        </div>
      </div>
      {sheetMember && (
        <ActionSheet
          open
          onClose={() => setSheetMember(null)}
          title={sheetMember.name}
          subtitle={sheetMember.role || "Member"}
          actions={[
            ...(canInvite && !signInFor(sheetMember.id)
              ? ([
                  {
                    label: "Invite to sign in",
                    icon: Mail,
                    onSelect: () => {
                      setInvitingMember(sheetMember.id);
                      setMemberEmail("");
                      setMemberRole(sheetMember.role === "Dependent" ? "VIEWER" : "MEMBER");
                    },
                  },
                ] satisfies SheetAction[])
              : []),
            { label: "Edit member", icon: Edit2, onSelect: () => handleStartEdit(sheetMember) },
            {
              label: "Delete member",
              icon: Trash2,
              destructive: true,
              onSelect: () => handleDelete(sheetMember.id, sheetMember.name),
            },
          ]}
        />
      )}
    </div>
  );
};
