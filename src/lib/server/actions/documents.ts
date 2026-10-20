"use server";
// 書類（S15）: テンプレート管理、作成、編集、確認・承認・発行、版管理、再反映、外部公開。
import { adminDb } from "../firebase-admin";
import { requireStaff, Ctx } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, col, nowIso, getDoc, findDocs } from "../repo";
import { C } from "@/lib/types";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";
import { DOC_TYPES, docTypeLabel, PUBLISH_KIND, fieldLabel } from "@/lib/labels-documents";
import { buildMergeData } from "../docgen/data";
import { pickTemplate } from "../docgen/templates";
import { loadDocument, availableImages } from "../docgen/access";
import { builtinTemplate } from "../docgen/builtin";
import { sanitizeBlocks, parseRequiredFields } from "../docgen/validate";
import { renderBlocks, rerenderBlocks, hasManualEdits, requiredMissing, stripMeta, missingFields } from "../docgen/engine";
import type { DocumentX, DocVersionX, DocHistory, TemplateX } from "../docgen/model";

type R = Promise<ActionResult<{ redirect?: string } | null>>;

function hist(ctx: Ctx, action: DocHistory["action"], reason: string | null = null): DocHistory {
  return { action, by: ctx.uid, byName: ctx.user.displayName, at: nowIso(), reason };
}

function expected(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

// ───────────────────────── テンプレート ─────────────────────────

const DEAL_TYPES = ["rent", "sale", "management", "any"] as const;

function templateFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const errors: string[] = [];
  const name = str(v.name).slice(0, 200);
  if (!name) fe.name = "テンプレート名を入力してください";
  const docType = str(v.docType);
  if (!DOC_TYPES[docType]) fe.docType = "書類種別を選択してください";
  const dealType = (DEAL_TYPES as readonly string[]).includes(str(v.dealType)) ? (str(v.dealType) as TemplateX["dealType"]) : "any";
  const effectiveFrom = str(v.effectiveFrom);
  if (!isValidBizDate(effectiveFrom)) fe.effectiveFrom = "適用開始日を YYYY-MM-DD で入力してください";
  const body = sanitizeBlocks(v.blocks, errors, { allowSource: true, allowedImages: null }).map(stripMeta);
  const requiredFields = parseRequiredFields(v.requiredFields);
  return { data: { name, docType, dealType, effectiveFrom, body, requiredFields, changeNote: optStr(v.changeNote) }, fe, errors };
}

/**
 * テンプレートの保存。下書きはそのまま更新し、承認済み・廃止の版を編集した場合は新しい版（下書き）を作る。
 * 承認済みの版は変更しない。
 */
export async function saveTemplate(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("template.manage");
    const { data, fe, errors } = templateFields(v);
    if (Object.keys(fe).length || errors.length) throw new ValidationError([...Object.values(fe), ...errors], fe);
    const id = optStr(v.id);
    if (!id) {
      const newId = await runOnce(ctx, str(v._requestId), async (tx) => {
        const r = col(ctx.companyId, C.templates).doc();
        txCreate(tx, ctx, C.templates, { ...data, versionNo: 1, approvedBy: null, approvedAt: null, status: "draft", familyId: r.id, previousId: null } satisfies Omit<TemplateX, keyof import("../repo").BaseDoc>, r.id);
        audit(tx, ctx, "template.create", C.templates, r.id, { name: data.name, docType: data.docType });
        return r.id;
      });
      return { redirect: `/documents/templates/${newId}` };
    }
    const cur0 = await getDoc<TemplateX>(ctx, C.templates, id);
    if (!cur0) throw new ValidationError(["テンプレートが見つかりません"]);
    if (cur0.status === "draft") {
      await adminDb().runTransaction(async (tx) => {
        const cur = await txGet<TemplateX>(tx, ctx, C.templates, id);
        if (cur.status !== "draft") throw new ValidationError(["このテンプレートは承認済みのため変更できません。画面を読み直してください"]);
        txUpdate(tx, ctx, C.templates, cur, expected(v._version), { ...data });
        audit(tx, ctx, "template.update", C.templates, id, { name: data.name, versionNo: cur.versionNo });
      });
      return { redirect: `/documents/templates/${id}` };
    }
    // 承認済み・廃止 → 新しい版
    const family = await findDocs<TemplateX>(ctx, C.templates, [["familyId", "==", cur0.familyId ?? cur0.id]], 500);
    const maxNo = Math.max(cur0.versionNo, ...family.map((t) => t.versionNo));
    const draftExists = family.find((t) => t.status === "draft" && !t.archived);
    if (draftExists) throw new ValidationError([`この書式には編集中の下書き（第${draftExists.versionNo}版）があります。そちらを編集してください`]);
    const newId = await runOnce(ctx, str(v._requestId), async (tx) => {
      const r = col(ctx.companyId, C.templates).doc();
      txCreate(tx, ctx, C.templates, {
        ...data, docType: cur0.docType, versionNo: maxNo + 1, approvedBy: null, approvedAt: null, status: "draft", familyId: cur0.familyId ?? cur0.id, previousId: cur0.id,
      } satisfies Omit<TemplateX, keyof import("../repo").BaseDoc>, r.id);
      audit(tx, ctx, "template.new_version", C.templates, r.id, { from: cur0.id, versionNo: maxNo + 1 });
      return r.id;
    });
    return { redirect: `/documents/templates/${newId}` };
  });
}

