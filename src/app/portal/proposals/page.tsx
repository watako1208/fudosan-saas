import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getMany } from "@/lib/server/repo";
import { C } from "@/lib/types";
import type { Proposal } from "@/lib/types-deals";
import { StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "ご提案" };

export default async function PortalProposals() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "customer") return <NotForYou />;
  const map = await getMany<Proposal>(ctx, C.proposals, [...scope.proposalIds]);
  // 二重確認: 本人宛て・公開済みのみ（T14）
  const list = [...map.values()]
    .filter((p) => p.customerId === scope.partyId && p.publishedToCustomer && !p.archived)
    .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt));
  return (
    <>
      <h1 className="mb-4">ご提案</h1>
      {list.length === 0 ? (
        <div className="card"><StateMessage kind="empty" message="公開されたご提案はまだありません" /></div>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.id}>
              <Link href={`/portal/proposals/${p.id}`} className="card block p-4 hover:border-primary">
                <p className="font-semibold break-words">{p.title || "物件のご提案"}</p>
                <p className="text-sm text-muted">候補 {(p.items ?? []).length}件 ／ 公開日 {formatDateTimeJst(p.publishedAt ?? p.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
