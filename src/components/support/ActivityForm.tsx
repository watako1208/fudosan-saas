"use client";
import { MiniForm } from "./MiniForm";
import { addActivity } from "@/lib/server/actions/support";
import { ACTIVITY_CHANNEL, opts } from "@/lib/labels-support";

/** 対応記録の追記（電話・来店など外部で行った対応の記録。送信機能ではない） */
export function ActivityForm({ entity, entityId }: { entity: "inquiry" | "repair"; entityId: string }) {
  return (
    <MiniForm action={addActivity} args={{ entity, entityId }} submitLabel="対応記録を追加" successMessage="追加しました">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">手段</span>
          <select name="channel" className="input" defaultValue="phone">
            {opts(ACTIVITY_CHANNEL).filter((o) => o.value !== "portal").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">方向</span>
          <select name="direction" className="input" defaultValue="in">
            <option value="in">受信（相手から）</option>
            <option value="out">発信（こちらから）</option>
            <option value="none">—</option>
          </select>
        </label>
        <label className="block">
          <span className="label">日時（空欄は現在）</span>
          <input name="at" type="datetime-local" className="input" />
        </label>
        <label className="block sm:col-span-3">
          <span className="label">対応内容（要約）<span className="ml-1 text-xs text-danger">必須</span></span>
          <input name="summary" className="input" maxLength={200} />
        </label>
        <label className="block sm:col-span-3">
          <span className="label">詳細</span>
          <textarea name="body" rows={3} className="input" />
        </label>
      </div>
      <p className="help">外部への送信は行いません。外部で行った対応を記録します。</p>
    </MiniForm>
  );
}
