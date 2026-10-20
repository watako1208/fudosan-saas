import Link from "next/link";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { listDocs, BaseDoc } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { C, Property, Unit, Party, Deal, Contract, Invoice, Inquiry } from "@/lib/types";
import type { Cap } from "@/lib/permissions";
import { PageHeader, Card, StateMessage } from "@/components/ui";
import type { RepairExt } from "@/lib/labels-support";

export const metadata = { title: "全体検索" };

interface Group<T extends BaseDoc> {
  key: string;
  label: string;
  collection: string;
  cap: Cap;
  row: (d: T) => { href: string; title: string; sub?: string | null };
}

type AnyDoc = BaseDoc & { storeId?: string | null };

const GROUPS: Group<AnyDoc>[] = [
  { key: "properties", label: "物件", collection: C.properties, cap: "property.read", row: (d) => { const p = d as unknown as Property; return { href: `/properties/${p.id}`, title: `${p.number} ${p.name}`, sub: p.address }; } },
  { key: "units", label: "部屋・区画", collection: C.units, cap: "property.read", row: (d) => { const u = d as unknown as Unit; return { href: `/properties/${u.propertyId}/units/${u.id}`, title: `部屋 ${u.number}`, sub: u.layout }; } },
  { key: "parties", label: "顧客・関係者", collection: C.parties, cap: "party.read", row: (d) => { const p = d as unknown as Party; return { href: `/parties/${p.id}`, title: `${p.number} ${p.name}`, sub: p.kana }; } },
  { key: "deals", label: "仲介案件", collection: C.deals, cap: "deal.read", row: (d) => { const x = d as unknown as Deal; return { href: `/deals/${x.id}`, title: `${x.number} ${x.title}` }; } },
  { key: "contracts", label: "契約", collection: C.contracts, cap: "contract.read", row: (d) => { const x = d as unknown as Contract; return { href: `/contracts/${x.id}`, title: `${x.number} ${x.title}` }; } },
  { key: "invoices", label: "請求", collection: C.invoices, cap: "billing.read", row: (d) => { const x = d as unknown as Invoice; return { href: `/billing/${x.id}`, title: `${x.number} ${x.billToName}`, sub: x.period }; } },
  { key: "inquiries", label: "問い合わせ", collection: C.inquiries, cap: "repair.read", row: (d) => { const x = d as unknown as Inquiry; return { href: `/support/${x.id}`, title: `${x.number} ${x.partyName ?? ""}`, sub: x.content.slice(0, 60) }; } },
  { key: "repairs", label: "修繕案件", collection: C.repairs, cap: "repair.read", row: (d) => { const x = d as unknown as RepairExt; return { href: `/support/repairs/${x.id}`, title: `${x.number} ${x.equipment ?? ""}`, sub: x.symptom.slice(0, 60) }; } },
];

/** 全体検索: 閲覧権限のあるデータだけを各10件まで表示する */
export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const groups = GROUPS.filter((g) => ctx.caps.has(g.cap));
  const results = q
    ? await Promise.all(
        groups.map(async (g) => {
          try {
            const page = await listDocs<AnyDoc>(ctx, g.collection, { search: q, pageSize: 25 });
            const items = page.items.filter((d) => canAccessStore(ctx, d.storeId ?? null));
            return { g, items: items.slice(0, 10), total: items.length, error: false };
          } catch (e) {
            console.error("[search]", g.key, (e as Error).message);
            return { g, items: [] as AnyDoc[], total: 0, error: true };
          }
        }),
      )
    : [];
  const hits = results.reduce((s, r) => s + r.items.length, 0);
  return (
    <>
      <PageHeader title="全体検索" sub="物件・部屋・顧客・案件・契約・請求・問い合わせ・修繕を番号・名称・住所などで検索します" />
      <form className="mb-4 flex gap-2" role="search" action="/search">
        <input name="q" defaultValue={q} className="input" placeholder="検索語（2文字以上を推奨）" aria-label="検索語" />
        <button className="btn btn-primary" type="submit">検索</button>
      </form>
      {!q ? (
        <div className="card"><StateMessage kind="empty" message="検索語を入力してください" /></div>
      ) : hits === 0 && results.every((r) => !r.error) ? (
        <div className="card"><StateMessage kind="no_results" message={`「${q}」に一致するデータはありません`} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {results
            .filter((r) => r.items.length || r.error)
            .map((r) => (
              <Card key={r.g.key} title={`${r.g.label}（${r.total > 10 ? "10件以上" : `${r.total}件`}）`}>
                {r.error ? (
                  <p className="text-sm text-danger" role="alert">読み込みに失敗しました</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {r.items.map((d) => {
                      const row = r.g.row(d);
                      return (
                        <li key={d.id} className="py-2">
                          <Link href={row.href} className="text-primary hover:underline break-words">{row.title}</Link>
                          {row.sub && <p className="text-sm text-muted break-words">{row.sub}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            ))}
        </div>
      )}
      {q && groups.length < GROUPS.length && <p className="help mt-4">閲覧権限のない種類のデータは検索対象に含まれません。</p>}
    </>
  );
}
