import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { findDocs } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { C } from "@/lib/types";
import { builtinTemplate } from "@/lib/server/docgen/builtin";
import type { TemplateX } from "@/lib/server/docgen/model";
import { copyBuiltinTemplate } from "@/lib/server/actions/documents";
import { PageHeader, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { lbl, tone } from "@/lib/labels";
import { DOC_TYPES, TEMPLATE_STATUS, TEMPLATE_DEAL_TYPE } from "@/lib/labels-documents";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";

export const metadata = { title: "書類テンプレート" };

export default async function TemplatesPage() {
  const ctx = await requireStaffPage("document.read");
  const canManage = ctx.caps.has("template.manage");
  let list: TemplateX[] = [];
  let error: string | null = null;
  try {
    list = (await findDocs<TemplateX>(ctx, C.templates, [], 1000)).filter((t) => !t.archived);
  } catch (e) {
    console.error("[templates.list]", (e as Error).message);
    error = "テンプレートを読み込めませんでした";
  }
  const names = await staffNameMap(ctx);
  const today = todayJst();

  return (
    <>
      <PageHeader
        title="書類テンプレート"
        sub="標準書類は既定テンプレートで作成できます。契約関係書類は確認済みテンプレートを登録・承認するまで作成できません（書式未設定）。"
        actions={
          <>
            <Link href="/documents" className="btn btn-secondary">書類一覧</Link>
            {canManage && <Link href="/documents/templates/new" className="btn btn-primary">＋ テンプレートを登録</Link>}
          </>
        }
      />
      {error ? (
        <StateMessage kind="error" message={error} />
      ) : (
        <div className="space-y-4">
          {Object.entries(DOC_TYPES).map(([docType, def]) => {
            const mine = list.filter((t) => t.docType === docType).sort((a, b) => (a.familyId === b.familyId ? b.versionNo - a.versionNo : a.familyId < b.familyId ? -1 : 1));
            const b = builtinTemplate(docType);
            const usable = mine.some((t) => t.status === "approved" && t.effectiveFrom <= today);
            return (
              <Card
                key={docType}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {def.label}
                    {def.contractType && <Badge>契約関係</Badge>}
                    {def.contractType && !usable && <Badge tone="warn">書式未設定</Badge>}
                  </span>
                }
                actions={canManage && <Link href={`/documents/templates/new?docType=${docType}`} className="btn btn-secondary btn-sm">＋ 登録</Link>}
              >
                {!b && mine.length === 0 ? (
                  <p className="text-sm text-muted">登録されたテンプレートはありません。</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>名称</th><th>版</th><th>対象取引</th><th>適用開始日</th><th>状態</th><th>承認</th><th></th></tr></thead>
                      <tbody>
                        {mine.map((t) => (
                          <tr key={t.id}>
                            <td><Link href={`/documents/templates/${t.id}`} className="text-primary hover:underline">{t.name}</Link></td>
                            <td>第{t.versionNo}版</td>
                            <td>{lbl(TEMPLATE_DEAL_TYPE, t.dealType)}</td>
                            <td>{t.effectiveFrom}{t.status === "approved" && t.effectiveFrom > today && <span className="ml-1 text-xs text-muted">（適用前）</span>}</td>
                            <td><Badge tone={tone(TEMPLATE_STATUS, t.status)}>{lbl(TEMPLATE_STATUS, t.status)}</Badge></td>
                            <td>{t.approvedAt ? `${formatDateTimeJst(t.approvedAt)} ${names.get(t.approvedBy ?? "") ?? ""}` : "—"}</td>
                            <td></td>
                          </tr>
                        ))}
                        {b && (
                          <tr>
                            <td><Link href={`/documents/templates/builtin-${docType}`} className="text-primary hover:underline">{b.name}</Link></td>
                            <td>既定</td>
                            <td>{lbl(TEMPLATE_DEAL_TYPE, b.dealType)}</td>
                            <td>—</td>
                            <td><Badge tone="ok">利用可能</Badge></td>
                            <td>システム既定</td>
                            <td>{canManage && <ActionButton action={copyBuiltinTemplate} args={{ docType }} label="複製して編集" size="sm" />}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
