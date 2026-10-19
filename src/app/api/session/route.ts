import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/server/firebase-admin";
import { SESSION_COOKIE, SESSION_DAYS } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  const { idToken } = (await req.json().catch(() => ({}))) as { idToken?: string };
  if (!idToken) return NextResponse.json({ error: "認証情報がありません" }, { status: 400 });
  try {
    const decoded = await adminAuth().verifyIdToken(idToken, true);
    // 直近のログインで発行されたトークンのみ受け付ける
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json({ error: "もう一度ログインしてください" }, { status: 401 });
    }
    const user = await adminDb().collection("users").doc(decoded.uid).get();
    if (!user.exists || user.data()!.disabled) {
      return NextResponse.json({ error: "利用登録が完了していないか、利用停止中です" }, { status: 403 });
    }
    const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
    const res = NextResponse.json({ ok: true, kind: user.data()!.kind });
    res.cookies.set(SESSION_COOKIE, cookie, {
      maxAge: expiresIn / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "ログインに失敗しました" }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const d = await adminAuth().verifySessionCookie(token);
      await adminAuth().revokeRefreshTokens(d.sub);
    } catch {
      // 期限切れなどは無視
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