/** 既定テンプレートを複製して自社テンプレートの下書きを作る */
export async function copyBuiltinTemplate(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("template.manage");
    const b = builtinTemplate(str(v.docType));
    if (!b) throw new ValidationError(["この書類種別には既定テンプレートがありません"]);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const r = col(ctx.companyId, C.templates).doc();
      txCreate(tx, ctx, C.templates, {
        docType: b.docType, name: b.name.replace("（標準）", "（自社）"), dealType: b.dealType, versionNo: 1, effectiveFrom: todayJst(),
        approvedBy: null, approvedAt: null, status: "draft", body: b.body, requiredFields: b.requiredFields, familyId: r.id, previousId: null, changeNote: "既定テンプレートから複製",
      } satisfies Omit<TemplateX, keyof import("../repo").BaseDoc>, r.id);
      audit(tx, ctx, "template.create", C.templates, r.id, { from: b.id });
      return r.id;
    });
    return { redirect: `/documents/templates/${id}` };
  });
}

export async function approveTemplate(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("template.manage");
    const id = str(v.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<TemplateX>(tx, ctx, C.templates, id);
      if (cur.status !== "draft") throw new ValidationError(["下書きのテンプレートだけ承認できます"]);
      if (!cur.body?.length) throw new ValidationError(["本文が空のテンプレートは承認できません"]);
      if (!isValidBizDate(cur.effectiveFrom)) throw new ValidationError(["適用開始日を設定してください"]);
      txUpdate(tx, ctx, C.templates, cur, null, { status: "approved", approvedBy: ctx.uid, approvedAt: nowIso() });
      audit(tx, ctx, "template.approve", C.templates, id, { versionNo: cur.versionNo, docType: cur.docType });
    });
    return { redirect: `/documents/templates/${id}` };
  });
}

export async function retireTemplate(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("template.manage");
    const id = str(v.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<TemplateX>(tx, ctx, C.templates, id);
      if (cur.status !== "approved") throw new ValidationError(["承認済みのテンプレートだけ廃止できます"]);
      txUpdate(tx, ctx, C.templates, cur, null, { status: "retired" });
      audit(tx, ctx, "template.retire", C.templates, id, { reason: optStr(v.reason) });
    });
    return { redirect: `/documents/templates/${id}` };
  });
}

// ───────────────────────── 書類の作成 ─────────────────────────

