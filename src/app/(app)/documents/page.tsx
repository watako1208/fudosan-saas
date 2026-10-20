import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { C } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { lbl, tone, opts } from "@/lib/labels";
import { DOC_STATUS, DOC_TYPES, DOC_ENTITY, DocEntity, docTypeLabel, entityHref } from "@/lib/labels-documents";
import { formatDateTimeJst } from "@/lib/domain/dates";
import { canReadDocument } from "@/lib/server/docgen/access";
import type { DocumentX } from "@/lib/server/docgen/model";

export const metadata = { title: "書類一覧" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("document.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["number", "updatedAt", "createdAt"], ["docType", "status"]);
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<DocumentX>(ctx, C.documents, o);
  } catch (e) {
    console.error("[documents.list]", (e as Error).message);
    error = "書類一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const canWrite = ctx.caps.has("document.write");
  // 差込み元の閲覧権限がない書類は行を表示しない（件数は概数）
  const items = (page?.items ?? []).filter((d) => canReadDocument(ctx, d));

  return (
    <>
      <PageHeader
        title="書類"
        sub="テンプレートから書類を作成し、確認・承認・発行・版管理を行います"
        actions={
          <>
            <Link href="/documents/templates" className="btn btn-secondary">テンプレート</Link>
            {canWrite && <Link href="/documents/new" className="btn btn-primary">＋ 書類を作成</Link>}
          </>
        }
      />
      <FilterBar
        tableId="documents"
        placeholder="書類番号・書類名・対象の番号で検索"
        filters={[
          { key: "docType", label: "書類種別", options: Object.entries(DOC_TYPES).map(([value, d]) => ({ value, label: d.label })) },
          { key: "status", label: "状態", options: opts(DOC_STATUS).filter((x) => x.value !== "superseded") },
        ]}
      />
      <DataTable
        tableId="documents"
        csvName="書類一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/documents/new" className="btn btn-primary">書類を作成</Link>}
        columns={[
          { key: "number", label: "書類番号", sortable: true },
          { key: "docType", label: "書類種別" },
          { key: "title", label: "書類名", primary: true },
          { key: "entity", label: "対象" },
          { key: "template", label: "テンプレート版" },
          { key: "version", label: "作成版" },
          { key: "status", label: "状態" },
          { key: "updatedAt", label: "更新日", sortable: true },
        ]}
        rows={items.map((d) => {
          const href = entityHref(d.entity, d.entityId);
          const entityLabel = `${DOC_ENTITY[d.entity as DocEntity]?.label ?? d.entity} ${d.entityNumber ?? ""}`.trim();
          return {
            id: d.id,
            href: `/documents/${d.id}`,
            cells: {
              number: d.number,
              docType: docTypeLabel(d.docType),
              title: (
                <span>
                  {d.title}
                  {d.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}
                </span>
              ),
              entity: href ? <Link href={href} className="text-primary hover:underline">{entityLabel}</Link> : entityLabel,
              template: d.templateId?.startsWith("builtin:") ? `既定 第${d.templateVersionNo ?? 1}版` : d.templateVersionNo ? `第${d.templateVersionNo}版` : "—",
              version: `第${d.currentVersionNo ?? 1}版`,
              status: (
                <span className="flex flex-wrap gap-1">
                  <Badge tone={tone(DOC_STATUS, d.status)}>{lbl(DOC_STATUS, d.status)}</Badge>
                  {d.issuedVersionId && d.status !== "issued" && <Badge tone="ok">第{d.issuedVersionNo}版 発行済み</Badge>}
                  {(d.publishedTo?.length ?? 0) > 0 && <Badge tone="info">公開中</Badge>}
                </span>
              ),
              updatedAt: formatDateTimeJst(d.updatedAt),
            },
            csv: {
              docType: docTypeLabel(d.docType),
              title: d.title,
              entity: entityLabel,
              template: d.templateVersionNo ?? "",
              version: d.currentVersionNo ?? 1,
              status: lbl(DOC_STATUS, d.status),
            },
          };
        })}
      />
    </>
  );
}
