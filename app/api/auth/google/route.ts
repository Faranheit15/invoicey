import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import admin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";
import { syncUserWithMongo } from "@/lib/auth-user-sync";
import { signSessionToken } from "@/lib/server/session-token";

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    ensureFirebaseAdmin();

    const { idToken } = (await req.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json({ error: "ID token is required" }, { status: 400 });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (decodedToken.firebase?.sign_in_provider !== "google.com") {
      return NextResponse.json(
        { error: "Google sign-in token is required" },
        { status: 401 }
      );
    }

    const { user, uid, email } = await syncUserWithMongo({
      decodedToken,
      providerId: "google.com",
    });

    const sessionToken = await signSessionToken({ uid, email });

    return NextResponse.json({ sessionToken, user });
  } catch (error) {
    console.error("❌ Google Auth API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