export async function createDocument(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const entity = str(v.entity);
    const entityId = str(v.entityId);
    const docType = str(v.docType);
    const def = DOC_TYPES[docType];
    if (!def) throw new ValidationError(["書類種別を選択してください"]);
    const tpl = await pickTemplate(ctx, docType, optStr(v.templateId));
    if (!tpl) {
      throw new ValidationError([
        def.contractType
          ? `書式未設定: 「${def.label}」は承認済みのテンプレートが登録されていないため作成できません。テンプレートを登録・承認してください。`
          : "選択したテンプレートは利用できません（未承認・適用開始前・廃止のいずれか）",
      ]);
    }
    if (def.contractType && tpl.builtin) throw new ValidationError([`書式未設定: 「${def.label}」は登録テンプレートが必要です`]);
    const built = await buildMergeData(ctx, entity, entityId, docType);
    if (built.errors.length) throw new ValidationError(built.errors);

    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const number = await txNextNumber(tx, ctx, "document", "DOC-");
      const data = { ...built.data, fields: { ...built.data.fields, "doc.number": number } };
      const r = renderBlocks(tpl.body, data);
      const docRef = col(ctx.companyId, C.documents).doc();
      const verRef = col(ctx.companyId, C.documentVersions).doc();
      const title = `${def.label} ${built.title}`.trim().slice(0, 200);
      txCreate(tx, ctx, C.documents, {
        number, docType, title, entity, entityId,
        templateId: tpl.id, templateVersionNo: tpl.versionNo,
        status: "draft", currentVersionId: verRef.id, sourceUpdatedAt: built.data.meta.sourceUpdatedAt,
        publishedTo: [], partyIds: [],
        keywords: keywords(number, title, built.data.meta.entityNumber, def.label),
        storeId: built.storeId, entityNumber: built.data.meta.entityNumber, entityTitle: built.title,
        currentVersionNo: 1, issuedVersionId: null, issuedVersionNo: null,
        candidatePartyIds: built.data.meta.candidatePartyIds, publishedAt: null, publishedBy: null,
      } satisfies Omit<DocumentX, keyof import("../repo").BaseDoc>, docRef.id);
      txCreate(tx, ctx, C.documentVersions, {
        documentId: docRef.id, versionNo: 1, data, blocks: r.blocks, manualEdits: false, status: "draft",
        approvedBy: null, issuedAt: null, issuedBy: null, frozen: false,
        templateId: tpl.id, templateVersionNo: tpl.versionNo, templateBlocks: tpl.body, autoRendered: r.autoRendered,
        requiredFields: tpl.requiredFields ?? [], missing: r.missing, sourceUpdatedAt: built.data.meta.sourceUpdatedAt,
        approvedAt: null, rejectReason: null, supersededBy: null, history: [hist(ctx, "create")],
      } satisfies Omit<DocVersionX, keyof import("../repo").BaseDoc>, verRef.id);
      audit(tx, ctx, "document.create", C.documents, docRef.id, { number, docType, entity, entityId, templateId: tpl.id, templateVersionNo: tpl.versionNo, missing: r.missing.length });
      return docRef.id;
    });
    return { redirect: `/documents/${id}` };
  });
}

// ───────────────────────── 編集 ─────────────────────────

async function txLoad(tx: FirebaseFirestore.Transaction, ctx: Ctx, id: string) {
  const d = await txGet<DocumentX>(tx, ctx, C.documents, id);
  if (!d.currentVersionId) throw new ValidationError(["書類の版が見つかりません"]);
  const ver = await txGet<DocVersionX>(tx, ctx, C.documentVersions, d.currentVersionId);
  if (ver.documentId !== d.id) throw new ValidationError(["書類の版が一致しません"]);
  return { d, ver };
}

function assertEditable(ver: DocVersionX) {
  if (ver.frozen || ver.status === "issued") throw new ValidationError(["発行済みの版は変更できません。「修正版を作成」してください"]);
  if (ver.status !== "draft") throw new ValidationError(["社内確認中・承認済みの書類は編集できません。差戻し後に編集してください"]);
}

