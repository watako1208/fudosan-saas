import { requireStaffPage } from "@/lib/server/session";
import { SP } from "@/lib/server/query";
import { saveTemplate } from "@/lib/server/actions/documents";
import { builtinTemplate } from "@/lib/server/docgen/builtin";
import { PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/documents/TemplateForm";
import { DOC_TYPES } from "@/lib/labels-documents";
import { todayJst } from "@/lib/domain/dates";
import type { XBlock } from "@/lib/server/docgen/engine";

export const metadata = { title: "テンプレートの登録" };

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaffPage("template.manage");
  const sp = await searchParams;
  const docType = typeof sp.docType === "string" && DOC_TYPES[sp.docType] ? sp.docType : "";
  const b = docType ? builtinTemplate(docType) : null;
  const blocks: XBlock[] = (b?.body ?? [{ type: "heading", text: docType ? DOC_TYPES[docType].label : "", level: 1 }]).map((x, i) => ({ ...x, key: `n${i}`, tpl: null }) as XBlock);
  return (
    <>
      <PageHeader title="テンプレートの登録" sub="登録したテンプレートは下書きです。テンプレート管理者が承認すると書類作成に使えるようになります。" />
      <TemplateForm
        action={saveTemplate}
        images={[]}
        initial={{
          id: null,
          name: docType ? `${DOC_TYPES[docType].label}（自社）` : "",
          docType,
          dealType: docType ? DOC_TYPES[docType].dealType : "any",
          effectiveFrom: todayJst(),
          requiredFields: b?.requiredFields ?? [],
          changeNote: "",
          blocks,
          version: null,
          status: null,
          versionNo: null,
        }}
      />
      <p className="text-sm text-muted">画像（会社ロゴ・印影など）は、保存後のテンプレート画面で登録して挿入できます。</p>
    </>
  );
}
