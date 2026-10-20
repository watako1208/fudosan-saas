"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { issueInviteCode } from "@/lib/server/onboarding";
import { EntityPicker } from "@/components/support/Pickers";
import { ROLE_LABEL, EXTERNAL_LABEL, GRANTABLE_CAPS, StaffRole, ExternalKind, Cap } from "@/lib/permissions";
import { CAP_LABEL } from "@/lib/labels-support";

function CodeShown({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-md border border-primary/30 bg-primary-soft p-4" role="status">
      <p className="text-sm font-semibold">招待コード（この画面でのみ表示します。再表示はできません）</p>
      <p className="mt-2 font-mono text-2xl tracking-widest">{code}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          コピー
        </button>
        {copied && <span className="text-sm text-ok">コピーしました</span>}
        <span className="text-sm text-muted">有効期限: {new Date(expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
      </div>
      <p className="help mt-2">
        このコードは本人へ直接（対面・電話など）お渡しください。メール等への転記は避け、受渡し後はこの画面を閉じてください。
        本人は「招待コードで利用開始」画面でコードを入力して登録します。
      </p>
    </div>
  );
}

export function StaffInviteForm({ stores }: { stores: { value: string; label: string }[] }) {
  const router = useRouter();
  const [roles, setRoles] = useState<StaffRole[]>(["sales"]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">対象者のメモ（氏名など）<span className="ml-1 text-xs text-danger">必須</span></span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">有効期間</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14].map((d) => <option key={d} value={d}>{d}日間</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="label">権限</legend>
          {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => (
            <label key={r} className="flex min-h-8 items-center gap-2 text-sm">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles(toggle(roles, r))} /> {ROLE_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div>
          <fieldset>
            <legend className="label">追加付与する権限</legend>
            {GRANTABLE_CAPS.map((c) => (
              <label key={c} className="flex min-h-8 items-center gap-2 text-sm">
                <input type="checkbox" checked={caps.includes(c)} onChange={() => setCaps(toggle(caps, c))} /> {CAP_LABEL[c] ?? c}
              </label>
            ))}
          </fieldset>
          <fieldset className="mt-3">
            <legend className="label">所属店舗</legend>
            {stores.map((s) => (
              <label key={s.value} className="flex min-h-8 items-center gap-2 text-sm">
                <input type="checkbox" checked={storeIds.includes(s.value)} onChange={() => setStoreIds(toggle(storeIds, s.value))} /> {s.label}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
      <button
        type="button"
        className="btn btn-primary mt-3"
        disabled={busy}
        onClick={async () => {
          if (!label.trim()) return setErr("対象者のメモを入力してください");
          setBusy(true);
          setErr(null);
          const r = await issueInviteCode({ kind: "staff", roles, extraCaps: caps, storeIds, label, validDays: days });
          setBusy(false);
          if (!r.ok) {
            setErr(r.errors?.join(" / ") ?? r.error);
            if (r.code === "reauth_required") router.push(`/login?reauth=1&next=${encodeURIComponent("/settings?tab=users")}`);
            return;
          }
          setIssued(r.data);
          setLabel("");
          router.refresh();
        }}
      >
        招待コードを発行
      </button>
      {issued && <CodeShown {...issued} />}
    </div>
  );
}

export function ExternalInviteForm() {
  const router = useRouter();
  const [kind, setKind] = useState<ExternalKind>("tenant");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [partyKey, setPartyKey] = useState(0);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const partyId = String(new FormData(e.currentTarget).get("partyId") ?? "");
        if (!partyId) return setErr("紐づける顧客・関係者を選択してください");
        setBusy(true);
        setErr(null);
        const r = await issueInviteCode({ kind, partyId, label: label || EXTERNAL_LABEL[kind], validDays: 14 });
        setBusy(false);
        if (!r.ok) return setErr(r.errors?.join(" / ") ?? r.error);
        setIssued(r.data);
        setLabel("");
        setPartyKey((k) => k + 1);
        router.refresh();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="label">利用者の種別</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ExternalKind)}>
            {(Object.keys(EXTERNAL_LABEL) as ExternalKind[]).map((k) => <option key={k} value={k}>{EXTERNAL_LABEL[k]}</option>)}
          </select>
        </label>
        <EntityPicker key={partyKey} kind={kind === "vendor" ? "vendor" : "party"} name="partyId" label="紐づける顧客・関係者" required />
        <label className="block">
          <span className="label">メモ</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <p className="help mt-2">外部利用者は、紐づけた関係者に公開された情報だけを閲覧できます（有効期間14日）。</p>
      {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
      <button type="submit" className="btn btn-primary mt-3" disabled={busy}>招待コードを発行</button>
      {issued && <CodeShown {...issued} />}
    </form>
  );
}