/** ブロック編集の保存（下書きのみ） */
export async function saveDocumentBlocks(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const id = str(v.id);
    const d0 = await loadDocument(ctx, id);
    const v0 = d0.currentVersionId ? await getDoc<DocVersionX>(ctx, C.documentVersions, d0.currentVersionId) : null;
    if (!v0) throw new ValidationError(["書類の版が見つかりません"]);
    assertEditable(v0);
    const images = new Set((await availableImages(ctx, v0)).map((a) => a.id));
    // 既存の画像ブロック（作成時から含まれていたもの）は引き続き許可
    v0.blocks.forEach((b) => b.type === "image" && images.add(b.attachmentId));
    const errors: string[] = [];
    const blocks = sanitizeBlocks(v.blocks, errors, { allowSource: false, allowedImages: images });
    if (errors.length) throw new ValidationError(errors);
    const title = optStr(v.title)?.slice(0, 200) ?? d0.title;
    await adminDb().runTransaction(async (tx) => {
      const { d, ver } = await txLoad(tx, ctx, id);
      if (ver.id !== str(v.versionId)) throw new ValidationError(["編集中に版が変わりました。画面を読み直してください"]);
      assertEditable(ver);
      const manualEdits = hasManualEdits(blocks, ver.autoRendered ?? {});
      txUpdate(tx, ctx, C.documentVersions, ver, expected(v._version), { blocks, manualEdits, history: [...(ver.history ?? []), hist(ctx, "edit")].slice(-200) });
      txUpdate(tx, ctx, C.documents, d, null, { title, keywords: keywords(d.number, title, d.entityNumber, docTypeLabel(d.docType)) });
      audit(tx, ctx, "document.edit", C.documents, id, { versionNo: ver.versionNo, blocks: blocks.length, manualEdits });
    });
    return null;
  });
}

/** 状態遷移の共通処理 */
async function transition(
  v: Record<string, unknown>,
  cap: "document.write" | "document.approve",
  fn: (ctx: Ctx, d: DocumentX, ver: DocVersionX) => { verPatch: Record<string, unknown>; docPatch: Record<string, unknown>; action: string; detail?: unknown; extra?: (tx: FirebaseFirestore.Transaction) => void },
  preload?: (ctx: Ctx, tx: FirebaseFirestore.Transaction, d: DocumentX, ver: DocVersionX) => Promise<(tx: FirebaseFirestore.Transaction) => void>,
): R {
  return run(async () => {
    const ctx = await requireStaff(cap);
    const id = str(v.id);
    await loadDocument(ctx, id); // 閲覧範囲の確認
    await adminDb().runTransaction(async (tx) => {
      const { d, ver } = await txLoad(tx, ctx, id);
      const later = preload ? await preload(ctx, tx, d, ver) : null;
      const r = fn(ctx, d, ver);
      txUpdate(tx, ctx, C.documentVersions, ver, null, r.verPatch);
      txUpdate(tx, ctx, C.documents, d, null, r.docPatch);
      later?.(tx);
      r.extra?.(tx);
      audit(tx, ctx, r.action, C.documents, id, { versionNo: ver.versionNo, ...(r.detail as object) });
    });
    return { redirect: `/documents/${id}` };
  });
}

export async function submitDocument(v: Record<string, unknown>): R {
  return transition(v, "document.write", (ctx, d, ver) => {
    assertEditable(ver);
    return {
      verPatch: { status: "in_review", rejectReason: null, history: [...(ver.history ?? []), hist(ctx, "submit")] },
      docPatch: { status: "in_review" },
      action: "document.submit",
    };
  });
}

export async function approveDocument(v: Record<string, unknown>): R {
  return transition(v, "document.approve", (ctx, d, ver) => {
    if (ver.status !== "in_review") throw new ValidationError(["社内確認中の書類だけ承認できます"]);
    const req = requiredMissing(ver.requiredFields ?? [], ver.data);
    if (req.length) {
      throw new ValidationError([
        `必須項目が未入力のため承認できません: ${req.map(fieldLabel).join("、")}`,
        "元の台帳に入力してから差戻し→「最新の値を再反映」を行ってください",
      ]);
    }
    return {
      verPatch: { status: "approved", approvedBy: ctx.uid, approvedAt: nowIso(), history: [...(ver.history ?? []), hist(ctx, "approve")] },
      docPatch: { status: "approved" },
      action: "document.approve",
    };
  });
}

export async function rejectDocument(v: Record<string, unknown>): R {
  const reason = str(v.reason);
  return transition(v, "document.approve", (ctx, d, ver) => {
    if (!reason) throw new ValidationError(["差戻しの理由を入力してください"]);
    if (ver.status !== "in_review" && ver.status !== "approved") throw new ValidationError(["社内確認中・承認済みの書類だけ差し戻せます"]);
    return {
      verPatch: { status: "draft", approvedBy: null, approvedAt: null, rejectReason: reason, history: [...(ver.history ?? []), hist(ctx, "reject", reason)] },
      docPatch: { status: "draft" },
      action: "document.reject",
      detail: { reason },
    };
  });
}

