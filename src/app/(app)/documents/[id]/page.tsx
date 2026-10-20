import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { AuthError } from "@/lib/server/session";
import { NotFoundError, getMany } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffNameMap } from "@/lib/server/lookups";
import { C, Party } from "@/lib/types";
import { loadDocument, loadVersion, listVersions, availableImages } from "@/lib/server/docgen/access";
import { buildMergeData } from "@/lib/server/docgen/data";
import { describeMissing, requiredMissing, countMissingText, canonical, stripMeta } from "@/lib/server/docgen/engine";
import type { DocumentX, DocVersionX } from "@/lib/server/docgen/model";
import {
  submitDocument, approveDocument, rejectDocument, issueDocument, reviseDocument, rerenderDocument, saveDocumentBlocks,
  publishDocument, unpublishDocument, archiveDocument,
} from "@/lib/server/actions/documents";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { DocBlocksView, DOC_CSS } from "@/components/documents/DocBlocksView";
import { PublishForm } from "@/components/documents/PublishForm";
import { lbl, tone } from "@/lib/labels";
import { DOC_STATUS, DOC_ENTITY, DocEntity, PUBLISH_KIND, docTypeLabel, entityHref, fieldLabel } from "@/lib/labels-documents";
import { formatDateTimeJst } from "@/lib/domain/dates";

const TABS = ["body", "versions", "history", "publish"];

const HISTORY_LABEL: Record<string, string> = {
  create: "作成", edit: "編集", submit: "確認依頼", approve: "承認", reject: "差戻し", issue: "発行", revise: "修正版を作成",
  rerender: "最新の値を再反映", publish: "公開", unpublish: "公開停止", export: "出力",
};

