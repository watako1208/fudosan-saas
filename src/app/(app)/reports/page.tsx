import Link from "next/link";
import type { ReactNode } from "react";
import { AggregateField, Query } from "firebase-admin/firestore";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { col } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { C } from "@/lib/types";
import type { Cap } from "@/lib/permissions";
import { PageHeader, Card, StateMessage } from "@/components/ui";
import { RENTAL_DEAL_STATUSES, SALE_DEAL_STATUSES } from "@/lib/domain/rules";
import { isValidBizDate, todayJst, formatDateTimeJst } from "@/lib/domain/dates";
import { jstDayRangeIso, remainingOf } from "@/lib/labels-support";
import { yen } from "@/lib/domain/money";
import { OCCUPANCY, lbl } from "@/lib/labels";

export const metadata = { title: "集計" };

const SCAN_CAP = 5000;
const WON = ["won", "contracted", "delivered"];
const CLOSED = ["won", "lost", "contracted", "delivered", "closed"];

type F = { storeId: string | null; assigneeUid: string | null };

function eq(q: Query, f: F, supports: ("storeId" | "assigneeUid")[]): Query {
  if (f.storeId && supports.includes("storeId")) q = q.where("storeId", "==", f.storeId);
  if (f.assigneeUid && supports.includes("assigneeUid")) q = q.where("assigneeUid", "==", f.assigneeUid);
  return q;
}

interface Figure {
  key: string;
  label: string;
  value: ReactNode;
  basis: string;
  link?: { href: string; cap: Cap };
  error?: boolean;
}

