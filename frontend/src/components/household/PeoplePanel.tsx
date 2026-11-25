import React, { useCallback, useEffect, useState } from "react";
import { RotateCw, UserX, UserCheck, Trash2 } from "lucide-react";
import type { HouseholdMember, Me, Person, PersonRole } from "../../types";
import { api } from "../../services/api";

interface PeoplePanelProps {
  me: Me | null;
  members: HouseholdMember[];
  /** Changes when someone was added elsewhere (the Household form): reload. */
  refreshKey?: number;
  /** Reload the app's data after a change that affects names or roles. */
  onChanged: () => void;
}

export const ROLE_LABELS: Record<PersonRole, string> = {
  OWNER: "Owner",
  MEMBER: "Can edit",
  VIEWER: "View only",
};

export const ROLE_HINTS: Record<PersonRole, string> = {
  OWNER: "Edits everything and manages who has access",
  MEMBER: "Adds and edits accounts, transactions, budgets and goals",
  VIEWER: "Sees everything, changes nothing",
};

const STATUS_LABELS: Record<Person["status"], string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  DISABLED: "No access",
};

const inputClass =
  "h-9 px-3 rounded-lg border border-default bg-input text-sm text-main focus:outline-none focus:border-[var(--accent-primary)]";
const iconButton =
  "h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default";

const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : null;

/**
 * Who can sign in to this household. Everyone can say which household member
 * they are; owners change what people may do, resend invitations, pause and
 * remove them. People are added (and invited) with the Household form. With a
 * single passphrase only the "You are" link is shown.
 */
export const PeoplePanel: React.FC<PeoplePanelProps> = ({ me, members, onChanged, refreshKey = 0 }) => {
  const [people, setPeople] = useState<Person[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.people.list();
      setPeople(res.people);
      setCanManage(res.can_manage_people);
    } catch (err: any) {
      setError(err?.message || "Couldn’t load who has access");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "That didn’t work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const linkedTo = (memberId: string, exceptKey: string) =>
    people.find((p) => p.member_id === memberId && p.user_key !== exceptKey && p.status !== "DISABLED");

  const memberOptions = (exceptKey: string) =>
    members.map((m) => {
      const taken = linkedTo(m.id, exceptKey);
      return (
        <option key={m.id} value={m.id} disabled={!!taken}>
          {m.name}
          {taken ? ` (${taken.display_name || taken.email || "linked"})` : ""}
        </option>
      );
    });

  const visible = canManage ? people : people.filter((p) => p.status !== "DISABLED");

  return (
    <section aria-labelledby="people-heading" className="space-y-3">
      <div>
        <h3 id="people-heading" className="text-base font-medium text-main">
          Sign-ins
        </h3>
        <p className="text-xs text-muted mt-1">
          Link each sign-in to a member so new entries and “Mine” filters know who you are.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-negative-subtle text-xs text-negative">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="p-3 rounded-lg bg-surface-subtle text-xs text-sub">
          {notice}
        </div>
      )}

      {/* You */}
      <div className="p-3 rounded-lg border border-default bg-surface flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-main">You</div>
          <div className="text-xs text-muted truncate">
            {me?.email || "Signed in with the vault passphrase"}
            {me ? ` · ${ROLE_LABELS[me.role]}` : ""}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-sub">
          <span>You are</span>
          <select
            aria-label="Which household member you are"
            className={inputClass}
            value={me?.member_id ?? ""}
            disabled={busy === "me" || members.length === 0}
            onChange={(e) =>
              void run("me", () => api.people.updateMe({ member_id: e.target.value || null }))
            }
          >
            <option value="">{members.length === 0 ? "Add a member first" : "Not linked"}</option>
            {memberOptions(me?.user_key ?? "")}
          </select>
        </label>
      </div>

      {visible.filter((p) => !p.is_me).length > 0 && (
        <ul className="space-y-2" aria-label="People">
          {visible
            .filter((p) => !p.is_me)
            .map((p) => {
              const name = p.display_name || p.email || "Household member";
              const isBusy = busy === p.user_key;
              return (
                <li
                  key={p.user_key}
                  className={`p-3 rounded-lg border border-default bg-surface flex flex-col sm:flex-row sm:items-center gap-3 ${
                    p.status === "DISABLED" ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-main truncate">{name}</span>
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded ${
                          p.status === "ACTIVE" ? "bg-surface-subtle text-sub" : "bg-warning-subtle text-warning"
                        }`}
                      >
                        {STATUS_LABELS[p.status]}
                      </span>
                    </div>
                    <div className="text-xs text-muted truncate">
                      {p.display_name && p.email ? `${p.email} · ` : ""}
                      {p.status === "INVITED"
                        ? `Invited ${formatDate(p.created_at)}${p.invited_by_name ? ` by ${p.invited_by_name}` : ""}`
                        : p.last_sign_in_at
                          ? `Last signed in ${formatDate(p.last_sign_in_at)}`
                          : ROLE_HINTS[p.role]}
                    </div>
                  </div>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`What ${name} can do`}
                        className={inputClass}
                        value={p.role}
                        disabled={isBusy || p.status === "DISABLED"}
                        onChange={(e) =>
                          void run(p.user_key, () =>
                            api.people.update(p.user_key, { role: e.target.value as PersonRole })
                          )
                        }
                      >
                        {(Object.keys(ROLE_LABELS) as PersonRole[]).map((r) => (
                          <option key={r} value={r} title={ROLE_HINTS[r]}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Household member for ${name}`}
                        className={inputClass}
                        value={p.member_id ?? ""}
                        disabled={isBusy || p.status === "DISABLED"}
                        onChange={(e) =>
                          void run(p.user_key, () =>
                            api.people.update(p.user_key, { member_id: e.target.value || null })
                          )
                        }
                      >
                        <option value="">No member</option>
                        {memberOptions(p.user_key)}
                      </select>
                      {p.status === "INVITED" && (
                        <button
                          type="button"
                          className={iconButton}
                          disabled={isBusy}
                          title="Send the invitation again"
                          aria-label={`Send ${name}'s invitation again`}
                          onClick={() =>
                            void run(p.user_key, () => api.people.resend(p.user_key), `Invitation sent again to ${name}.`)
                          }
                        >
                          <RotateCw className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      )}
                      {p.status === "DISABLED" ? (
                        <button
                          type="button"
                          className={iconButton}
                          disabled={isBusy}
                          title="Give access back"
                          aria-label={`Give ${name} access again`}
                          onClick={() => void run(p.user_key, () => api.people.update(p.user_key, { status: "ACTIVE" }))}
                        >
                          <UserCheck className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={iconButton}
                          disabled={isBusy}
                          title="Pause access (signs them out everywhere)"
                          aria-label={`Pause ${name}'s access`}
                          onClick={() => void run(p.user_key, () => api.people.update(p.user_key, { status: "DISABLED" }))}
                        >
                          <UserX className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${iconButton} hover:text-negative`}
                        disabled={isBusy}
                        title="Remove their sign-in"
                        aria-label={`Remove ${name}`}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${name}? Their sign-in is deleted. What they added stays, with their name on it.`
                            )
                          ) {
                            void run(p.user_key, () => api.people.remove(p.user_key), `${name} no longer has access.`);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-sub">
                      {ROLE_LABELS[p.role]}
                      {p.member_name ? ` · ${p.member_name}` : ""}
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}

    </section>
  );
};
