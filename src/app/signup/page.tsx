"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { clientAuth } from "@/lib/client/firebase";
import { signupCompany, signupWithInvite } from "@/lib/server/onboarding";

function SignupForm() {
  const sp = useSearchParams();
  const invite = sp.get("mode") === "invite";
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        className="card card-pad w-full max-w-md space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const email = String(fd.get("email"));
          const password = String(fd.get("password"));
          if (password.length < 10) {
            setErr(["パスワードは10文字以上にしてください"]);
            return;
          }
          setBusy(true);
          setErr([]);
          try {
            const auth = clientAuth();
            let cred;
            try {
              cred = await createUserWithEmailAndPassword(auth, email, password);
            } catch (e) {
              // 前回の登録が途中で失敗した場合は既存の認証情報で続行する
              if ((e as { code?: string }).code === "auth/email-already-in-use") cred = await signInWithEmailAndPassword(auth, email, password);
              else throw e;
            }
            const idToken = await cred.user.getIdToken();
            const r = invite
              ? await signupWithInvite({ idToken, code: String(fd.get("code")), displayName: String(fd.get("displayName")) })
              : await signupCompany({
                  idToken,
                  companyName: String(fd.get("companyName")),
                  storeName: String(fd.get("storeName")),
                  displayName: String(fd.get("displayName")),
                });
            if (!r.ok) {
              setErr(r.errors?.length ? r.errors : [r.error]);
              return;
            }
            const s = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: await cred.user.getIdToken(true) }) });
            const j = await s.json();
            location.href = j.kind === "staff" ? "/home" : "/portal";
          } catch (e) {
            const code = (e as { code?: string }).code ?? "";
            setErr([
              code === "auth/weak-password"
                ? "パスワードが簡単すぎます"
                : code === "auth/invalid-credential" || code === "auth/wrong-password"
                  ? "このメールアドレスは登録済みです。パスワードを確認してください"
                  : code === "auth/invalid-email"
                    ? "メールアドレスの形式が正しくありません"
                    : "登録に失敗しました",
            ]);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-xl">{invite ? "招待コードで利用開始" : "会社の新規登録"}</h1>
        <p className="text-sm text-muted">
          {invite ? "管理者から受け取った招待コードを入力してください。" : "最初の利用者は会社管理者として登録されます。"}
        </p>
        {invite ? (
          <div>
            <label className="label" htmlFor="code">招待コード</label>
            <input id="code" name="code" required className="input font-mono" placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
          </div>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="companyName">会社名</label>
              <input id="companyName" name="companyName" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="storeName">最初の店舗名</label>
              <input id="storeName" name="storeName" className="input" placeholder="本店" />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="displayName">氏名</label>
          <input id="displayName" name="displayName" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="email">メールアドレス（ログインID）</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="password">パスワード（10文字以上）</label>
          <input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
        </div>
        {err.length > 0 && (
          <ul className="field-error list-disc pl-5" role="alert">
            {err.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "登録中…" : "登録する"}</button>
        <div className="flex justify-between text-sm">
          <Link className="text-primary hover:underline" href="/login">ログインへ戻る</Link>
          <Link className="text-primary hover:underline" href={invite ? "/signup" : "/signup?mode=invite"}>
            {invite ? "会社を新規登録" : "招待コードをお持ちの方"}
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