/** 発行: 版を固定する（以後この版は変更不可） */
export async function issueDocument(v: Record<string, unknown>): R {
  return transition(
    v,
    "document.approve",
    (ctx, d, ver) => {
      if (ver.status !== "approved") throw new ValidationError(["承認済みの書類だけ発行できます"]);
      const at = nowIso();
      return {
        verPatch: { status: "issued", frozen: true, issuedAt: at, issuedBy: ctx.uid, history: [...(ver.history ?? []), hist(ctx, "issue")] },
        docPatch: { status: "issued", issuedVersionId: ver.id, issuedVersionNo: ver.versionNo },
        action: "document.issue",
      };
    },
    async (ctx, tx, d, ver) => {
      // 旧発行版に新しい版を記録（旧版は固定のまま閲覧可能）
      if (!d.issuedVersionId || d.issuedVersionId === ver.id) return () => {};
      const prev = await txGet<DocVersionX>(tx, ctx, C.documentVersions, d.issuedVersionId);
      return (t) => txUpdate(t, ctx, C.documentVersions, prev, null, { supersededBy: ver.id });
    },
  );
}

/** 発行済みの書類から修正版（次の版の下書き）を作る。発行済みの版はそのまま残る */
export async function reviseDocument(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const id = str(v.id);
    await loadDocument(ctx, id);
    await runOnce(ctx, str(v._requestId), async (tx) => {
      const { d, ver } = await txLoad(tx, ctx, id);
      if (ver.status !== "issued") throw new ValidationError(["修正版は発行済みの書類から作成します（下書き中の版はそのまま編集してください）"]);
      const r = col(ctx.companyId, C.documentVersions).doc();
      const no = ver.versionNo + 1;
      txCreate(tx, ctx, C.documentVersions, {
        documentId: id, versionNo: no, data: ver.data, blocks: ver.blocks, manualEdits: ver.manualEdits, status: "draft",
        approvedBy: null, issuedAt: null, issuedBy: null, frozen: false,
        templateId: ver.templateId, templateVersionNo: ver.templateVersionNo, templateBlocks: ver.templateBlocks ?? [], autoRendered: ver.autoRendered ?? {},
        requiredFields: ver.requiredFields ?? [], missing: ver.missing ?? [], sourceUpdatedAt: ver.sourceUpdatedAt ?? null,
        approvedAt: null, rejectReason: null, supersededBy: null, history: [hist(ctx, "revise", `第${ver.versionNo}版から作成`)],
      } satisfies Omit<DocVersionX, keyof import("../repo").BaseDoc>, r.id);
      txUpdate(tx, ctx, C.documents, d, null, { status: "draft", currentVersionId: r.id, currentVersionNo: no });
      audit(tx, ctx, "document.revise", C.documents, id, { fromVersionNo: ver.versionNo, versionNo: no });
      return r.id;
    });
    return { redirect: `/documents/${id}` };
  });
}

/**
 * 「最新の値を再反映」: 差込み元の現在値でデータを作り直し、手動修正していない変数ブロックだけを描画し直す。
 * 手動修正がある場合は確認（confirmManual）が必要。手動修正したブロックは上書きしない。
 */
