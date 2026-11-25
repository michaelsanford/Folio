import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { PeoplePanel } from "./PeoplePanel";
import { api, ApiError } from "../../services/api";
import type { HouseholdMember, Me, Person } from "../../types";

const owner: Me = {
  user_key: "cognito:me",
  email: "me@example.com",
  role: "OWNER",
  member_id: null,
  can_edit: true,
  is_owner: true,
  can_manage_people: true,
};

const member = (id: string, name: string): HouseholdMember => ({
  id,
  name,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const person = (overrides: Partial<Person>): Person => ({
  user_key: "cognito:me",
  email: "me@example.com",
  role: "OWNER",
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00Z",
  is_me: true,
  ...overrides,
});

const sarah = person({
  user_key: "cognito:sarah",
  email: "sarah@example.com",
  role: "MEMBER",
  member_id: "m2",
  member_name: "Sarah",
  is_me: false,
});

describe("PeoplePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api.people, "list").mockResolvedValue({ people: [person({}), sarah], can_manage_people: true });
  });

  const renderPanel = (me: Me = owner, onChanged = vi.fn()) =>
    render(
      <PeoplePanel me={me} members={[member("m1", "Michael"), member("m2", "Sarah")]} onChanged={onChanged} />
    );

  it("invites someone with a role and a member", async () => {
    const invite = vi.spyOn(api.people, "invite").mockResolvedValue(sarah);
    const onChanged = vi.fn();
    renderPanel(owner, onChanged);
    const form = await screen.findByRole("form", { name: "Invite someone" });
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: "Pat@Example.com" } });
    fireEvent.change(within(form).getByLabelText("What they can do"), { target: { value: "VIEWER" } });
    fireEvent.change(within(form).getByLabelText("Household member they are"), { target: { value: "m1" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({ email: "pat@example.com", role: "VIEWER", member_id: "m1" })
    );
    expect(await screen.findByText(/Invitation sent to pat@example.com/)).toBeDefined();
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not offer a member someone else already is", async () => {
    renderPanel();
    const you = await screen.findByLabelText("Which household member you are");
    const sarahOption = within(you).getByRole("option", { name: /Sarah/ }) as HTMLOptionElement;
    expect(sarahOption.disabled).toBe(true);
  });

  it("shows why a change was refused", async () => {
    vi.spyOn(api.people, "update").mockRejectedValue(
      new ApiError("A household needs at least one owner. Make someone else an owner first.", 409, "last_owner")
    );
    renderPanel();
    const role = await screen.findByLabelText("What sarah@example.com can do");
    fireEvent.change(role, { target: { value: "VIEWER" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least one owner/);
  });

  it("lists people without controls for someone who is not an owner", async () => {
    vi.spyOn(api.people, "list").mockResolvedValue({ people: [person({ role: "MEMBER" }), sarah], can_manage_people: false });
    renderPanel({ ...owner, role: "MEMBER", is_owner: false, can_manage_people: false });
    expect(await screen.findByText("sarah@example.com")).toBeDefined();
    expect(screen.queryByRole("form", { name: "Invite someone" })).toBeNull();
    expect(screen.queryByLabelText(/can do$/)).toBeNull();
    // Anyone can still say who they are.
    expect(screen.getByLabelText("Which household member you are")).toBeDefined();
  });
});
