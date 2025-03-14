"use client";

import * as React from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
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

export default function AuthPage() {
  const router = useRouter();
  const userSessionManager = new UserSessionManager();

  useEffect(() => {
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
        router.push("/dashboard");
      } else {
        userSessionManager.clearLocal(); // Ensure session is cleared when user is signed out
      }
    });

    return () => unsubscribe(); // Cleanup listener on unmount
  }, []);

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

      if (data.sessionToken) {
        userSessionManager.sessionToken = data.sessionToken;
        userSessionManager.accessToken = data.accessToken || ""; // Handle empty accessToken
        userSessionManager.refreshToken = data.refreshToken || ""; // Handle empty refreshToken
        userSessionManager.user = data.user;
        router.push("/dashboard");
      } else {
        throw new Error("Invalid response from API");
      }
    } catch (error) {
      console.error("Error signing in with Google:", error);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="shadow-lg w-96">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={handleGoogleSignIn} className="w-full">
            <span className="mr-2 font-bold">G</span>Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
