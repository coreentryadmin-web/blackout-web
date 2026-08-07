"use client";

import { trackGa4Event } from "@/lib/analytics/ga4-client";
import { GA4_EVENTS } from "@/lib/analytics/ga4-events";
import { assignVariant } from "./bucket";

const ANON_ID_COOKIE = "bo_anon_id";
const ANON_ID_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1 year — long enough to outlast a single test

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (!isBrowser()) return;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSec}; path=/; SameSite=Lax`;
}

function randomId(): string {
  if (isBrowser() && "randomUUID" in window.crypto) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Stable anonymous ID (cookie-backed, 1yr). Not tied to auth — the same visitor keeps
 * the same bucket whether signed in or not, which matters for experiments that touch
 * pre-signup surfaces (pricing copy, CTAs) where most subjects are anonymous.
 */
export function getOrCreateAnonId(): string {
  if (!isBrowser()) return "server";
  const existing = readCookie(ANON_ID_COOKIE);
  if (existing) return existing;
  const id = randomId();
  writeCookie(ANON_ID_COOKIE, id, ANON_ID_MAX_AGE_SEC);
  return id;
}

// One exposure event per experiment per page load, not per render.
const exposedThisLoad = new Set<string>();

/**
 * Assign (and, once per page load, report) this visitor's variant for `experimentKey`.
 * Usage: const variant = getExperimentVariant("pricing_guarantee_placement", ["control", "inline"]);
 * Then branch render on `variant` and read `experiment_id`/`variant_id` in GA4 to score it.
 */
export function getExperimentVariant(
  experimentKey: string,
  variants: readonly string[],
  weights?: readonly number[]
): string {
  const variant = assignVariant(getOrCreateAnonId(), experimentKey, variants, weights);
  if (!exposedThisLoad.has(experimentKey)) {
    exposedThisLoad.add(experimentKey);
    trackGa4Event(GA4_EVENTS.experimentExposure, {
      experiment_id: experimentKey,
      variant_id: variant,
    });
  }
  return variant;
}
