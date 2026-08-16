"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  shouldInterceptNavigation,
  UNSAVED_CHANGES_MESSAGE,
} from "@/lib/navigation-guard";

export interface UnsavedChangesOptions {
  /** Guard only while there is something to lose. */
  enabled: boolean;
  /**
   * Called when a navigation was blocked. Show a confirm dialog here; call the
   * supplied `proceed` to let it through, or do nothing to stay put.
   *
   * `href` is the destination for an intercepted link, and `null` for a back
   * gesture (where the destination is whatever the history stack says).
   */
  onBlocked: (blocked: { href: string | null; proceed: () => void }) => void;
  /**
   * Also intercept the browser/gesture Back. Costs one duplicate history entry
   * while the guard is armed — see the note on `armBackGuard` below.
   */
  guardBackGesture?: boolean;
}

/**
 * Warn before leaving a page with unsaved changes.
 *
 * Two half-measures, because that is all the platform offers:
 *
 * 1. `beforeunload` covers tab close, reload and a cross-origin navigation. The
 *    browser writes the wording; nothing can change it.
 * 2. In-app navigation is caught at the CLICK, in the capture phase, before
 *    `next/link` sees it. The App Router has no navigation-blocking API at all
 *    — no `beforePopState`, no `routeChangeStart` — so there is no better hook
 *    to use. `router.push` called directly from code is invisible to this;
 *    those call sites have to ask `confirmLeave()` themselves, which is why it
 *    is returned.
 * 3. The Back gesture is caught with a sentinel history entry. This is the one
 *    the audit actually names ("one back-swipe destroys everything"), and it is
 *    also the ugliest: the only way to intercept Back is to have somewhere to
 *    go back TO, so arming the guard pushes a duplicate of the current URL.
 *    While armed, the first Back lands on that duplicate and is bounced. If the
 *    user then saves, the duplicate stays on the stack and one Back press reads
 *    as a no-op before the second one leaves. That is the price; it is opt-out
 *    via `guardBackGesture: false`.
 */
export function useUnsavedChangesGuard({
  enabled,
  onBlocked,
  guardBackGesture = true,
}: UnsavedChangesOptions) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  /**
   * Set while a confirmed navigation is in flight, so the guard does not block
   * the very navigation the user just approved.
   */
  const bypassRef = useRef(false);

  /** Run `action` without the guard interfering. */
  const allowNavigation = useCallback((action: () => void) => {
    bypassRef.current = true;
    try {
      action();
    } finally {
      // Cleared on a macrotask rather than synchronously: `router.push` is
      // async, and clearing it in the same tick would re-arm the guard before
      // the navigation it was cleared for had started.
      setTimeout(() => {
        bypassRef.current = false;
      }, 0);
    }
  }, []);

  /**
   * For imperative call sites (`router.push("/dashboard")` in an onClick). Returns
   * false when the guard took over — the caller should do nothing and wait for
   * `onBlocked`.
   */
  const confirmLeave = useCallback(
    (proceed: () => void, href: string | null = null): boolean => {
      if (!enabledRef.current || bypassRef.current) {
        proceed();
        return true;
      }
      onBlockedRef.current({
        href,
        proceed: () => allowNavigation(proceed),
      });
      return false;
    },
    [allowNavigation]
  );

  // 1. Tab close, reload, cross-origin.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      if (bypassRef.current) {
        return;
      }
      event.preventDefault();
      // Both are needed: `returnValue` is what older WebKit and Firefox read,
      // `preventDefault` is what the current spec reads.
      event.returnValue = UNSAVED_CHANGES_MESSAGE;
      return UNSAVED_CHANGES_MESSAGE;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled]);

  // 2. In-app links.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = (event: MouseEvent) => {
      if (bypassRef.current) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor) {
        return;
      }
      const intercept = shouldInterceptNavigation(
        {
          defaultPrevented: event.defaultPrevented,
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
        {
          href: anchor.href,
          target: anchor.target,
          download: anchor.hasAttribute("download"),
          optedOut: anchor.hasAttribute("data-no-guard"),
        },
        { currentHref: window.location.href, origin: window.location.origin }
      );
      if (!intercept) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const href = anchor.href;
      onBlockedRef.current({
        href,
        proceed: () =>
          allowNavigation(() => {
            window.location.assign(href);
          }),
      });
    };
    // Capture phase: `next/link` handles click on the bubble, so a listener
    // there would run after the router had already started navigating.
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [enabled, allowNavigation]);

  // 3. Back gesture / Back button.
  useEffect(() => {
    if (!enabled || !guardBackGesture) {
      return;
    }
    window.history.pushState({ invoiceyGuard: true }, "", window.location.href);

    const handler = () => {
      if (bypassRef.current || !enabledRef.current) {
        return;
      }
      // Put the sentinel back so the NEXT Back press is catchable too, then ask.
      window.history.pushState({ invoiceyGuard: true }, "", window.location.href);
      onBlockedRef.current({
        href: null,
        proceed: () =>
          allowNavigation(() => {
            // Two entries to unwind: the sentinel we just re-pushed and the one
            // the user's press consumed.
            window.history.go(-2);
          }),
      });
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [enabled, guardBackGesture, allowNavigation]);

  return { confirmLeave, allowNavigation };
}
