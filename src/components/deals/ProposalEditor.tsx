"use client";
import { useState } from "react";
import { EditForm, FormSection, TextField, TextArea, useFormCtx } from "@/components/EditForm";
import { SearchSelect } from "@/components/parties/PartyPicker";
import { searchTargets, splitKey } from "./TargetsPicker";
import type { ActionResult } from "@/lib/server/action";

interface EditItem {
  propertyId: string;
  unitId: string | null;
  label: string;
  comment: string;
  refresh: boolean;
  isNew: boolean;
}

function ItemsEditor({ initial }: { initial: EditItem[] }) {
  const { markDirty } = useFormCtx();
  const [items, setItems] = useState<EditItem[]>(initial);
  const set = (next: EditItem[]) => {
    setItems(next);
    markDirty();
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    set(n);
  };
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <input type="hidden" name="items" value={JSON.stringify(items.map(({ propertyId, unitId, comment, refresh }) => ({ propertyId, unitId, comment, refresh })))} />
      {items.length === 0 && <p className="mb-2 text-sm text-muted">候補がありません。下の検索から登録済みの物件・部屋を追加してください。</p>}
      <ol className="space-y-2">
        {items.map((it, i) => (
          <li key={`${it.propertyId}:${it.unitId ?? ""}`} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{i + 1}. {it.label}</span>
              {it.isNew && <span className="text-xs text-primary">追加（保存時に現在の募集条件を取り込みます）</span>}
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">↑</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="下へ">↓</button>
                <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => set(items.filter((_, j) => j !== i))}>外す</button>
              </span>
            </div>
            <label className="mt-2 block text-sm">
              <span className="label">担当コメント（顧客に表示されます）</span>
              <textarea className="input" rows={2} value={it.comment} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} />
            </label>
            {!it.isNew && (
              <label className="mt-1 flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" checked={it.refresh} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, refresh: e.target.checked } : x)))} />
                保存時に最新の募集条件で更新する（未選択なら提案作成時の条件を維持）
              </label>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3">
        <span className="label">候補を追加（登録済みの物件・部屋から）</span>
        <SearchSelect
          placeholder="物件名・部屋番号・物件番号・住所で検索"
          search={searchTargets}
          onPick={(p) => {
            const k = splitKey(p.id);
            if (items.some((x) => x.propertyId === k.propertyId && x.unitId === k.unitId)) return;
            set([...items, { ...k, label: p.label, comment: "", refresh: false, isNew: true }]);
          }}
        />
      </div>
    </div>
  );
}

export function ProposalEditor({
  action,
  initial,
  version,
  items,
  cancelHref,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version: number;
  items: { propertyId: string; unitId: string | null; label: string; comment: string | null }[];
  cancelHref: string;
}) {
  return (
    <EditForm action={action} initial={initial} version={version} cancelHref={cancelHref} fieldLabels={{ title: "提案名", comment: "コメント" }}>
      <FormSection title="提案の内容">
        <TextField name="title" label="提案名" required className="sm:col-span-2 lg:col-span-3" />
        <TextArea name="comment" label="全体コメント（顧客に表示されます）" rows={3} className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
      <FormSection title="候補物件" desc="並び順は比較表・印刷・顧客ページの表示順になります">
        <ItemsEditor initial={items.map((x) => ({ ...x, comment: x.comment ?? "", refresh: false, isNew: false }))} />
      </FormSection>
    </EditForm>
  );
}
