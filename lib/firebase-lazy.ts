import type { Auth, User } from "firebase/auth";

/**
 * The single async entry point to Firebase Auth.
 *
 * Firebase Auth is 155 KB decoded — the largest dependency in the client
 * bundle. It used to be imported at module scope by both the root layout's
 * header and `lib/api-client`, which put it in the eager bundle of *every*
 * route, including four static marketing pages that never authenticate.
 *
 * Making only the header lazy was worse, not better: the bundler emitted a
 * second async copy, so app routes downloaded Firebase twice. Both callers go
 * through this one module so there is exactly one async chunk, shared.
 *
 * `import()` caches, so every call after the first resolves from memory.
 */
export const loadFirebaseAuth = async (): Promise<{
  auth: Auth;
  onAuthStateChanged: (
    auth: Auth,
    next: (user: User | null) => void
  ) => () => void;
  signOut: (auth: Auth) => Promise<void>;
}> => {
  const [{ auth }, { onAuthStateChanged, signOut }] = await Promise.all([
    import("@/lib/firebase"),
    import("firebase/auth"),
  ]);
  return { auth, onAuthStateChanged, signOut };
};
