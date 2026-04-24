"use client";

import { api } from "./api";

export interface User {
  email: string;
  name: string;
  organizationName: string;
  tenantId: string;
  role?: string;
}

// --- Tenant-scoped localStorage helpers ---

function scopedKey(key: string, tenantId?: string): string {
  if (tenantId) return `wf0_${tenantId}_${key}`;
  // Fallback to global key when tenantId not yet known (pre-login)
  return `wf0_${key}`;
}

function getCurrentTenantId(): string | null {
  if (typeof window === "undefined") return null;
  // Try to get tenantId from the stored user object (global key first, then scan)
  const raw = localStorage.getItem("wf0_user");
  if (raw) {
    try {
      return JSON.parse(raw).tenantId || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const tenantId = getCurrentTenantId();
  // Try tenant-scoped key first, fall back to global
  if (tenantId) {
    return localStorage.getItem(scopedKey("token", tenantId)) || localStorage.getItem("wf0_token");
  }
  return localStorage.getItem("wf0_token");
}

export function setToken(token: string, tenantId?: string): void {
  if (tenantId) {
    localStorage.setItem(scopedKey("token", tenantId), token);
  }
  // Always set global key for backward compat with api.ts
  localStorage.setItem("wf0_token", token);
}

export function clearToken(): void {
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    localStorage.removeItem(scopedKey("token", tenantId));
    localStorage.removeItem(scopedKey("user", tenantId));
    localStorage.removeItem(scopedKey("onboarding_complete", tenantId));
    localStorage.removeItem(scopedKey("checklist_dismissed", tenantId));
  }
  // Always clear global keys
  localStorage.removeItem("wf0_token");
  localStorage.removeItem("wf0_user");
  localStorage.removeItem("wf0_onboarding_complete");
  localStorage.removeItem("wf0_checklist_dismissed");
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("wf0_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  localStorage.setItem("wf0_user", JSON.stringify(user));
  // Also store tenant-scoped
  if (user.tenantId) {
    localStorage.setItem(scopedKey("user", user.tenantId), JSON.stringify(user));
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function isOnboardingComplete(): boolean {
  if (typeof window === "undefined") return false;
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    return localStorage.getItem(scopedKey("onboarding_complete", tenantId)) === "true"
      || localStorage.getItem("wf0_onboarding_complete") === "true";
  }
  return localStorage.getItem("wf0_onboarding_complete") === "true";
}

export function setOnboardingComplete(): void {
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    localStorage.setItem(scopedKey("onboarding_complete", tenantId), "true");
  }
  localStorage.setItem("wf0_onboarding_complete", "true");
}

export function isChecklistDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    return localStorage.getItem(scopedKey("checklist_dismissed", tenantId)) === "true"
      || localStorage.getItem("wf0_checklist_dismissed") === "true";
  }
  return localStorage.getItem("wf0_checklist_dismissed") === "true";
}

export function setChecklistDismissed(): void {
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    localStorage.setItem(scopedKey("checklist_dismissed", tenantId), "true");
  }
  localStorage.setItem("wf0_checklist_dismissed", "true");
}

export async function login(email: string, password: string): Promise<User> {
  const res = await api.login(email, password);
  if (res.data) {
    setToken(res.data.token, res.data.user.tenantId);
    setUser(res.data.user);
    return res.data.user;
  }
  throw new Error("Login failed. Please check your credentials.");
}

export async function signup(data: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}): Promise<User> {
  const res = await api.signup(data);
  if (res.data) {
    setToken(res.data.token, res.data.user.tenantId);
    setUser(res.data.user);
    return res.data.user;
  }
  throw new Error("Signup failed");
}

export function logout(): void {
  clearToken();
  window.location.href = "/login";
}
