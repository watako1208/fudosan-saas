import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { findDocs } from "@/lib/server/repo";
import { entityCollection, ENTITY_READ_CAP } from "@/lib/server/attachments";
import { SP } from "@/lib/server/query";
import { createDocument } from "@/lib/server/actions/documents";
import { buildMergeData, BuildResult } from "@/lib/server/docgen/data";
import { templateChoices, effectiveCompanyTemplates, ResolvedTemplate } from "@/lib/server/docgen/templates";
import { renderBlocks, describeMissing, requiredMissing } from "@/lib/server/docgen/engine";
import { PageHeader, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { DocBlocksView, DOC_CSS } from "@/components/documents/DocBlocksView";
import { DOC_ENTITY, DOC_ENTITY_KEYS, DOC_TYPES, DocEntity, entityHref, fieldLabel } from "@/lib/labels-documents";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "書類の作成" };

const NUMBERED: DocEntity[] = ["contract", "invoice", "settlement", "repair", "deal", "property"];

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("document.write");
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const entity = g("entity") as DocEntity;
  const entityId = g("entityId");
  const docType = g("docType");
  const number = g("number");

  // 番号から対象を探す
  let lookupError: string | null = null;
  if (DOC_ENTITY_KEYS.includes(entity) && !entityId && number) {
    if (!NUMBERED.includes(entity)) lookupError = "この対象は番号で検索できません。対象の画面から「書類を作成」を押してください。";
    else {
      const hits = await findDocs<{ id: string } & import("@/lib/types").BaseDoc>(ctx, entityCollection(entity), [["number", "==", number]], 2);
      if (hits[0]) redirect(`/documents/new?entity=${entity}&entityId=${encodeURIComponent(hits[0].id)}${docType ? `&docType=${docType}` : ""}`);
      lookupError = `番号「${number}」の${DOC_ENTITY[entity].label}が見つかりません`;
    }
  }

  if (!DOC_ENTITY_KEYS.includes(entity) || !entityId) {
    return (
      <>
        <PageHeader title="書類の作成" sub="差込み元（契約・請求・修繕など）を選んでください。各画面の「書類を作成」からも開けます。" />
        <Card title="差込み元を選ぶ">
          <form method="get" className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="label">対象</span>
              <select name="entity" className="input" defaultValue={entity || "contract"}>
                {DOC_ENTITY_KEYS.filter((e) => ctx.caps.has(ENTITY_READ_CAP[e])).map((e) => <option key={e} value={e}>{DOC_ENTITY[e].label}</option>)}
              </select>
            </label>
            <label>
              <span className="label">番号（契約番号・請求番号・案件番号など）</span>
              <input name="number" className="input" defaultValue={number} placeholder="例: K000001" />
            </label>
            {docType && <input type="hidden" name="docType" value={docType} />}
            <div className="flex items-end"><button className="btn btn-primary" type="submit">次へ</button></div>
          </form>
          {lookupError && <p className="mt-3 text-sm text-danger" role="alert">{lookupError}</p>}
        </Card>
      </>
    );
  }

  const base = `/documents/new?entity=${entity}&entityId=${encodeURIComponent(entityId)}`;
  const types = Object.entries(DOC_TYPES).filter(([, d]) => d.entities.includes(entity));
  const contractTypeReady = new Map<string, boolean>();
  for (const [k, d] of types) if (d.contractType) contractTypeReady.set(k, (await effectiveCompanyTemplates(ctx, k)).length > 0);
  const href = entityHref(entity, entityId);

  return (
    <>
      <PageHeader
        title="書類の作成"
        sub={<>差込み元: {DOC_ENTITY[entity].label}{href && <> （<Link className="text-primary hover:underline" href={href}>対象を開く</Link>）</>}</>}
        actions={<Link href="/documents/new" className="btn btn-secondary">対象を選び直す</Link>}
      />
      <Card title="書類種別" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {types.map(([k, d]) => {
            const notSet = d.contractType && !contractTypeReady.get(k);
            return (
              <Link key={k} href={`${base}&docType=${k}`} className={`btn btn-sm ${docType === k ? "btn-primary" : "btn-secondary"}`}>
                {d.label}
                {notSet && <Badge tone="warn">書式未設定</Badge>}
              </Link>
            );
          })}
        </div>
      </Card>
      {docType && DOC_TYPES[docType] && <Preview ctx={ctx} entity={entity} entityId={entityId} docType={docType} templateId={g("templateId")} base={base} />}
    </>
  );
}

