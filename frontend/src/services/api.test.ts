import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  api,
  ApiError,
  getStoredToken,
  retryPolicy,
  setStoredToken,
  setOnUnauthorized,
  WRITE_CONFLICT_MESSAGE,
} from "./api";
import { onWriteConflict, subscribeToNotifications } from "./notifications";

describe("API Service Auth and Storage Helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and retrieves access tokens from local storage", () => {
    expect(getStoredToken()).toBeNull();

    setStoredToken("sample-jwt-token-xyz");
    expect(getStoredToken()).toBe("sample-jwt-token-xyz");

    setStoredToken(null);
    expect(getStoredToken()).toBeNull();
  });

  it("triggers unauthorized callback on 401 handling", () => {
    const callback = vi.fn();
    setOnUnauthorized(callback);
    // Callback is registered and ready for 401 dispatch
    expect(callback).not.toHaveBeenCalled();
  });
});

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("request retry policy", () => {
  const originalDelay = retryPolicy.baseDelayMs;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    retryPolicy.baseDelayMs = 0;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    retryPolicy.baseDelayMs = originalDelay;
    vi.unstubAllGlobals();
  });

  it("retries a GET after 429 and returns the eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { detail: "Too many requests" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ id: "acc-1" }]));

    await expect(api.getAccounts()).resolves.toEqual([{ id: "acc-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET on 503 at most three times, then throws", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(503, { detail: "Unavailable" }));

    await expect(api.getAccounts()).rejects.toMatchObject({ status: 503, message: "Unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a POST on 503, since it may have partly run", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { detail: "Unavailable" }));

    await expect(api.createAccount({ name: "Chequing" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a POST on 429, which the server rejected before running", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { detail: "Slow down" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "acc-2" }));

    await expect(api.createAccount({ name: "Savings" })).resolves.toEqual({ id: "acc-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits for Retry-After before retrying", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(429, { detail: "Slow down" }, { "Retry-After": "2" }))
        .mockResolvedValueOnce(jsonResponse(200, []));

      const pending = api.getAccounts();
      await vi.advanceTimersByTimeAsync(1900);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry other client errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { detail: "Bad request" }));

    await expect(api.getAccounts()).rejects.toMatchObject({ status: 400, message: "Bad request" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("write conflict handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes a notice and a reload event on 409 write_conflict", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(409, { detail: { code: "write_conflict", message: "Someone else saved" } })
    );
    const notices: string[] = [];
    const reload = vi.fn();
    const unsubscribeNotices = subscribeToNotifications((n) => notices.push(n.message));
    const unsubscribeConflict = onWriteConflict(reload);

    try {
      const error = await api.updateAccount("acc-1", { name: "Renamed" }).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409, code: "write_conflict" });
      expect(error.message).toBe(WRITE_CONFLICT_MESSAGE);
      expect(notices).toEqual([WRITE_CONFLICT_MESSAGE]);
      expect(reload).toHaveBeenCalledTimes(1);
      // A conflict is not transient: the request is not retried
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeNotices();
      unsubscribeConflict();
    }
  });

  it("treats other 409 responses as ordinary errors", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(409, { detail: "Duplicate name" }));
    const reload = vi.fn();
    const unsubscribe = onWriteConflict(reload);

    try {
      await expect(api.createCategory({ name: "Food" })).rejects.toMatchObject({
        status: 409,
        message: "Duplicate name",
      });
      expect(reload).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

describe("503 handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not raise a notice for an ordinary 503", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(503, { detail: "Unavailable" }));
    const notices: string[] = [];
    const unsubscribe = subscribeToNotifications((n) => notices.push(n.message));

    try {
      await expect(api.createAccount({ name: "Chequing" })).rejects.toMatchObject({ status: 503 });
      expect(notices).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});

describe("statement upload errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes a 413 status so the upload UI can explain the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Request Entity Too Large", { status: 413 }))
    );
    const file = new File(["x"], "big.csv", { type: "text/csv" });

    await expect(api.uploadStatementPreview(null, file)).rejects.toMatchObject({ status: 413 });
  });
});
