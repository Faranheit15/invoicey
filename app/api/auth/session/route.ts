import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import admin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";
import { syncUserWithMongo } from "@/lib/auth-user-sync";

interface SessionPayload {
  idToken?: string;
  providerId?: string;
  refreshToken?: string;
}

const getJwtSecret = (): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("Missing JWT_SECRET");
  }
  return jwtSecret;
};

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    ensureFirebaseAdmin();

    const { idToken, providerId, refreshToken } = (await req.json()) as SessionPayload;

    if (!idToken) {
      return NextResponse.json({ error: "ID token is required" }, { status: 400 });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const { user, uid, email } = await syncUserWithMongo({
      decodedToken,
      idToken,
      providerId,
      refreshToken,
    });

    const sessionToken = jwt.sign({ uid, email }, getJwtSecret(), {
      expiresIn: "7d",
    });

    return NextResponse.json({
      sessionToken,
      user,
      accessToken: idToken,
      refreshToken: refreshToken || "",
    });
  } catch (error) {
    console.error("❌ Session Auth API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
