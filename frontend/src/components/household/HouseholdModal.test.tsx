import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { HouseholdModal } from "./HouseholdModal";
import { WelcomeDialog } from "./WelcomeDialog";
import { api } from "../../services/api";
import { clearSession, setSession } from "../../utils/session";
import type { HouseholdMember, Me } from "../../types";

const owner: Me = {
  user_key: "cognito:me",
  email: "michael.sanford@example.com",
  role: "OWNER",
  member_id: null,
  can_edit: true,
  is_owner: true,
  can_manage_people: true,
  shared_household: true,
};

const kid: HouseholdMember = {
  id: "m-kid",
  name: "Emma",
  role: "Dependent",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const renderModal = (members: HouseholdMember[] = [], onMembersModified = vi.fn()) =>
  render(<HouseholdModal isOpen onClose={vi.fn()} members={members} onMembersModified={onMembersModified} />);

describe("HouseholdModal: adding someone", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setSession(owner, []);
    vi.spyOn(api.people, "list").mockResolvedValue({ people: [], can_manage_people: true });
  });
  afterEach(() => clearSession());

  it("adds and invites a partner in one request", async () => {
    const add = vi
      .spyOn(api.people, "add")
      .mockResolvedValue({ member_id: "m-sam", member_name: "Sam", person: null });
    const onModified = vi.fn();
    renderModal([], onModified);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Relationship"), { target: { value: "Partner" } });
    expect((screen.getByLabelText(/Can sign in/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "Sam@Example.com" } });
    fireEvent.change(screen.getAllByLabelText("What they can do")[0], { target: { value: "VIEWER" } });
    fireEvent.click(screen.getByRole("button", { name: "Add and invite" }));

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sam",
        relationship: "Partner",
        access: "invite",
        email: "sam@example.com",
        role: "VIEWER",
      })
    );
    expect(await screen.findByText(/Sam added. Invitation sent to sam@example.com/)).toBeDefined();
    expect(onModified).toHaveBeenCalled();
  });

  it("makes a dependent bookkeeping only by default", async () => {
    const add = vi
      .spyOn(api.people, "add")
      .mockResolvedValue({ member_id: "m-kid", member_name: "Emma", person: null });
    renderModal();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Emma" } });
    fireEvent.change(screen.getByLabelText("Relationship"), { target: { value: "Dependent" } });
    expect((screen.getByLabelText(/No sign-in/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ name: "Emma", access: "none", email: null }))
    );
  });

  it("offers to invite a member who has no sign-in yet", async () => {
    const invite = vi.spyOn(api.people, "invite").mockResolvedValue({} as any);
    renderModal([kid]);

    expect(await screen.findByText(/Dependent · No sign-in/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Invite Emma to sign in" }));
    const form = screen.getByRole("form", { name: "Invite Emma" });
    fireEvent.change(within(form).getByLabelText("Emma’s email address"), { target: { value: "emma@example.com" } });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({
        email: "emma@example.com",
        role: "VIEWER",
        member_id: "m-kid",
        display_name: "Emma",
      })
    );
  });

  it("adds members without an access choice when nobody else signs in", () => {
    setSession({ ...owner, can_manage_people: false, shared_household: false }, []);
    renderModal();
    expect(screen.queryByText(/Can sign in/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Add member" })).toBeDefined();
  });
});

describe("WelcomeDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("suggests a name from the email and saves it", async () => {
    const welcome = vi.spyOn(api.people, "welcome").mockResolvedValue({ ...owner, needs_welcome: false });
    const onSaved = vi.fn();
    render(<WelcomeDialog me={{ ...owner, needs_welcome: true }} onSaved={onSaved} onSkip={vi.fn()} />);

    const name = screen.getByLabelText("Your name") as HTMLInputElement;
    expect(name.value).toBe("Michael");
    fireEvent.change(name, { target: { value: "Michael S." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(welcome).toHaveBeenCalledWith({ name: "Michael S.", relationship: "Self" }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("can be skipped", () => {
    const onSkip = vi.fn();
    render(<WelcomeDialog me={{ ...owner, needs_welcome: true }} onSaved={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSkip).toHaveBeenCalled();
  });
});
