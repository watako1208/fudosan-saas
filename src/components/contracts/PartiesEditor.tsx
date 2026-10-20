"use client";
import { useState } from "react";
import Link from "next/link";
import { useFormCtx } from "@/components/EditForm";
import { searchParties } from "@/lib/server/actions/contracts";
import { CONTRACT_PARTY_ROLE } from "@/lib/labels-contracts";
import { lbl } from "@/lib/labels";
import { SearchPicker } from "./SearchPicker";
import type { ContractPartySnapshot } from "@/lib/types";

interface Row {
  partyId: string;
  role: string;
  share: string | null;
  name: string;
  sub: string;
}

/** 当事者の編集。顧客台帳から検索して追加し、役割を選ぶ。氏名・住所などは保存時点の内容を契約へ固定する */
export function PartiesEditor({ roles, name = "parties" }: { roles: readonly string[]; name?: string }) {
  const { initial, errors, markDirty } = useFormCtx();
  const [rows, setRows] = useState<Row[]>(() =>
    ((initial[name] as ContractPartySnapshot[] | undefined) ?? []).map((p) => ({
      partyId: p.partyId,
      role: p.role,
      share: p.share ?? null,
      name: p.name,
      sub: [p.kana, p.address].filter(Boolean).join(" / "),
    })),
  );
  const [addRole, setAddRole] = useState<string>(roles[0]);
  const update = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    markDirty();
  };
  const showShare = roles.includes("lessor") || roles.includes("seller");

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <input type="hidden" name={name} value={JSON.stringify(rows.map(({ partyId, role, share }) => ({ partyId, role, share })))} />
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">当事者が登録されていません。下の検索から追加してください。</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.partyId}-${i}`} className="grid grid-cols-1 gap-3 rounded-md border border-line p-3 sm:grid-cols-[1.6fr_1fr_1fr_auto] sm:items-end">
              <div className="min-w-0">
                <span className="label">氏名・名称</span>
                <Link href={`/parties/${r.partyId}`} target="_blank" className="font-semibold text-primary hover:underline">{r.name}</Link>
                {r.sub && <span className="block text-xs text-muted">{r.sub}</span>}
              </div>
              <div>
                <label className="label" htmlFor={`party-role-${i}`}>役割</label>
                <select id={`party-role-${i}`} className="input" value={r.role} onChange={(e) => update(i, { role: e.target.value })}>
                  {roles.map((k) => (
                    <option key={k} value={k}>{lbl(CONTRACT_PARTY_ROLE, k)}</option>
                  ))}
                </select>
              </div>
              <div>
                {showShare && (r.role === "lessor" || r.role === "seller") ? (
                  <>
                    <label className="label" htmlFor={`party-share-${i}`}>持分</label>
                    <input id={`party-share-${i}`} className="input" value={r.share ?? ""} placeholder="例: 1/2" onChange={(e) => update(i, { share: e.target.value || null })} />
                  </>
                ) : null}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); markDirty(); }}>
                外す
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-1 gap-2 rounded-md bg-bg p-3 sm:grid-cols-[200px_1fr]">
        <div>
          <label className="label" htmlFor="party-add-role">追加する役割</label>
          <select id="party-add-role" className="input" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
            {roles.map((k) => (
              <option key={k} value={k}>{lbl(CONTRACT_PARTY_ROLE, k)}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">顧客台帳から検索して追加</span>
          <SearchPicker
            search={searchParties}
            placeholder="氏名・法人名・読み・顧客番号"
            onPick={(it) => {
              if (rows.some((r) => r.partyId === it.id && r.role === addRole)) return;
              setRows([...rows, { partyId: it.id, role: addRole, share: null, name: it.label, sub: it.sub }]);
              markDirty();
            }}
          />
        </div>
      </div>
      <p className="help">保存した時点の氏名・住所・連絡先を契約に記録します。後で顧客台帳を編集しても、確定した契約の当事者情報は変わりません。</p>
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}
