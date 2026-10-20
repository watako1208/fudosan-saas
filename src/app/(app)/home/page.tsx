import Link from "next/link";
import type { Query } from "firebase-admin/firestore";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { col } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { C } from "@/lib/types";
import type { Cap } from "@/lib/permissions";
import { PageHeader, StateMessage } from "@/components/ui";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";
import { jstDayRangeIso, parseScope, remainingOf, HomeScope } from "@/lib/labels-support";

export const metadata = { title: "ホーム" };

type Filter = { field: "assigneeUid" | "storeId"; values: string[] } | null;

interface CardDef {
  key: string;
  label: string;
  cap: Cap;
  href: string;
  /** 担当・店舗による絞込みの可否 */
  supports: ("assigneeUid" | "storeId")[];
  note?: string;
  count: (q: (name: string) => Query, f: Filter) => Promise<{ n: number; capped?: boolean }>;
}

function applyFilter(q: Query, f: Filter, supports: CardDef["supports"]): Query | null {
  if (!f) return q;
  if (!supports.includes(f.field)) return null;
  if (!f.values.length) return null;
  return f.values.length === 1 ? q.where(f.field, "==", f.values[0]) : q.where(f.field, "in", f.values.slice(0, 30));
}

async function cnt(q: Query) {
  return { n: (await q.count().get()).data().count };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage();
  const sp = await searchParams;
  const scope: HomeScope = parseScope(sp.scope);
  const asOf = new Date();
  const today = todayJst(asOf);
  const { start, end } = jstDayRangeIso(today, today);
  const selStore = await currentStoreId(ctx);
  const storeIds = selStore ? [selStore] : ctx.user.storeIds ?? [];
  const filter: Filter = scope === "mine" ? { field: "assigneeUid", values: [ctx.uid] } : scope === "store" ? { field: "storeId", values: storeIds } : null;
  const q = (name: string) => col(ctx.companyId, name) as Query;
  const mineParam = scope === "mine" ? `&assigneeUid=${encodeURIComponent(ctx.uid)}` : "";

  const cards: CardDef[] = [
    {
      key: "events", label: "本日の予定", cap: "schedule.read", href: `/schedule?view=day&date=${today}${mineParam}`, supports: ["assigneeUid", "storeId"],
      count: (q, f) => {
        const base = applyFilter(q(C.events).where("archived", "==", false), f, ["assigneeUid", "storeId"]);
        return base ? cnt(base.where("start", ">=", start).where("start", "<", end)) : Promise.reject(new Error("na"));
      },
    },
    {
      key: "inquiries", label: "未対応問い合わせ", cap: "repair.read", href: `/support?status=open${mineParam}`, supports: ["assigneeUid", "storeId"],
      count: (q, f) => {
        const base = applyFilter(q(C.inquiries).where("status", "==", "open").where("archived", "==", false), f, ["assigneeUid", "storeId"]);
        return base ? cnt(base) : Promise.reject(new Error("na"));
      },
    },
    {
      key: "tasks", label: "期限超過タスク", cap: "schedule.read", href: `/schedule/tasks?overdue=1${mineParam}`, supports: ["assigneeUid", "storeId"],
      count: (q, f) => {
        const base = applyFilter(q(C.tasks).where("done", "==", false).where("archived", "==", false), f, ["assigneeUid", "storeId"]);
        return base ? cnt(base.where("due", "<", today)) : Promise.reject(new Error("na"));
      },
    },
    {
      key: "deals", label: "契約準備中", cap: "deal.read", href: `/deals?status=contract_prep${mineParam}`, supports: ["assigneeUid", "storeId"],
      count: (q, f) => {
        const base = applyFilter(q(C.deals).where("status", "==", "contract_prep").where("archived", "==", false), f, ["assigneeUid", "storeId"]);
        return base ? cnt(base) : Promise.reject(new Error("na"));
      },
    },
    {
      key: "unpaid", label: "未入金", cap: "billing.read", href: "/billing?pay=unpaid", supports: ["storeId"],
      note: "確定済み請求のうち残額があるもの（担当者の区別がないため「自分」では店舗範囲で集計）",
      count: async (q, f) => {
        const ff: Filter = f?.field === "assigneeUid" ? { field: "storeId", values: storeIds } : f;
        const base = applyFilter(q(C.invoices).where("status", "==", "confirmed"), ff, ["storeId"]);
        if (!base) throw new Error("na");
        const snap = await base.select("total", "paid").limit(5000).get();
        return { n: snap.docs.filter((d) => remainingOf(d.data() as { total: number; paid: number }) > 0).length, capped: snap.size >= 5000 };
      },
    },
    {
      key: "repairs", label: "承認待ち修繕", cap: "repair.read", href: `/support/repairs?status=awaiting_approval${mineParam}`, supports: ["assigneeUid", "storeId"],
      count: (q, f) => {
        const base = applyFilter(q(C.repairs).where("status", "==", "awaiting_approval").where("approvalState", "==", "pending").where("archived", "==", false), f, ["assigneeUid", "storeId"]);
        return base ? cnt(base) : Promise.reject(new Error("na"));
      },
    },
    {
      key: "renewals", label: "更新対象", cap: "lease.read", href: "/lease?tab=renewals", supports: [],
      note: "抽出済み・案内済みの更新（会社全体で集計）",
      count: (q) => cnt(q(C.renewals).where("status", "in", ["extracted", "notified"])),
    },
  ];

  const visible = cards.filter((c) => ctx.caps.has(c.cap));
  const results = await Promise.all(
    visible.map(async (c) => {
      try {
        const effective = c.supports.length === 0 ? null : filter;
        if (effective && effective.field === "storeId" && !effective.values.length) return { c, state: "nostore" as const };
        const r = await c.count(q, effective);
        return { c, state: "ok" as const, ...r };
      } catch (e) {
        if ((e as Error).message === "na") return { c, state: "nostore" as const };
        console.error("[home.count]", c.key, (e as Error).message);
        return { c, state: "error" as const };
      }
    }),
  );

  return (
    <>
      <PageHeader
        title="ホーム"
        sub={<>集計基準日時: {formatDateTimeJst(asOf.toISOString())}（日本時間）</>}
        actions={<ScopeToggle current={scope} />}
      />
      {visible.length === 0 ? (
        <div className="card"><StateMessage kind="forbidden" message="表示できる業務の権限がありません" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {results.map((r) => (
            <Link key={r.c.key} href={r.c.href} className="card block p-4 hover:border-primary">
              <p className="text-sm text-muted">{r.c.label}</p>
              {r.state === "ok" ? (
                <p className={`mt-1 text-3xl font-bold ${r.c.key === "tasks" && r.n > 0 ? "text-danger" : ""}`}>
                  {r.n.toLocaleString()}
                  <span className="ml-1 text-sm font-normal text-muted">件{r.capped ? "以上" : ""}</span>
                </p>
              ) : r.state === "nostore" ? (
                <p className="mt-1 text-sm text-muted">所属店舗が設定されていないため集計できません</p>
              ) : (
                <p className="mt-1 text-sm text-danger" role="alert">読み込みに失敗しました</p>
              )}
              {r.c.note && <p className="help">{r.c.note}</p>}
            </Link>
          ))}
        </div>
      )}
      <p className="help mt-4">
        対象: {scope === "mine" ? "自分が担当のもの" : scope === "store" ? `所属店舗${selStore ? "（選択中の店舗）" : ""}のもの` : "会社全体"}。件数を押すと該当の一覧へ移動します。
      </p>
    </>
  );
}

function ScopeToggle({ current }: { current: HomeScope }) {
  const items: [HomeScope, string][] = [["mine", "自分"], ["store", "店舗"], ["company", "会社"]];
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="集計対象">
      {items.map(([k, l]) => (
        <Link
          key={k}
          href={`/home?scope=${k}`}
          className={`rounded px-4 py-2 text-sm font-medium ${current === k ? "bg-primary text-white" : "text-ink hover:bg-bg"}`}
          aria-current={current === k ? "true" : undefined}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}

