"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addPartyRole, searchRoleTargets } from "@/lib/server/actions/parties";
import { PARTY_ROLE, opts } from "@/lib/labels";
import { ROLE_ENTITY } from "@/lib/labels-deals";
import { SearchSelect, PickItem } from "./PartyPicker";

/** 関連先つきの役割を追加（例: 物件Xの貸主、案件Yの購入希望者）。同じ顧客に複数の役割を持たせる */
export function RoleAddForm({ partyId }: { partyId: string }) {
  const router = useRouter();
  const rid = useRef(crypto.randomUUID());
  const [role, setRole] = useState("lessor");
  const [entity, setEntity] = useState("property");
  const [target, setTarget] = useState<PickItem | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  return (
    <div className="card card-pad space-y-3">
      <h3>役割を追加</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="label">役割</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {opts(PARTY_ROLE).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">関連先の種類</span>
          <select className="input" value={entity} onChange={(e) => { setEntity(e.target.value); setTarget(null); }}>
            {opts(ROLE_ENTITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">開始日（任意）</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="label">終了日（任意）</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div>
        <span className="label">関連先</span>
        {target ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
            <span className="font-medium">{target.label}</span>
            <span className="text-xs text-muted">{target.sub}</span>
            <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setTarget(null)}>選び直す</button>
          </div>
        ) : (
          <SearchSelect
            placeholder="名称・番号・住所で検索"
            search={async (q) => searchRoleTargets({ entity, q })}
            onPick={setTarget}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !target}
          onClick={async () => {
            setBusy(true);
            setErrs([]);
            setOk(false);
            try {
              const r = await addPartyRole({ partyId, role, entity, entityId: target?.id, from, to, _requestId: rid.current });
              if (r.ok) {
                rid.current = crypto.randomUUID();
                setTarget(null);
                setOk(true);
                router.refresh();
              } else setErrs(r.errors?.length ? r.errors : [r.error]);
            } catch {
              setErrs(["通信に失敗しました。再試行してください。"]);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : "役割を追加"}
        </button>
        {ok && <span className="text-sm text-ok" role="status">追加しました</span>}
        {errs.length > 0 && <span className="text-sm text-danger" role="alert">{errs.join(" / ")}</span>}
      </div>
    </div>
  );
}