async function Preview({ ctx, entity, entityId, docType, templateId, base }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; entity: DocEntity; entityId: string; docType: string; templateId: string; base: string }) {
  const def = DOC_TYPES[docType];
  if (!def.entities.includes(entity)) return <StateMessage kind="error" message="この対象からは作成できない書類種別です" />;
  const choices = await templateChoices(ctx, docType);
  if (choices.length === 0) {
    return (
      <Card title={`${def.label}: 書式未設定`}>
        <p className="text-sm">
          「{def.label}」は契約関係書類のため、確認済みのテンプレートを登録・承認してから作成します。未登録のまま契約書を装った仮の書類は作成しません。
        </p>
        {ctx.caps.has("template.manage") ? (
          <Link href={`/documents/templates/new?docType=${docType}`} className="btn btn-primary mt-3">テンプレートを登録する</Link>
        ) : (
          <p className="mt-2 text-sm text-muted">テンプレートの登録はテンプレート管理権限を持つ利用者に依頼してください。</p>
        )}
      </Card>
    );
  }
  const tpl: ResolvedTemplate = choices.find((c) => c.id === templateId) ?? choices[0];
  let built: BuildResult | null = null;
  let loadError: string | null = null;
  try {
    built = await buildMergeData(ctx, entity, entityId, docType);
  } catch (e) {
    loadError = (e as Error).message || "差込み元を読み込めませんでした";
  }
  if (!built) return <StateMessage kind="error" message={loadError ?? undefined} />;
  const preview = renderBlocks(tpl.body, { ...built.data, fields: { ...built.data.fields, "doc.number": "（作成時に採番）" } });
  const missing = describeMissing(preview.missing);
  const reqMissing = requiredMissing(tpl.requiredFields ?? [], built.data);

  return (
    <div className="space-y-4">
      <style>{DOC_CSS}</style>
      <Card title="テンプレート">
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Link key={c.id} href={`${base}&docType=${docType}&templateId=${encodeURIComponent(c.id)}`} className={`btn btn-sm ${c.id === tpl.id ? "btn-primary" : "btn-secondary"}`}>
              {c.name}（{c.builtin ? "既定" : `第${c.versionNo}版・${c.effectiveFrom}〜`}）
            </Link>
          ))}
        </div>
        <p className="help">差込み元: {built.title}（元情報の更新日時 {formatDateTimeJst(built.data.meta.sourceUpdatedAt)}）</p>
      </Card>
      {built.errors.length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
          <p className="font-semibold">この書類は作成できません</p>
          <ul className="mt-1 list-disc pl-5">{built.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      ) : (
        <>
          <Card title={`未確認項目（${missing.length}件）`}>
            {missing.length === 0 ? (
              <p className="text-sm text-ok">差込み項目はすべて入力済みです。</p>
            ) : (
              <>
                <p className="mb-2 text-sm">次の項目は元の台帳に値がないため「未入力」と表示されます。作成後に本文で修正するか、元の台帳を入力して「最新の値を再反映」してください。</p>
                <ul className="flex flex-wrap gap-1.5">
                  {missing.map((m) => <li key={m.path}><Badge tone={reqMissing.includes(m.path) ? "danger" : "warn"}>{m.label}{reqMissing.includes(m.path) ? "（必須）" : ""}</Badge></li>)}
                </ul>
              </>
            )}
            {reqMissing.length > 0 && <p className="mt-2 text-sm text-danger">必須項目（{reqMissing.map(fieldLabel).join("、")}）が未入力のままでは承認できません。</p>}
          </Card>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={createDocument} args={{ entity, entityId, docType, templateId: tpl.id }} label="この内容で書類を作成（下書き）" variant="primary" />
          </div>
          <Card title="プレビュー">
            <div className="overflow-x-auto bg-bg p-2"><div className="doc-sheet"><DocBlocksView blocks={preview.blocks} /></div></div>
          </Card>
        </>
      )}
    </div>
  );
}
