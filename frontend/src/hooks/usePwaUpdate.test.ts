import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { activateUpdate } from "./usePwaUpdate";

/** A waiting worker that records messages and lets the test drive its state. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = "installed";
  postMessage = vi.fn();
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

const registrationWith = (waiting: FakeWorker | null) =>
  ({ waiting }) as unknown as ServiceWorkerRegistration;

describe("activateUpdate", () => {
  let container: EventTarget;
  const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

  beforeEach(() => {
    vi.useFakeTimers();
    container = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (original) Object.defineProperty(navigator, "serviceWorker", original);
    else delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  });

  it("reloads at once when there is no registration", () => {
    const reload = vi.fn();
    activateUpdate(undefined, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads at once when nothing is waiting any more (another tab switched already)", () => {
    const reload = vi.fn();
    activateUpdate(registrationWith(null), reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("asks the waiting worker to take over and reloads once the page's controller changes", () => {
    const worker = new FakeWorker();
    const reload = vi.fn();
    activateUpdate(registrationWith(worker), reload);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();

    container.dispatchEvent(new Event("controllerchange"));
    worker.become("activated");
    vi.advanceTimersByTime(10_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads a page the worker never controlled when the new worker activates", () => {
    const worker = new FakeWorker();
    const reload = vi.fn();
    activateUpdate(registrationWith(worker), reload);
    worker.become("activating");
    expect(reload).not.toHaveBeenCalled();
    worker.become("activated");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads anyway after the fallback if the worker never answers, and only once", () => {
    const worker = new FakeWorker();
    const reload = vi.fn();
    activateUpdate(registrationWith(worker), reload, 4000);
    vi.advanceTimersByTime(3999);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