export default async function DocumentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("document.read");
  const { id } = await params;
  const sp = await searchParams;
  let d: DocumentX;
  let ver: DocVersionX;
  try {
    d = await loadDocument(ctx, id);
    ver = await loadVersion(ctx, d);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AuthError) return <StateMessage kind="forbidden" message={e.message} />;
    console.error("[documents.detail]", (e as Error).message);
    return <StateMessage kind="error" message="書類を読み込めませんでした" />;
  }
  const tab = tabOf(sp, TABS, "body");
  const canWrite = ctx.caps.has("document.write");
  const canApprove = ctx.caps.has("document.approve");
  const base = `/documents/${id}`;
  const entityLink = entityHref(d.entity, d.entityId);
  const names = await staffNameMap(ctx);

  // 元情報の更新検知（作成時の値は固定。差分は表示のみ）
  let changed: string[] = [];
  let sourceNewer = false;
  let sourceError: string | null = null;
  try {
    const fresh = await buildMergeData(ctx, d.entity, d.entityId, d.docType);
    sourceNewer = !!fresh.data.meta.sourceUpdatedAt && !!ver.sourceUpdatedAt && fresh.data.meta.sourceUpdatedAt > ver.sourceUpdatedAt;
    if (sourceNewer) {
      const old = ver.data ?? { fields: {}, lists: {} };
      const keys = new Set([...Object.keys(old.fields ?? {}), ...Object.keys(fresh.data.fields)]);
      keys.delete("doc.number");
      keys.delete("doc.date");
      changed = [...keys].filter((k) => (old.fields?.[k] ?? null) !== (fresh.data.fields[k] ?? null));
      const lk = new Set([...Object.keys(old.lists ?? {}), ...Object.keys(fresh.data.lists)]);
      changed.push(...[...lk].filter((k) => canonical(old.lists?.[k] ?? null) !== canonical(fresh.data.lists[k] ?? null)));
    }
  } catch (e) {
    sourceError = e instanceof NotFoundError ? "差込み元のデータが見つかりません（削除・アーカイブされた可能性があります）" : (e as Error).message;
  }

  const missing = describeMissing(ver.missing ?? []);
  const reqMissing = requiredMissing(ver.requiredFields ?? [], ver.data ?? { fields: {}, lists: {} });
  const missingInText = countMissingText(ver.blocks ?? []);
  const isDraft = ver.status === "draft" && !ver.frozen;

  return (
    <>
      <style>{DOC_CSS}</style>
      <DetailHeader
        back={{ href: "/documents", label: "書類一覧" }}
        number={d.number}
        title={d.title}
        badges={
          <>
            <Badge>{docTypeLabel(d.docType)}</Badge>
            <Badge tone={tone(DOC_STATUS, ver.status)}>{lbl(DOC_STATUS, ver.status)}</Badge>
            <Badge>第{ver.versionNo}版</Badge>
            {d.issuedVersionId && ver.status !== "issued" && <Badge tone="ok">第{d.issuedVersionNo}版 発行済み</Badge>}
            {(d.publishedTo?.length ?? 0) > 0 && <Badge tone="info">公開中</Badge>}
            {d.archived && <Badge>アーカイブ</Badge>}
          </>
        }
        meta={
          <>
            <span>
              対象: {entityLink ? <Link href={entityLink} className="text-primary hover:underline">{DOC_ENTITY[d.entity as DocEntity]?.label} {d.entityNumber ?? d.entityTitle}</Link> : d.entity}
            </span>
            <span>テンプレート: {d.templateId?.startsWith("builtin:") ? "既定" : ""} 第{d.templateVersionNo ?? "—"}版</span>
            <span>作成: {formatDateTimeJst(d.createdAt)}</span>
            <span>更新: {formatDateTimeJst(d.updatedAt)}</span>
          </>
        }
        actions={
          <>
            <Link href={`${base}/v/${ver.versionNo}/print`} className="btn btn-secondary" target="_blank">印刷・PDF</Link>
            <a href={`/api/documents/${id}/docx?v=${ver.versionNo}`} className="btn btn-secondary">Word（DOCX）</a>
            {isDraft && canWrite && <ActionButton action={submitDocument} args={{ id }} label="確認を依頼" variant="primary" confirm={missingInText > 0 ? `本文に「未入力」が${missingInText}か所残っています。このまま社内確認を依頼しますか？` : undefined} />}
            {ver.status === "in_review" && canApprove && (
              <ActionButton
                action={approveDocument}
                args={{ id }}
                label="承認"
                variant="primary"
                disabled={reqMissing.length > 0}
                disabledReason={reqMissing.length ? `必須項目が未入力: ${reqMissing.map(fieldLabel).join("、")}` : undefined}
                confirm={missingInText > 0 ? `本文に「未入力」が${missingInText}か所残っています。承認しますか？` : "この版を承認しますか？"}
              />
            )}
            {ver.status === "approved" && canApprove && <ActionButton action={issueDocument} args={{ id }} label="発行" variant="primary" confirm="発行すると、この版は固定され変更できなくなります。発行しますか？" />}
            {(ver.status === "in_review" || ver.status === "approved") && canApprove && <ActionButton action={rejectDocument} args={{ id }} label="差戻し" prompt="差戻しの理由を入力してください" />}
            {ver.status === "issued" && canWrite && <ActionButton action={reviseDocument} args={{ id }} label="修正版を作成" confirm={`発行済みの第${ver.versionNo}版はそのまま残し、第${ver.versionNo + 1}版の下書きを作成します。`} />}
            {canWrite && !d.issuedVersionId && <ActionButton action={archiveDocument} args={{ id }} label={d.archived ? "アーカイブ解除" : "アーカイブ"} confirm={d.archived ? "アーカイブを解除しますか？" : "この書類をアーカイブしますか？"} />}
          </>
        }
      />

      {isDraft && ver.rejectReason && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm" role="status">
          <span className="font-semibold text-warn">差戻し理由: </span>{ver.rejectReason}
        </div>
      )}
      {sourceError && <div className="mb-4 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">元情報の確認ができません: {sourceError}</div>}
      {sourceNewer && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm" role="status">
          <p className="font-semibold text-warn">元情報が更新されています</p>
          <p className="mt-1">
            この書類は作成時（{formatDateTimeJst(ver.sourceUpdatedAt)}時点）の値を固定して保存しています。
            {changed.length > 0 ? `変更された項目: ${changed.slice(0, 15).map(fieldLabel).join("、")}${changed.length > 15 ? ` ほか${changed.length - 15}件` : ""}` : "差込み項目の値に変化はありません。"}
          </p>
          {isDraft && canWrite ? (
            <div className="mt-2">
              <ActionButton
                action={rerenderDocument}
                args={{ id, confirmManual: ver.manualEdits }}
                label="最新の値を再反映"
                variant="primary"
                confirm={
                  ver.manualEdits
                    ? "手動で修正した箇所があります。手動修正したブロックは上書きせず、そのまま残します（修正していない差込みブロックだけを最新の値にします）。再反映しますか？"
                    : "修正していない差込みブロックを最新の値で描画し直します。よろしいですか？"
                }
              />
            </div>
          ) : (
            <p className="mt-1 text-muted">{ver.status === "issued" ? "発行済みの版は変更されません。反映が必要な場合は「修正版を作成」してから再反映してください。" : "下書きに差し戻すと再反映できます。"}</p>
          )}
        </div>
      )}

      {(missing.length > 0 || missingInText > 0) && ver.status !== "issued" && (
        <Card title={`未確認項目（${missing.length}件）`} className="mb-4">
          {missing.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {missing.map((m) => <li key={m.path}><Badge tone={reqMissing.includes(m.path) ? "danger" : "warn"}>{m.label}{reqMissing.includes(m.path) ? "（必須）" : ""}</Badge></li>)}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted">
            差込み時に元の台帳に値がなかった項目です。本文には「未入力」と表示されます（本文中に残っている「未入力」: {missingInText}か所）。
            {reqMissing.length > 0 && <span className="text-danger"> 必須項目が未入力のため承認できません。</span>}
          </p>
        </Card>
      )}

      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "body", label: isDraft && canWrite ? "本文の編集" : "本文" },
          { key: "versions", label: "版" },
          { key: "history", label: "確認・承認履歴" },
          { key: "publish", label: "外部公開" },
        ]}
      />

      {tab === "body" && (isDraft && canWrite ? (
        <DocumentEditor
          documentId={id}
          versionId={ver.id}
          version={ver.version}
          title={d.title}
          blocks={ver.blocks ?? []}
          autoRendered={ver.autoRendered ?? {}}
          images={(await availableImages(ctx, ver)).map((a) => ({ id: a.id, fileName: `${a.fileName}${a.category ? `（${a.category}）` : ""}` }))}
          action={saveDocumentBlocks}
        />
      ) : (
        <div className="space-y-2">
          {ver.frozen && <p className="text-sm text-muted">発行済みの版は固定されています（{formatDateTimeJst(ver.issuedAt)} 発行・{names.get(ver.issuedBy ?? "") ?? "—"}）。変更する場合は「修正版を作成」してください。</p>}
          {!ver.frozen && ver.status !== "draft" && <p className="text-sm text-muted">社内確認中・承認済みのため編集できません。修正が必要な場合は差戻してください。</p>}
          <div className="overflow-x-auto bg-bg p-2"><div className="doc-sheet"><DocBlocksView blocks={(ver.blocks ?? []).map(stripMeta)} /></div></div>
        </div>
      ))}

      {tab === "versions" && <VersionsTab ctx={ctx} d={d} names={names} />}

      {tab === "history" && (
        <Card title={`第${ver.versionNo}版の履歴`}>
          {(ver.history ?? []).length === 0 ? (
            <StateMessage kind="empty" />
          ) : (
            <table className="table">
              <thead><tr><th>日時</th><th>操作</th><th>利用者</th><th>理由・内容</th></tr></thead>
              <tbody>
                {[...(ver.history ?? [])].reverse().map((h, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{formatDateTimeJst(h.at)}</td><td>{HISTORY_LABEL[h.action] ?? h.action}</td><td>{h.byName}</td><td className="break-words">{h.reason ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "publish" && <PublishTab ctx={ctx} d={d} canWrite={canWrite} names={names} />}
    </>
  );
}

async function VersionsTab({ ctx, d, names }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; d: DocumentX; names: Map<string, string> }) {
  const vs = await listVersions(ctx, d.id);
  return (
    <Card title="版の一覧">
      <p className="mb-2 text-sm text-muted">発行済みの版は固定されており、後から元の台帳を変更しても内容は変わりません。</p>
      <table className="table">
        <thead><tr><th>版</th><th>状態</th><th>テンプレート版</th><th>差込み時点</th><th>発行</th><th>操作</th></tr></thead>
        <tbody>
          {vs.map((v) => (
            <tr key={v.id}>
              <td>第{v.versionNo}版{v.id === d.currentVersionId && <span className="ml-1 text-xs text-muted">（現在）</span>}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={tone(DOC_STATUS, v.status)}>{lbl(DOC_STATUS, v.status)}</Badge>
                  {v.frozen && <Badge>固定</Badge>}
                  {v.supersededBy && <Badge>旧版</Badge>}
                </span>
              </td>
              <td>{v.templateId?.startsWith("builtin:") ? "既定 " : ""}第{v.templateVersionNo ?? "—"}版</td>
              <td>{formatDateTimeJst(v.sourceUpdatedAt)}</td>
              <td>{v.issuedAt ? `${formatDateTimeJst(v.issuedAt)} ${names.get(v.issuedBy ?? "") ?? ""}` : "—"}</td>
              <td className="whitespace-nowrap">
                <Link href={`/documents/${d.id}/v/${v.versionNo}`} className="text-primary hover:underline">表示</Link>
                {" ・ "}
                <Link href={`/documents/${d.id}/v/${v.versionNo}/print`} className="text-primary hover:underline" target="_blank">印刷</Link>
                {" ・ "}
                <a href={`/api/documents/${d.id}/docx?v=${v.versionNo}`} className="text-primary hover:underline">DOCX</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function PublishTab({ ctx, d, canWrite, names }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; d: DocumentX; canWrite: boolean; names: Map<string, string> }) {
  const parties = await getMany<Party>(ctx, C.parties, [...(d.candidatePartyIds ?? []), ...(d.partyIds ?? [])]);
  const candidates = (d.candidatePartyIds ?? []).map((pid) => ({ id: pid, name: parties.get(pid)?.name ?? "（不明な関係者）" }));
  const published = (d.publishedTo?.length ?? 0) > 0;
  return (
    <Card title="外部利用者ページへの公開">
      <DL
        items={[
          ["公開状態", published ? <Badge tone="info">公開中</Badge> : <Badge>非公開</Badge>],
          ["公開先の種別", published ? d.publishedTo.map((k) => lbl(PUBLISH_KIND, k)).join("・") : "—"],
          ["公開先の関係者", published ? d.partyIds.map((p) => parties.get(p)?.name ?? "（不明）").join("、") : "—"],
          ["公開する版", d.issuedVersionNo ? `第${d.issuedVersionNo}版（発行済み）` : "—"],
          ["公開日時", d.publishedAt ? `${formatDateTimeJst(d.publishedAt)} ${names.get(d.publishedBy ?? "") ?? ""}` : "—"],
        ]}
      />
      <div className="mt-4">
        {d.status !== "issued" ? (
          <p className="text-sm text-muted">公開できるのは発行済みの書類だけです。{d.issuedVersionId ? "修正版の作成中は、修正版を発行するまで外部利用者ページには表示されません。" : ""}</p>
        ) : canWrite ? (
          <>
            <PublishForm documentId={d.id} version={d.version} candidates={candidates} current={{ kinds: d.publishedTo ?? [], partyIds: d.partyIds ?? [] }} action={publishDocument} />
            {published && <div className="mt-3"><ActionButton action={unpublishDocument} args={{ id: d.id }} label="公開を停止" variant="danger" confirm="外部利用者ページへの公開を停止しますか？" /></div>}
          </>
        ) : (
          <p className="text-sm text-muted">公開設定を変更する権限がありません。</p>
        )}
      </div>
    </Card>
  );
}
