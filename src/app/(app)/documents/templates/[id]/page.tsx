import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { C } from "@/lib/types";
import { builtinTemplate } from "@/lib/server/docgen/builtin";
import { IMAGE_TYPES } from "@/lib/server/docgen/access";
import type { TemplateX } from "@/lib/server/docgen/model";
import type { XBlock } from "@/lib/server/docgen/engine";
import { saveTemplate, approveTemplate, retireTemplate, copyBuiltinTemplate } from "@/lib/server/actions/documents";
import { DetailHeader, Card, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { TemplateForm } from "@/components/documents/TemplateForm";
import { DocBlocksView, DOC_CSS } from "@/components/documents/DocBlocksView";
import { lbl, tone } from "@/lib/labels";
import { TEMPLATE_STATUS, docTypeLabel, DOC_TYPES, fieldLabel } from "@/lib/labels-documents";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "書類テンプレート" };

export default async function TemplateDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("document.read");
  const { id } = await params;
  const canManage = ctx.caps.has("template.manage");

  if (id.startsWith("builtin-")) {
    const b = builtinTemplate(id.slice("builtin-".length));
    if (!b) notFound();
    return (
      <>
        <style>{DOC_CSS}</style>
        <DetailHeader
          back={{ href: "/documents/templates", label: "テンプレート一覧" }}
          number="システム既定"
          title={b.name}
          badges={<><Badge>{docTypeLabel(b.docType)}</Badge><Badge tone="ok">利用可能</Badge></>}
          actions={canManage && <ActionButton action={copyBuiltinTemplate} args={{ docType: b.docType }} label="複製して自社用に編集" variant="primary" />}
        />
        <Card title="必須項目" className="mb-4">
          <p className="text-sm">{b.requiredFields.length ? b.requiredFields.map(fieldLabel).join("、") : "なし"}</p>
        </Card>
        <Card title="本文（変数のまま表示）">
          <div className="overflow-x-auto bg-bg p-2"><div className="doc-sheet"><DocBlocksView blocks={b.body} markMissing={false} /></div></div>
        </Card>
      </>
    );
  }

  const t = await getDoc<TemplateX>(ctx, C.templates, id);
  if (!t) notFound();
  const family = (await findDocs<TemplateX>(ctx, C.templates, [["familyId", "==", t.familyId ?? t.id]], 200)).sort((a, b) => b.versionNo - a.versionNo);
  const names = await staffNameMap(ctx);
  const images = (await listAttachments(ctx, "template", t.id)).filter((a) => IMAGE_TYPES.includes(a.contentType));
  const hasDraft = family.some((x) => x.status === "draft" && x.id !== t.id);

  return (
    <>
      <DetailHeader
        back={{ href: "/documents/templates", label: "テンプレート一覧" }}
        number={`第${t.versionNo}版`}
        title={t.name}
        badges={
          <>
            <Badge>{docTypeLabel(t.docType)}</Badge>
            {DOC_TYPES[t.docType]?.contractType && <Badge>契約関係</Badge>}
            <Badge tone={tone(TEMPLATE_STATUS, t.status)}>{lbl(TEMPLATE_STATUS, t.status)}</Badge>
          </>
        }
        meta={
          <>
            <span>適用開始日: {t.effectiveFrom}</span>
            <span>承認: {t.approvedAt ? `${formatDateTimeJst(t.approvedAt)} ${names.get(t.approvedBy ?? "") ?? ""}` : "未承認"}</span>
            <span>更新: {formatDateTimeJst(t.updatedAt)}</span>
          </>
        }
        actions={
          canManage && (
            <>
              {t.status === "draft" && <ActionButton action={approveTemplate} args={{ id: t.id }} label="承認" variant="primary" confirm="このテンプレートを承認すると、適用開始日以降の書類作成に使われます。承認後は変更できません（変更は新しい版になります）。承認しますか？" />}
              {t.status === "approved" && <ActionButton action={retireTemplate} args={{ id: t.id }} label="廃止" confirm="このテンプレートを廃止しますか？作成済みの書類には影響しません。" />}
            </>
          )
        }
      />
      {t.status !== "draft" && canManage && (
        <div className="mb-4 rounded-md border border-line bg-surface p-3 text-sm">
          {hasDraft
            ? "この書式には編集中の下書きの版があります。下の「版」から下書きを開いて編集してください。"
            : "この版は承認済み（または廃止）のため変更できません。編集して保存すると、新しい版（下書き）として保存されます。"}
        </div>
      )}
      <TemplateForm
        action={saveTemplate}
        readOnly={!canManage || (t.status !== "draft" && hasDraft)}
        images={images.map((a) => ({ id: a.id, fileName: a.fileName }))}
        initial={{
          id: t.id,
          name: t.name,
          docType: t.docType,
          dealType: t.dealType,
          effectiveFrom: t.effectiveFrom,
          requiredFields: t.requiredFields ?? [],
          changeNote: t.changeNote ?? "",
          blocks: (t.body ?? []).map((b, i) => ({ ...b, key: `b${i}`, tpl: null }) as XBlock),
          version: t.version,
          status: t.status,
          versionNo: t.versionNo,
        }}
      />
      <Card title="版" className="mb-4">
        <table className="table">
          <thead><tr><th>版</th><th>名称</th><th>適用開始日</th><th>状態</th><th>承認</th><th>変更内容</th></tr></thead>
          <tbody>
            {family.map((x) => (
              <tr key={x.id}>
                <td>{x.id === t.id ? <b>第{x.versionNo}版（表示中）</b> : <Link href={`/documents/templates/${x.id}`} className="text-primary hover:underline">第{x.versionNo}版</Link>}</td>
                <td>{x.name}</td>
                <td>{x.effectiveFrom}</td>
                <td><Badge tone={tone(TEMPLATE_STATUS, x.status)}>{lbl(TEMPLATE_STATUS, x.status)}</Badge></td>
                <td>{x.approvedAt ? `${formatDateTimeJst(x.approvedAt)} ${names.get(x.approvedBy ?? "") ?? ""}` : "—"}</td>
                <td>{x.changeNote ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="テンプレートの画像（ロゴ・印影など）">
        <FileManager
          entity="template"
          entityId={t.id}
          canWrite={canManage}
          categories={["ロゴ", "印影", "図", "その他"]}
          items={images.map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
        />
      </Card>
    </>
  );
}
