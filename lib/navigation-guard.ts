/**
 * Should this click be intercepted by the unsaved-changes guard?
 *
 * Split out of the hook and kept pure because it is the part with all the edge
 * cases and none of the DOM lifecycle. Next's App Router exposes no navigation
 * blocking API — `useRouter` has no `beforePopState`, and `next/navigation` has
 * no equivalent of the pages router's `routeChangeStart` — so the only way to
 * catch an in-app navigation is to catch the click that starts it, before React
 * or the Link component sees it. That makes the decision "is this click a
 * navigation we own?" load-bearing, and worth testing on its own.
 */

/** The properties of a click we care about. No DOM types, so it is testable. */
export interface NavigationClick {
  /** `event.defaultPrevented` — someone already handled it. */
  defaultPrevented?: boolean;
  /** `event.button`: 0 is the primary button. */
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface NavigationTarget {
  /** The anchor's resolved `href`, absolute. */
  href: string;
  /** The anchor's `target` attribute. */
  target?: string | null;
  /** Whether the anchor carries `download`. */
  download?: boolean;
  /** Whether the anchor opted out with `data-no-guard`. */
  optedOut?: boolean;
}

export interface NavigationContext {
  /** The current page's absolute URL. */
  currentHref: string;
  origin: string;
}

/**
 * `true` when the click would navigate this tab away from the current page and
 * the guard should take it over.
 *
 * Everything below is a case where NOT intercepting is the right answer:
 *
 * - a modified click or a middle click opens a new tab — the editor stays put,
 *   so there is nothing to warn about, and stealing it would be infuriating;
 * - `target="_blank"` and `download` likewise leave this document alone;
 * - a cross-origin link is somebody else's page and `beforeunload` already
 *   covers it, with the browser's own wording;
 * - a bare `#hash` or a link to the URL we are already on is not a navigation;
 * - `data-no-guard` is the explicit escape hatch for a control that has already
 *   asked the user (the editor's own "discard" path).
 */
export const shouldInterceptNavigation = (
  click: NavigationClick,
  target: NavigationTarget | null,
  context: NavigationContext
): boolean => {
  if (!target || target.optedOut || target.download) {
    return false;
  }
  if (click.defaultPrevented) {
    return false;
  }
  if (click.button !== undefined && click.button !== 0) {
    return false;
  }
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) {
    return false;
  }
  const anchorTarget = (target.target || "").toLowerCase();
  if (anchorTarget && anchorTarget !== "_self") {
    return false;
  }

  let destination: URL;
  let current: URL;
  try {
    destination = new URL(target.href, context.currentHref);
    current = new URL(context.currentHref);
  } catch {
    return false;
  }

  if (destination.origin !== context.origin) {
    return false;
  }
  // Same document, different fragment: the page is not going anywhere.
  if (
    destination.pathname === current.pathname &&
    destination.search === current.search
  ) {
    return false;
  }

  return true;
};

/**
 * The `beforeunload` prompt is not customisable in any current browser — every
 * one of them shows its own wording and ignores the string. This exists so the
 * in-app confirmation dialog, which CAN say something useful, has one place to
 * say it from.
 */
export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes to this invoice. Leave without saving?";
