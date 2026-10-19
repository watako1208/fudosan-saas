"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { clientAuth } from "@/lib/client/firebase";

async function startSession(idToken: string): Promise<{ ok: boolean; kind?: string; error?: string }> {
  const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, kind: j.kind } : { ok: false, error: j.error ?? "ログインに失敗しました" };
}

function LoginForm() {
  const sp = useSearchParams();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reauth = sp.get("reauth") === "1";
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        className="card card-pad w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          setErr(null);
          try {
            const cred = await signInWithEmailAndPassword(clientAuth(), String(fd.get("email")), String(fd.get("password")));
            const r = await startSession(await cred.user.getIdToken());
            if (!r.ok) throw new Error(r.error);
            const next = sp.get("next");
            location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : r.kind === "staff" ? "/home" : "/portal";
          } catch (e) {
            const code = (e as { code?: string }).code ?? "";
            setErr(code.startsWith("auth/") ? "メールアドレスまたはパスワードが正しくありません" : (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-xl">{reauth ? "再認証" : "ログイン"}</h1>
        {reauth && <p className="rounded bg-warn-soft p-2 text-sm text-warn">重要な操作のため、もう一度パスワードを入力してください。</p>}
        <div>
          <label className="label" htmlFor="email">メールアドレス</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">パスワード</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        {err && <p className="field-error" role="alert">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "確認中…" : "ログイン"}</button>
        <div className="flex justify-between text-sm">
          <Link className="text-primary hover:underline" href="/signup?mode=invite">招待コードで利用開始</Link>
          <Link className="text-primary hover:underline" href="/signup">会社を新規登録</Link>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
