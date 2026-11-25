import { describe, it, expect, afterEach } from "vitest";
import { attributionLine, canEdit, clearSession, getSession, isClosedDate, setSession } from "./session";
import type { Me } from "../types";

const me = (role: Me["role"]): Me => ({
  user_key: "cognito:a",
  role,
  can_edit: role !== "VIEWER",
  is_owner: role === "OWNER",
  can_manage_people: role === "OWNER",
});

const people = [
  { user_key: "cognito:a", name: "Michael" },
  { user_key: "cognito:b", name: "Sarah" },
];

describe("session", () => {
  afterEach(() => clearSession());

  it("treats an unknown session as an editor and a viewer as read-only", () => {
    expect(canEdit()).toBe(true);
    setSession(me("VIEWER"), people);
    expect(canEdit()).toBe(false);
  });

  it("names who added and who last edited a row", () => {
    setSession(me("MEMBER"), people);
    expect(attributionLine("cognito:a", "cognito:b")).toBe("Added by Michael · edited by Sarah");
    expect(attributionLine("cognito:a", "cognito:a")).toBe("Added by Michael");
    expect(attributionLine(null, "cognito:b")).toBe("Edited by Sarah");
    expect(attributionLine(null, null)).toBeNull();
  });

  it("says nothing when only one person uses the vault", () => {
    setSession(me("OWNER"), [people[0]]);
    expect(attributionLine("cognito:a", "cognito:a", getSession())).toBeNull();
  });

  it("knows which dates fall in a closed year", () => {
    setSession(me("OWNER"), people, 2024);
    expect(isClosedDate("2024-12-31T23:00:00")).toBe(true);
    expect(isClosedDate("2023-05-01")).toBe(true);
    expect(isClosedDate("2025-01-01")).toBe(false);
    setSession(me("OWNER"), people, null);
    expect(isClosedDate("2020-01-01")).toBe(false);
  });
});
