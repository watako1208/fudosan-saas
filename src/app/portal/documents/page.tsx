import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getMany } from "@/lib/server/repo";
import { C, DocumentDoc } from "@/lib/types";

type PublishedDoc = DocumentDoc & { issuedVersionId?: string | null; issuedVersionNo?: number | null };
import { StateMessage } from "@/components/ui";
import { NoScope } from "@/components/portal/Guard";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "書類" };

export default async function PortalDocuments() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  const map = await getMany<PublishedDoc>(ctx, C.documents, [...scope.documentIds]);
  const list = [...map.values()]
    .filter((d) => !!d.issuedVersionId && (d.partyIds ?? []).includes(scope.partyId) && (d.publishedTo ?? []).includes(scope.kind) && !d.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <h1 className="mb-4">書類</h1>
      {list.length === 0 ? (
        <div className="card"><StateMessage kind="empty" message="公開された書類はまだありません" /></div>
      ) : (
        <ul className="space-y-2">
          {list.map((d) => (
            <li key={d.id}>
              <Link href={`/portal/documents/${d.id}`} className="card block p-4 hover:border-primary">
                <p className="font-semibold break-words">{d.title}</p>
                <p className="text-sm text-muted">{d.number}{d.issuedVersionNo ? ` ／ 第${d.issuedVersionNo}版` : ""} ／ 更新 {formatDateTimeJst(d.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
