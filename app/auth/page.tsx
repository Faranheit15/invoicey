"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  EnvelopeClosedIcon,
  ReloadIcon,
  RocketIcon,
} from "@radix-ui/react-icons";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  getProviderIdsFromFirebaseUser,
  requiresEmailVerification,
} from "@/lib/auth-client";
import { DEFAULT_USER_AVATAR, normalizeAvatarUrl } from "@/lib/user-profile";
import UserSessionManager from "@/modules/UserSessionManager";

interface SessionUser {
  uid?: string;
  email?: string;
  name?: string;
  avatar?: string;
  providerIds?: string[];
}

interface SessionResponse {
  sessionToken?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: SessionUser;
  error?: string;
}

type AuthTab = "email" | "google";
type EmailAuthMode = "signin" | "signup";
type VerificationSource = "signup" | "signin" | "protected-route";

const fallbackAvatar = DEFAULT_USER_AVATAR;

const getSafeRedirectPath = (value: string | null): string => {
  // Must be a same-origin absolute path. Reject protocol-relative ("//host") and
  // backslash tricks ("/\\host" or "\\host") — the URL parser normalizes "\" to
  // "/", so "/\\evil.com" would otherwise resolve to the host "evil.com".
  if (
    !value ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value[1] === "/"
  ) {
    return "/dashboard";
  }
  return value;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
};

const validatePassword = (password: string): string | null => {
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number.";
  }
  return null;
};

const getFirebaseErrorMessage = (error: unknown): string => {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  switch (code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "No account found with those credentials.";
    case "auth/wrong-password":
      return "Incorrect password. Please try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled before completion.";
    case "auth/popup-blocked":
      return "Your browser blocked the popup. Enable popups and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email using another sign-in method.";
    case "auth/email-already-in-use":
      return "This email is already in use. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 8 characters with upper/lowercase and a number.";
    case "auth/missing-password":
      return "Password is required.";
    case "auth/expired-action-code":
      return "That verification link has expired. Request a new one.";
    case "auth/invalid-action-code":
      return "That verification link is invalid. Request a new one.";
    case "auth/user-token-expired":
      return "Your session expired. Please sign in again and retry.";
    default:
      return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  }
};

const getRedirectPathFromUrl = () => {
  if (typeof window === "undefined") {
    return "/dashboard";
  }
  const params = new URLSearchParams(window.location.search);
  return getSafeRedirectPath(params.get("next"));
};

