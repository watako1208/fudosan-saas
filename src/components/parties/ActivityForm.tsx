"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addActivity } from "@/lib/server/actions/deals";
import { ACTIVITY_CHANNEL, ACTIVITY_DIRECTION } from "@/lib/labels-deals";
import { opts } from "@/lib/labels";

function nowLocalJst() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16);
}

/**
 * 対応記録の手動登録（電話・来店・メールなど外部で行った対応を記録する）。
 * この画面から外部へメール等を送信することはありません。
 */
export function ActivityForm({ entity, entityId }: { entity: "deal" | "party"; entityId: string }) {
  const router = useRouter();
  const rid = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      className="card card-pad grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setErrs([]);
        setSaved(false);
        try {
          const r = await addActivity({
            entity, entityId,
            channel: fd.get("channel"), direction: fd.get("direction"), at: fd.get("at"), summary: fd.get("summary"), body: fd.get("body"),
            _requestId: rid.current,
          });
          if (r.ok) {
            rid.current = crypto.randomUUID();
            setSaved(true);
            setKey((k) => k + 1);
            router.refresh();
          } else setErrs(r.errors?.length ? r.errors : [r.error]);
        } catch {
          setErrs(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted sm:col-span-2 lg:col-span-4">外部で行った電話・来店・メールなどの対応を記録します（この画面から送信は行いません）。</p>
      <label className="text-sm">
        <span className="label">手段</span>
        <select name="channel" className="input" defaultValue="phone">
          {opts(ACTIVITY_CHANNEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">方向</span>
        <select name="direction" className="input" defaultValue="in">
          {opts(ACTIVITY_DIRECTION).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">日時（日本時間）</span>
        <input name="at" type="datetime-local" className="input" defaultValue={nowLocalJst()} />
      </label>
      <label className="text-sm">
        <span className="label">要件<span className="ml-1 text-xs text-danger">必須</span></span>
        <input name="summary" className="input" maxLength={200} />
      </label>
      <label className="text-sm sm:col-span-2 lg:col-span-4">
        <span className="label">内容</span>
        <textarea name="body" rows={3} className="input" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button className="btn btn-primary" disabled={busy}>{busy ? "保存中…" : "対応を記録"}</button>
        {saved && <span className="text-sm text-ok" role="status">保存済み</span>}
        {errs.length > 0 && <span className="text-sm text-danger" role="alert">{errs.join(" / ")}</span>}
      </div>
    </form>
  );
}
