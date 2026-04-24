import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Automatic cleanup after each test
afterEach(() => {
  cleanup();
  // Clear localStorage safely (some jsdom versions don't support .clear())
  try {
    localStorage.clear();
  } catch {
    // Fallback: remove all keys manually
    const keys = Object.keys(localStorage);
    keys.forEach((key) => localStorage.removeItem(key));
  }
  vi.restoreAllMocks();
});

// Mock window.location
Object.defineProperty(window, "location", {
  writable: true,
  value: { href: "", assign: vi.fn(), replace: vi.fn(), reload: vi.fn() },
});