export default function AuthPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AuthTab>("email");
  const [emailMode, setEmailMode] = useState<EmailAuthMode>("signin");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationSource, setVerificationSource] =
    useState<VerificationSource | null>(null);

  const clearMessages = () => {
    setAuthError("");
    setAuthNotice("");
  };

  const persistSession = async (user: User) => {
    const providerIds = getProviderIdsFromFirebaseUser(user);
    const idToken = await user.getIdToken();

    let response: Response;
    try {
      response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
        }),
      });
    } catch {
      // Firebase already authenticated the user at this point; only our own
      // session call failed. Say that, instead of surfacing "Failed to fetch".
      throw new Error(
        "Signed in, but we couldn't reach the server to start your session. Check your connection and try again."
      );
    }

    const data = (await response.json().catch(() => ({}))) as SessionResponse;
    if (!response.ok || !data.sessionToken) {
      throw new Error(data.error || "Unable to start your session. Try again.");
    }

    const userSessionManager = new UserSessionManager();
    userSessionManager.sessionToken = data.sessionToken;
    userSessionManager.accessToken = data.accessToken || idToken;
    userSessionManager.refreshToken = data.refreshToken || "";

    userSessionManager.user = {
      uid: data.user?.uid || user.uid,
      email: data.user?.email || user.email || "",
      name:
        data.user?.name ||
        user.displayName ||
        user.email?.split("@")[0] ||
        "User",
      photoURL: normalizeAvatarUrl(data.user?.avatar || user.photoURL || fallbackAvatar),
      providerIds:
        Array.isArray(data.user?.providerIds) && data.user.providerIds.length > 0
          ? data.user.providerIds
          : providerIds,
    };
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") === "verify-email") {
      setActiveTab("email");
      setEmailMode("signin");
      setVerificationSource("protected-route");
      setAuthNotice("Please verify your email before accessing your invoices.");
    }

    const userSessionManager = new UserSessionManager();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        userSessionManager.clearLocal();
        return;
      }

      if (requiresEmailVerification(user)) {
        const userEmail = user.email ? normalizeEmail(user.email) : "";
        setActiveTab("email");
        setEmailMode("signin");
        setVerificationEmail(userEmail);
        setVerificationSource((prev) => prev || "signin");
        setAuthNotice("Verify your email to continue. We can resend the verification link.");
        return;
      }

      try {
        await persistSession(user);
        router.replace(getRedirectPathFromUrl());
      } catch (error) {
        setAuthError(
          error instanceof Error ? error.message : "Unable to start session."
        );
      }
    });

    return () => unsubscribe();
  }, [router]);

  const handleGoogleSignIn = async () => {
    clearMessages();
    setIsGoogleLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleEmailSignIn: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    clearMessages();

    const email = normalizeEmail(loginEmail);
    if (!isValidEmail(email)) {
      setAuthError("Please enter a valid email address.");
      return;
    }

    if (!loginPassword) {
      setAuthError("Password is required.");
      return;
    }

    try {
      setIsEmailSubmitting(true);
      const credential = await signInWithEmailAndPassword(auth, email, loginPassword);

      if (requiresEmailVerification(credential.user)) {
        setVerificationEmail(email);
        setVerificationSource("signin");
        setAuthNotice("Your email is not verified yet. Please verify to continue.");
      }
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handleEmailSignup: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    clearMessages();

    const email = normalizeEmail(signupEmail);
    if (!isValidEmail(email)) {
      setAuthError("Please enter a valid email address.");
      return;
    }

    const passwordError = validatePassword(signupPassword);
    if (passwordError) {
      setAuthError(passwordError);
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    try {
      setIsEmailSubmitting(true);
      const credential = await createUserWithEmailAndPassword(auth, email, signupPassword);
      await sendEmailVerification(credential.user);
      await persistSession(credential.user);

      setVerificationEmail(email);
      setVerificationSource("signup");
      setActiveTab("email");
      setEmailMode("signin");
      setLoginEmail(email);
      setLoginPassword("");
      setSignupPassword("");
      setSignupConfirmPassword("");
      setAuthNotice("Account created. Check your inbox to verify your email before signing in.");
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    clearMessages();

    const email = normalizeEmail(loginEmail);
    if (!isValidEmail(email)) {
      setAuthError("Enter your email in the sign-in form first.");
      return;
    }

    try {
      setIsResettingPassword(true);
      await sendPasswordResetEmail(auth, email);
      setAuthNotice("Password reset email sent. Check your inbox.");
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleResendVerification = async () => {
    clearMessages();

    const targetEmail = normalizeEmail(verificationEmail || loginEmail || signupEmail);
    if (!isValidEmail(targetEmail)) {
      setAuthError("Enter a valid email address before resending verification.");
      return;
    }

    try {
      setIsResendingVerification(true);

      let targetUser = auth.currentUser;
      const currentEmail = targetUser?.email ? normalizeEmail(targetUser.email) : "";

      if (!targetUser || currentEmail !== targetEmail) {
        if (!loginPassword) {
          setAuthError("Enter your password in the sign-in form to resend verification.");
          return;
        }

        const credential = await signInWithEmailAndPassword(
          auth,
          targetEmail,
          loginPassword
        );
        targetUser = credential.user;
      }

      if (targetUser.emailVerified) {
        setAuthNotice("Email is already verified. You can sign in now.");
        return;
      }

      await sendEmailVerification(targetUser);
      setVerificationEmail(targetEmail);
      setAuthNotice("Verification email sent. Check your inbox and spam folder.");
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    } finally {
      setIsResendingVerification(false);
    }
  };

  return (
    <PageShell tone="marketing" counterweight="right">

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1fr_460px]">
        <section className="space-y-6 pt-6 lg:pt-12">
          <EyebrowBadge icon={<RocketIcon className="h-3.5 w-3.5" />}>
            Invoicey Access
          </EyebrowBadge>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-slate-900 dark:text-white sm:text-5xl">
            Sign in and get back to shipping invoices.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            Choose Google or email/password to securely access your invoice
            workspace across devices.
          </p>
          <ul className="grid max-w-xl gap-3 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
            <li className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <CheckCircledIcon className="mb-2 h-4 w-4 text-emerald-300" />
              Continue exactly where you left off
            </li>
            <li className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <CheckCircledIcon className="mb-2 h-4 w-4 text-emerald-300" />
              Export-ready invoices in a few clicks
            </li>
          </ul>
        </section>

        <Card className="border-slate-200 bg-white/90 text-slate-900 shadow-[0_28px_70px_rgba(2,6,23,0.1)] backdrop-blur dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:shadow-[0_28px_70px_rgba(2,6,23,0.5)]">
          <CardHeader className="space-y-3 pb-3">
            <CardTitle className="text-2xl text-slate-900 dark:text-white">
              Welcome Back
            </CardTitle>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sign in with Google or email/password to access your dashboard.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {authError ? <AlertBanner>{authError}</AlertBanner> : null}

            {authNotice ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-200"
              >
                {authNotice}
              </div>
            ) : null}

            {verificationEmail ? (
              <div
                role="status"
                aria-live="polite"
                className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100"
              >
                <p>
                  {verificationSource === "signup"
                    ? `We sent a verification link to ${verificationEmail}. Verify your email before signing in.`
                    : `Your account (${verificationEmail}) is not verified yet. Please verify your email to continue.`}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResendVerification}
                  disabled={isResendingVerification}
                  className="h-9"
                >
                  {isResendingVerification ? (
                    <>
                      <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <EnvelopeClosedIcon className="mr-2 h-4 w-4" />
                      Resend Verification Email
                    </>
                  )}
                </Button>
              </div>
            ) : null}

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as AuthTab)}
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="email">Email</TabsTrigger>
                <TabsTrigger value="google">Google</TabsTrigger>
              </TabsList>

              <TabsContent value="email" className="space-y-4">
                <div className="grid grid-cols-2 rounded-md border border-slate-200 p-1 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setEmailMode("signin")}
                    className={`rounded-sm px-3 py-2 text-sm font-medium transition ${
                      emailMode === "signin"
                        ? "bg-slate-900 text-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailMode("signup")}
                    className={`rounded-sm px-3 py-2 text-sm font-medium transition ${
                      emailMode === "signup"
                        ? "bg-slate-900 text-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    Sign Up
                  </button>
                </div>

                {emailMode === "signin" ? (
                  <form className="space-y-3" onSubmit={handleEmailSignIn}>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="login-email"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Email
                      </label>
                      <Input
                        id="login-email"
                        aria-required="true"
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        value={loginEmail}
                        onChange={(event) => setLoginEmail(event.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="login-password"
                          className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                        >
                          Password
                        </label>
                        <button
                          type="button"
                          onClick={handleForgotPassword}
                          disabled={isResettingPassword}
                          className="text-xs font-medium text-sky-700 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-300 dark:hover:text-sky-200"
                        >
                          {isResettingPassword ? "Sending…" : "Forgot password?"}
                        </button>
                      </div>
                      <Input
                        id="login-password"
                        aria-required="true"
                        type="password"
                        placeholder="Enter password"
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value)}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={isEmailSubmitting}
                      className="h-11 w-full bg-slate-900 text-slate-100 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                      {isEmailSubmitting ? (
                        <>
                          <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        <>
                          Sign In with Email
                          <ArrowRightIcon className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                ) : (
                  <form className="space-y-3" onSubmit={handleEmailSignup}>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="signup-email"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Email
                      </label>
                      <Input
                        id="signup-email"
                        aria-required="true"
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        value={signupEmail}
                        onChange={(event) => setSignupEmail(event.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="signup-password"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Password
                      </label>
                      <Input
                        id="signup-password"
                        aria-required="true"
                        type="password"
                        placeholder="At least 8 chars, upper/lowercase, number"
                        autoComplete="new-password"
                        value={signupPassword}
                        onChange={(event) => setSignupPassword(event.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="signup-confirm-password"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Confirm Password
                      </label>
                      <Input
                        id="signup-confirm-password"
                        aria-required="true"
                        type="password"
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                        value={signupConfirmPassword}
                        onChange={(event) =>
                          setSignupConfirmPassword(event.target.value)
                        }
                      />
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Password must be at least 8 characters with uppercase,
                      lowercase, and a number.
                    </p>

                    <Button
                      type="submit"
                      disabled={isEmailSubmitting}
                      className="h-11 w-full bg-slate-900 text-slate-100 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                      {isEmailSubmitting ? (
                        <>
                          <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
                          Creating account...
                        </>
                      ) : (
                        <>
                          Create Account
                          <ArrowRightIcon className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </TabsContent>

              <TabsContent value="google" className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Sign in with your Google account for one-click access.
                </p>
                <Button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isGoogleLoading}
                  className="h-11 w-full bg-slate-900 text-slate-100 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  {isGoogleLoading ? (
                    <>
                      <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <span className="mr-2 text-lg font-semibold">G</span>
                      Continue with Google
                      <ArrowRightIcon className="ml-auto h-4 w-4" />
                    </>
                  )}
                </Button>
              </TabsContent>
            </Tabs>

            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              By continuing, you agree to use Invoicey for lawful invoicing and
              account management purposes.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
