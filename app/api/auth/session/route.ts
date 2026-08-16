import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import admin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";
import { syncUserWithMongo } from "@/lib/auth-user-sync";
import { signSessionToken } from "@/lib/server/session-token";

interface SessionPayload {
  idToken?: string;
  providerId?: string;
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    ensureFirebaseAdmin();

    const { idToken, providerId } = (await req.json()) as SessionPayload;

    if (!idToken) {
      return NextResponse.json({ error: "ID token is required" }, { status: 400 });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Match the gate enforced on every data route: an unverified password
    // account must not be able to mint a session or mutate persistent user
    // state (User upsert, provider linking, invoice reassignment).
    if (
      decodedToken.firebase?.sign_in_provider === "password" &&
      !decodedToken.email_verified
    ) {
      return NextResponse.json(
        { error: "Please verify your email before signing in." },
        { status: 403 }
      );
    }

    const { user, uid, email } = await syncUserWithMongo({
      decodedToken,
      providerId,
    });

    const sessionToken = await signSessionToken({ uid, email });

    return NextResponse.json({ sessionToken, user });
  } catch (error) {
    console.error("❌ Session Auth API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