export async function rerenderDocument(v: Record<string, unknown>): Promise<ActionResult<{ redirect?: string; updated: number; skipped: number }>> {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const id = str(v.id);
    const d0 = await loadDocument(ctx, id);
    const built = await buildMergeData(ctx, d0.entity, d0.entityId, d0.docType);
    if (built.errors.length) throw new ValidationError(built.errors);
    let result = { updated: 0, skipped: 0 };
    await adminDb().runTransaction(async (tx) => {
      const { d, ver } = await txLoad(tx, ctx, id);
      assertEditable(ver);
      if (ver.manualEdits && v.confirmManual !== true && v.confirmManual !== "true") {
        throw new ValidationError(["手動で修正した箇所があります。手動修正したブロックは上書きされませんが、内容を確認のうえ再反映してください"]);
      }
      const data = { ...built.data, fields: { ...built.data.fields, "doc.number": d.number, "doc.date": ver.data?.fields?.["doc.date"] ?? built.data.fields["doc.date"] } };
      const tpl = ver.templateBlocks ?? [];
      const r = rerenderBlocks(ver.blocks, tpl, ver.autoRendered ?? {}, data);
      result = { updated: r.changed.length, skipped: r.skipped.length };
      const missing = missingFields(tpl, data);
      txUpdate(tx, ctx, C.documentVersions, ver, null, {
        data, blocks: r.blocks, autoRendered: r.autoRendered, missing, sourceUpdatedAt: built.data.meta.sourceUpdatedAt,
        manualEdits: hasManualEdits(r.blocks, r.autoRendered),
        history: [...(ver.history ?? []), hist(ctx, "rerender", `更新${r.changed.length}件・手動修正のため対象外${r.skipped.length}件`)],
      });
      txUpdate(tx, ctx, C.documents, d, null, { sourceUpdatedAt: built.data.meta.sourceUpdatedAt, candidatePartyIds: built.data.meta.candidatePartyIds });
      audit(tx, ctx, "document.rerender", C.documents, id, { versionNo: ver.versionNo, changed: r.changed, skipped: r.skipped });
    });
    return { redirect: `/documents/${id}`, ...result };
  });
}

// ───────────────────────── 外部公開 ─────────────────────────

/** 発行済み書類を外部利用者ページへ公開する（公開先の種別と関係者を指定） */
export async function publishDocument(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const id = str(v.id);
    await loadDocument(ctx, id);
    const kinds = ([] as unknown[]).concat(v.kinds ?? []).map(String).filter((k) => k in PUBLISH_KIND) as DocumentX["publishedTo"];
    const partyIds = [...new Set(([] as unknown[]).concat(v.partyIds ?? []).map(String))];
    if (!kinds.length) throw new ValidationError(["公開先の種別を選択してください"]);
    if (!partyIds.length) throw new ValidationError(["公開先の関係者を選択してください"]);
    await adminDb().runTransaction(async (tx) => {
      const d = await txGet<DocumentX>(tx, ctx, C.documents, id);
      if (d.status !== "issued" || !d.issuedVersionId) throw new ValidationError(["発行済みの書類だけ公開できます"]);
      const allowed = new Set(d.candidatePartyIds ?? []);
      if (partyIds.some((p) => !allowed.has(p))) throw new ValidationError(["公開先は書類の関係者から選択してください"]);
      txUpdate(tx, ctx, C.documents, d, expected(v._version), { publishedTo: kinds, partyIds, publishedAt: nowIso(), publishedBy: ctx.uid });
      audit(tx, ctx, "document.publish", C.documents, id, { kinds, partyIds, versionNo: d.issuedVersionNo });
    });
    return { redirect: `/documents/${id}?tab=publish` };
  });
}

export async function unpublishDocument(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const id = str(v.id);
    await loadDocument(ctx, id);
    await adminDb().runTransaction(async (tx) => {
      const d = await txGet<DocumentX>(tx, ctx, C.documents, id);
      txUpdate(tx, ctx, C.documents, d, null, { publishedTo: [], partyIds: [], publishedAt: null, publishedBy: null });
      audit(tx, ctx, "document.unpublish", C.documents, id, { before: { kinds: d.publishedTo, partyIds: d.partyIds } });
    });
    return { redirect: `/documents/${id}?tab=publish` };
  });
}

/** 未発行の書類のアーカイブ（発行済みの書類は記録として残すためアーカイブしない） */
export async function archiveDocument(v: Record<string, unknown>): R {
  return run(async () => {
    const ctx = await requireStaff("document.write");
    const id = str(v.id);
    await loadDocument(ctx, id);
    await adminDb().runTransaction(async (tx) => {
      const d = await txGet<DocumentX>(tx, ctx, C.documents, id);
      if (d.issuedVersionId) throw new ValidationError(["発行済みの版がある書類はアーカイブできません"]);
      txUpdate(tx, ctx, C.documents, d, null, { archived: !d.archived });
      audit(tx, ctx, d.archived ? "unarchive" : "archive", C.documents, id);
    });
    return { redirect: `/documents/${id}` };
  });
}
