"use client";

import * as React from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GridBackground } from "@/components/ui/aceternity/grid-background";
import { Spotlight } from "@/components/ui/aceternity/spotlight";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  RocketIcon,
} from "@radix-ui/react-icons";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import UserSessionManager from "@/modules/UserSessionManager";

interface UserData {
  uid: string;
  email: string;
  name: string;
  photoURL: string;
  providerId: string;
}

const getSafeRedirectPath = (value: string | null): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
};

export default function AuthPage() {
  const router = useRouter();
  const getRedirectPathFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    return getSafeRedirectPath(params.get("next"));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectPath = getSafeRedirectPath(params.get("next"));
    const userSessionManager = new UserSessionManager();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const idToken = await user.getIdToken();
        userSessionManager.sessionToken = idToken;
        userSessionManager.accessToken = idToken;

        const userData: UserData = {
          uid: user.uid,
          email: user.email || "",
          name: user.displayName || "",
          photoURL: user.photoURL || "",
          providerId: user.providerData[0]?.providerId || "unknown",
        };
        userSessionManager.user = userData;
        router.replace(redirectPath);
      } else {
        userSessionManager.clearLocal();
      }
    });

    return () => unsubscribe();
  }, [router]);

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();

      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        throw new Error(`API Error: ${res.statusText}`);
      }

      const data = await res.json();
      const userSessionManager = new UserSessionManager();

      if (data.sessionToken) {
        userSessionManager.sessionToken = data.sessionToken;
        userSessionManager.accessToken = data.accessToken || "";
        userSessionManager.refreshToken = data.refreshToken || "";
        userSessionManager.user = data.user;
        router.replace(getRedirectPathFromUrl());
      } else {
        throw new Error("Invalid response from API");
      }
    } catch (error) {
      console.error("Error signing in with Google:", error);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-14 text-slate-100 sm:px-6 lg:px-10">
      <Spotlight
        className="-top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 opacity-55"
        fill="#0EA5E9"
      />
      <Spotlight
        className="-right-24 bottom-0 h-[22rem] w-[22rem] opacity-40"
        fill="#F97316"
      />
      <GridBackground className="opacity-70" />

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1fr_440px]">
        <section className="space-y-6 pt-6 lg:pt-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
            <RocketIcon className="h-3.5 w-3.5" />
            Invoicey Access
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Sign in and get back to shipping invoices.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Use your Google account to securely access invoice drafts, payment
            history, and exports across devices.
          </p>
          <ul className="grid max-w-xl gap-3 text-sm text-slate-200 sm:grid-cols-2">
            <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <CheckCircledIcon className="mb-2 h-4 w-4 text-emerald-300" />
              Continue exactly where you left off
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <CheckCircledIcon className="mb-2 h-4 w-4 text-emerald-300" />
              Export-ready invoices in a few clicks
            </li>
          </ul>
        </section>

        <Card className="border-white/15 bg-slate-900/80 shadow-[0_28px_70px_rgba(2,6,23,0.5)] backdrop-blur">
          <CardHeader className="space-y-3 pb-3">
            <CardTitle className="text-2xl text-white">Welcome Back</CardTitle>
            <p className="text-sm text-slate-300">
              Secure sign in with Google to access your dashboard.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleGoogleSignIn}
              className="h-11 w-full bg-white text-slate-900 hover:bg-slate-100"
            >
              <span className="mr-2 text-lg font-semibold">G</span>
              Continue with Google
              <ArrowRightIcon className="ml-auto h-4 w-4" />
            </Button>
            <p className="text-xs leading-relaxed text-slate-400">
              By continuing, you agree to use Invoicey for lawful invoicing and
              account management purposes.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