async function safe(key: string, label: string, basis: string, link: Figure["link"], fn: () => Promise<ReactNode>): Promise<Figure> {
  try {
    return { key, label, basis, link, value: await fn() };
  } catch (e) {
    console.error("[reports]", key, (e as Error).message);
    return { key, label, basis, link, value: null, error: true };
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("report.read");
  const sp = await searchParams;
  const today = todayJst();
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const from = isValidBizDate(g("from")) ? g("from") : `${today.slice(0, 7)}-01`;
  const to = isValidBizDate(g("to")) && g("to") >= from ? g("to") : today;
  const storeId = g("storeId") && canAccessStore(ctx, g("storeId")) ? g("storeId") : null;
  const assigneeUid = g("assigneeUid") || null;
  const f: F = { storeId, assigneeUid };
  const { start, end } = jstDayRangeIso(from, to);
  const q = (name: string) => col(ctx.companyId, name) as Query;
  const period = `${from}〜${to}`;
  const scopeText = [storeId ? "選択した店舗" : null, assigneeUid ? "選択した担当者" : null].filter(Boolean).join("・");
  const cond = (base: string, supports: ("storeId" | "assigneeUid")[]) => {
    const unsupported = [storeId && !supports.includes("storeId") ? "店舗" : null, assigneeUid && !supports.includes("assigneeUid") ? "担当" : null].filter(Boolean);
    return `${base}${scopeText && supports.length ? `（${scopeText}で絞込み）` : ""}${unsupported.length ? `。※${unsupported.join("・")}の絞込みは対象データに項目がないため適用していません` : ""}`;
  };
  const count = async (qq: Query) => (await qq.count().get()).data().count.toLocaleString() + "件";
  const assigneeParam = assigneeUid ? `&assigneeUid=${encodeURIComponent(assigneeUid)}` : "";

  const figures = await Promise.all([
    safe("inquiries", "問い合わせ", cond(`受付日時が ${period}（日本時間）の問い合わせ件数（アーカイブ含む）`, ["storeId", "assigneeUid"]), { href: `/support?sort=receivedAt${assigneeParam}`, cap: "repair.read" }, () =>
      count(eq(q(C.inquiries), f, ["storeId", "assigneeUid"]).where("receivedAt", ">=", start).where("receivedAt", "<", end))),
    safe("viewings", "内見", cond(`種類「内見」の予定のうち開始日時が ${period} のもの`, ["storeId", "assigneeUid"]), { href: `/schedule?view=month&date=${from}${assigneeParam}`, cap: "schedule.read" }, () =>
      count(eq(q(C.events).where("type", "==", "viewing"), f, ["storeId", "assigneeUid"]).where("start", ">=", start).where("start", "<", end))),
    safe("applications", "申込み", cond(`登録日時が ${period} の申込み件数（状態を問わない）`, []), { href: "/deals?tab=applications", cap: "deal.read" }, () =>
      count(q(C.applications).where("createdAt", ">=", start).where("createdAt", "<", end))),
    safe("won", "成約", cond(`状態が「成約」「契約済み」「引渡完了」で、最終更新日時が ${period} の仲介案件`, ["storeId", "assigneeUid"]), { href: `/deals?status=won${assigneeParam}`, cap: "deal.read" }, () =>
      count(eq(q(C.deals).where("status", "in", WON), f, ["storeId", "assigneeUid"]).where("updatedAt", ">=", start).where("updatedAt", "<", end))),
    safe("invoiced", "確定請求額（売上確定）", cond(`状態「確定」の請求のうち発行日が ${period} のものの請求額（税込）合計`, ["storeId"]), { href: "/billing?status=confirmed", cap: "billing.read" }, async () => {
      const r = await eq(q(C.invoices).where("status", "==", "confirmed"), f, ["storeId"]).where("issueDate", ">=", from).where("issueDate", "<=", to)
        .aggregate({ total: AggregateField.sum("total"), n: AggregateField.count() }).get();
      return `${yen(r.data().total ?? 0)}（${r.data().n.toLocaleString()}件）`;
    }),
    safe("unpaid", "未入金残高", cond(`状態「確定」の請求の残額（請求額−入金配分額）合計。集計時点の値（期間指定は適用しない）。最大${SCAN_CAP.toLocaleString()}件を集計`, ["storeId"]), { href: "/billing?pay=unpaid", cap: "billing.read" }, async () => {
      const snap = await eq(q(C.invoices).where("status", "==", "confirmed"), f, ["storeId"]).select("total", "paid").limit(SCAN_CAP).get();
      let sum = 0;
      let n = 0;
      for (const d of snap.docs) {
        const r = remainingOf(d.data() as { total: number; paid: number });
        if (r > 0) { sum += r; n++; }
      }
      return `${yen(sum)}（${n.toLocaleString()}件${snap.size >= SCAN_CAP ? "・上限到達のため一部" : ""}）`;
    }),
    safe("repairs", "修繕件数", cond(`登録日時が ${period} の修繕案件（中止を含む）`, ["storeId", "assigneeUid"]), { href: `/support/repairs${assigneeUid ? `?assigneeUid=${encodeURIComponent(assigneeUid)}` : ""}`, cap: "repair.read" }, () =>
      count(eq(q(C.repairs), f, ["storeId", "assigneeUid"]).where("createdAt", ">=", start).where("createdAt", "<", end))),
  ]);

  // 売上見込（進行中の案件の見込金額を状態別に合計。集計時点の値）
  const active = [...RENTAL_DEAL_STATUSES, ...SALE_DEAL_STATUSES].filter(([k]) => !CLOSED.includes(k));
  let pipeline: { status: string; label: string; sum: number; n: number }[] | null = null;
  try {
    pipeline = await Promise.all(
      active.map(async ([k, label]) => {
        const r = await eq(q(C.deals).where("status", "==", k).where("archived", "==", false), f, ["storeId", "assigneeUid"])
          .aggregate({ sum: AggregateField.sum("expectedAmount"), n: AggregateField.count() }).get();
        return { status: k, label, sum: r.data().sum ?? 0, n: r.data().n };
      }),
    );
  } catch (e) {
    console.error("[reports.pipeline]", (e as Error).message);
  }

  // 入居状況（集計時点）
  let occupancy: { key: string; n: number }[] | null = null;
  try {
    occupancy = await Promise.all(
      Object.keys(OCCUPANCY).map(async (k) => ({ key: k, n: (await eq(q(C.units).where("occupancy", "==", k).where("archived", "==", false), f, ["storeId"]).count().get()).data().count })),
    );
  } catch (e) {
    console.error("[reports.occupancy]", (e as Error).message);
  }

  const [staff, stores] = await Promise.all([staffOptions(ctx), storeList(ctx.companyId)]);
  const can = (c: Cap) => ctx.caps.has(c);

  return (
    <>
      <PageHeader title="集計" sub={`集計日時: ${formatDateTimeJst(new Date().toISOString())}（日本時間）。各数値の算定条件と対象データへのリンクを表示します。`} />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" action="/reports">
        <label className="block"><span className="label">期間（開始）</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">期間（終了）</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <label className="block">
          <span className="label">店舗</span>
          <select name="storeId" defaultValue={storeId ?? ""} className="input">
            <option value="">すべて</option>
            {stores.filter((s) => canAccessStore(ctx, s.value)).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">担当</span>
          <select name="assigneeUid" defaultValue={assigneeUid ?? ""} className="input">
            <option value="">すべて</option>
            {staff.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <div className="flex items-end"><button className="btn btn-primary w-full" type="submit">集計する</button></div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {figures.map((x) => (
          <section key={x.key} className="card p-4">
            <p className="text-sm text-muted">{x.label}</p>
            {x.error ? <p className="mt-1 text-sm text-danger" role="alert">読み込みに失敗しました</p> : <p className="mt-1 text-2xl font-bold">{x.value}</p>}
            <p className="help">算定条件: {x.basis}</p>
            {x.link && can(x.link.cap) && <Link href={x.link.href} className="mt-1 inline-block text-sm text-primary hover:underline">対象データを見る →</Link>}
          </section>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="売上見込（進行中の案件・状態別）">
          {!pipeline ? (
            <StateMessage kind="error" message="売上見込を読み込めませんでした" />
          ) : (
            <>
              <table className="table">
                <thead><tr><th>状態</th><th className="num">件数</th><th className="num">見込金額合計</th></tr></thead>
                <tbody>
                  {pipeline.filter((p) => p.n > 0).map((p) => (
                    <tr key={p.status}>
                      <td>{can("deal.read") ? <Link href={`/deals?status=${p.status}${assigneeParam}`} className="text-primary hover:underline">{p.label}</Link> : p.label}</td>
                      <td className="num">{p.n.toLocaleString()}</td>
                      <td className="num">{yen(p.sum)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td>合計</td><td className="num">{pipeline.reduce((s, p) => s + p.n, 0).toLocaleString()}</td><td className="num">{yen(pipeline.reduce((s, p) => s + p.sum, 0))}</td></tr>
                </tbody>
              </table>
              <p className="help">算定条件: {cond("成約・失注・終了以外の状態にあるアーカイブされていない仲介案件の「見込金額」合計。未入力の案件は0円として合計（件数には含む）。集計時点の値で期間指定は適用しない", ["storeId", "assigneeUid"])}</p>
            </>
          )}
        </Card>
        <Card title="入居状況（部屋・区画）">
          {!occupancy ? (
            <StateMessage kind="error" message="入居状況を読み込めませんでした" />
          ) : (
            <>
              <table className="table">
                <tbody>
                  {occupancy.map((o) => (
                    <tr key={o.key}><td>{lbl(OCCUPANCY, o.key)}</td><td className="num">{o.n.toLocaleString()}件</td></tr>
                  ))}
                  <tr className="font-semibold"><td>合計</td><td className="num">{occupancy.reduce((s, o) => s + o.n, 0).toLocaleString()}件</td></tr>
                </tbody>
              </table>
              <p className="help">算定条件: {cond("アーカイブされていない部屋・区画の入居状態別件数（集計時点）", ["storeId"])}</p>
              {can("property.read") && <Link href="/properties" className="text-sm text-primary hover:underline">物件一覧へ →</Link>}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
