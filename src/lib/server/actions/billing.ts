"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, getDoc, col, nowIso, BaseDoc, listDocs } from "../repo";
import { companySettings } from "../lookups";
import { C, Allocation, Contract, Invoice, InvoiceLine, Party, Payment, Unit } from "@/lib/types";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";
import type { TaxSetting } from "@/lib/domain/money";
import { buildLines, differenceLines, invoiceTotals, isValidPeriod, LineDraft, paidStateOf, paymentStatusOf, periodOf } from "@/lib/domain/billing";
import { generateMonthlyInvoices, recalcDraftInvoice, txAssertPeriodsOpen } from "../jobs/billing";

// S16 請求: 一時・初期費用請求の作成、下書き編集、確定、取消、差額調整（B16）、月次請求（B05/B06）。
// 確定済み請求の金額は書き換えない。取消・訂正は別の記録を作り、元請求との関係を残す。

const TAX_CATS = ["taxable", "exempt", "non_taxable"] as const;

function parseLineInput(raw: unknown): LineDraft[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(String(raw));
  } catch {
    throw new ValidationError(["明細の入力内容を読み取れません"]);
  }
  if (!Array.isArray(arr)) return [];
  if (arr.length > 200) throw new ValidationError(["明細は200行までです"]);
  return arr.map((x) => {
    const o = x as Record<string, unknown>;
    const t = (o.tax ?? {}) as Record<string, unknown>;
    const category = (TAX_CATS as readonly string[]).includes(str(t.category)) ? (str(t.category) as TaxSetting["category"]) : "taxable";
    return {
      itemCode: str(o.itemCode),
      name: str(o.name),
      quantity: str(o.quantity),
      unitPrice: str(o.unitPrice),
      tax: { category, rate: str(t.rate) || "0", priceMode: str(t.priceMode) === "inclusive" ? "inclusive" : "exclusive" },
    } satisfies LineDraft;
  });
}

function toInvoiceLine(l: LineDraft & { amount: number }, period: string | null): InvoiceLine {
  return {
    itemCode: l.itemCode, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, tax: l.tax,
    period, from: null, to: null, formula: null, dedupeKey: null, contractVersionId: null, adjustsInvoiceId: null,
  };
}

function confirmErrors(inv: Pick<Invoice, "billToPartyId" | "dueDate" | "lines" | "total">): string[] {
  const e: string[] = [];
  if (!inv.billToPartyId) e.push("請求先を選択してください");
  if (!inv.dueDate) e.push("支払期限を入力してください");
  if (!inv.lines.length) e.push("明細を1行以上入力してください");
  return e;
}

/** 請求の作成・下書き保存・確定（S16）。月額請求の自動明細は編集できず、手入力明細だけを追加できる */
export async function saveInvoice(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("billing.write");
    const intent = str(v._intent) === "confirm" ? "confirm" : "draft";
    if (intent === "confirm" && !ctx.caps.has("billing.confirm")) throw new ValidationError(["請求を確定する権限がありません。下書き保存してください。"]);
    const settings = await companySettings(ctx.companyId);
    const fe: Record<string, string> = {};
    const id = optStr(v.id);
    const billToPartyId = str(v.billToPartyId);
    if (!billToPartyId) fe.billToPartyId = "請求先を選択してください";
    const dueDate = optStr(v.dueDate);
    if (dueDate && !isValidBizDate(dueDate)) fe.dueDate = "支払期限の日付が正しくありません";
    if (intent === "confirm" && !dueDate) fe.dueDate = "確定には支払期限が必要です";
    const issueDate = optStr(v.issueDate) ?? todayJst();
    if (!isValidBizDate(issueDate)) fe.issueDate = "発行日が正しくありません";
    const periodIn = optStr(v.period);
    if (periodIn && !isValidPeriod(periodIn)) fe.period = "対象月は YYYY-MM 形式で入力してください";
    const { lines: built, errors } = buildLines(parseLineInput(v.lines), settings.lineRounding ?? "floor");
    if (errors.length) fe.lines = errors.join(" / ");
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);

    const party = await getDoc<Party>(ctx, C.parties, billToPartyId);
    if (!party) throw new ValidationError(["請求先が見つかりません"], { billToPartyId: "請求先が見つかりません" });

    if (id) {
      await adminDb().runTransaction(async (tx) => {
        const cur = await txGet<Invoice>(tx, ctx, C.invoices, id);
        if (cur.status !== "draft") throw new ValidationError(["確定済み・取消済みの請求は編集できません。取消または訂正（差額調整）を行ってください"]);
        if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の請求を編集する権限がありません"]);
        const period = cur.kind === "monthly" ? cur.period : periodIn ?? periodOf(issueDate);
        await txAssertPeriodsOpen(tx, ctx, [cur.period, period], "請求の編集");
        // 月額の自動明細（重複防止キー付き）はサーバー側の値を維持する
        const auto = cur.lines.filter((l) => l.dedupeKey);
        const lines = [...auto, ...built.map((l) => toInvoiceLine(l, period))];
        const tot = invoiceTotals(lines, settings.taxRounding ?? "floor");
        const patch: Record<string, unknown> = {
          billToPartyId, billToName: party.name, payerKana: [party.kana, party.name].filter(Boolean), dueDate, issueDate, period,
          lines, subtotal: tot.subtotal, tax: tot.tax, total: tot.total,
          keywords: keywords(cur.number, party.name, party.kana, period),
        };
        if (intent === "confirm") {
          const errs = confirmErrors({ billToPartyId, dueDate, lines, total: tot.total });
          if (errs.length) throw new ValidationError(errs);
          Object.assign(patch, { status: "confirmed", confirmedAt: nowIso(), confirmedBy: ctx.uid, paid: 0, paidState: paidStateOf(tot.total, 0) });
        }
        txUpdate(tx, ctx, C.invoices, cur, v._version === null || v._version === undefined ? null : Number(v._version), patch);
        audit(tx, ctx, intent === "confirm" ? "invoice.confirm" : "invoice.update", C.invoices, id, { total: tot.total, lines: lines.length });
      });
      return { redirect: `/billing/invoices/${id}` };
    }

    const kind = str(v.kind) === "initial" ? "initial" : "one_time";
    const contractId = optStr(v.contractId);
    const contract = contractId ? await getDoc<Contract>(ctx, C.contracts, contractId) : null;
    if (contractId && !contract) throw new ValidationError(["契約が見つかりません"]);
    if (contract && !canAccessStore(ctx, contract.storeId)) throw new ValidationError(["この店舗の契約に請求する権限がありません"]);
    const unit = contract?.unitId ? await getDoc<Unit>(ctx, C.units, contract.unitId) : null;
    const period = periodIn ?? periodOf(issueDate);
    const lines = built.map((l) => toInvoiceLine(l, period));
    const tot = invoiceTotals(lines, settings.taxRounding ?? "floor");
    if (intent === "confirm") {
      const errs = confirmErrors({ billToPartyId, dueDate, lines, total: tot.total });
      if (errs.length) throw new ValidationError(errs);
    }
    const newId = await runOnce(ctx, str(v._requestId), async (tx) => {
      await txAssertPeriodsOpen(tx, ctx, [period], "請求の作成");
      const number = await txNextNumber(tx, ctx, "invoice", "INV-");
      const data: Omit<Invoice, keyof BaseDoc> = {
        number, kind, status: intent === "confirm" ? "confirmed" : "draft",
        billToPartyId, billToName: party.name,
        contractId: contract?.id ?? null, unitId: contract?.unitId ?? null, propertyId: unit?.propertyId ?? contract?.propertyIds?.[0] ?? null,
        storeId: contract?.storeId ?? null, period, issueDate, dueDate, lines,
        subtotal: tot.subtotal, tax: tot.tax, total: tot.total, paid: 0, paidState: paidStateOf(tot.total, 0),
        confirmedAt: intent === "confirm" ? nowIso() : null, confirmedBy: intent === "confirm" ? ctx.uid : null,
        cancelOf: null, correctedBy: null, cancelReason: null,
        payerKana: [party.kana, party.name].filter((x): x is string => !!x),
        keywords: keywords(number, party.name, party.kana, contract?.number, contract?.title, period),
      };
      const nid = txCreate(tx, ctx, C.invoices, data);
      audit(tx, ctx, intent === "confirm" ? "invoice.create_confirm" : "invoice.create", C.invoices, nid, { number, kind, total: tot.total });
      return nid;
    });
    return { redirect: `/billing/invoices/${newId}` };
  });
}

/** 下書き請求（月次作成分など）の確定。確定後は金額を書き換えない */
export async function confirmInvoice(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("billing.confirm");
    const id = str(input.id);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const inv = await txGet<Invoice>(tx, ctx, C.invoices, id);
      if (inv.status !== "draft") throw new ValidationError(["下書きの請求だけ確定できます"]);
      if (!canAccessStore(ctx, inv.storeId)) throw new ValidationError(["この店舗の請求を確定する権限がありません"]);
      const errs = confirmErrors(inv);
      if (errs.length) throw new ValidationError(errs);
      await txAssertPeriodsOpen(tx, ctx, [inv.period], "請求の確定");
      txUpdate(tx, ctx, C.invoices, inv, null, { status: "confirmed", confirmedAt: nowIso(), confirmedBy: ctx.uid, paid: 0, paidState: paidStateOf(inv.total, 0) });
      audit(tx, ctx, "invoice.confirm", C.invoices, id, { total: inv.total });
      return null;
    });
    return null;
  });
}

/** 一括確定（月次作成後の下書き） */
export async function confirmInvoices(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  for (const id of ids.slice(0, 100)) {
    const r = await confirmInvoice({ id, _requestId: `confirm_${id}` });
    if (!r.ok) return { ok: false, error: `${r.errors?.join(" / ") ?? r.error}` };
  }
  return { ok: true };
}

/**
 * 取消（B16）。下書きは取消状態にするだけ。確定済みは取消記録（kind=cancellation）を作成し、元請求を取消にする。
 * 入金配分がある場合は影響の確認（acknowledge）を必須とし、同じトランザクションで配分を取り消す（入金は未配分額に戻る）。
 * 精算済みの配分がある場合は取消できない（B19）。
 */
export async function cancelInvoice(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("billing.confirm");
    const id = str(input.id);
    const reason = str(input.reason);
    if (!reason) throw new ValidationError(["取消の理由を入力してください"]);
    const ack = input.acknowledge === true || input.acknowledge === "true";
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const inv = await txGet<Invoice>(tx, ctx, C.invoices, id);
      if (inv.status === "cancelled") throw new ValidationError(["既に取消済みです"]);
      if (inv.kind === "cancellation") throw new ValidationError(["取消記録は取り消せません"]);
      if (!canAccessStore(ctx, inv.storeId)) throw new ValidationError(["この店舗の請求を取り消す権限がありません"]);
      if (inv.status === "draft") {
        await txAssertPeriodsOpen(tx, ctx, [inv.period], "請求の取消");
        txUpdate(tx, ctx, C.invoices, inv, null, { status: "cancelled", cancelReason: reason });
        audit(tx, ctx, "invoice.cancel_draft", C.invoices, id, { reason });
        return null;
      }
      const allocSnap = await tx.get(col(ctx.companyId, C.allocations).where("invoiceId", "==", id).where("reversed", "==", false));
      const allocs = allocSnap.docs.map((d) => ({ ...(d.data() as Allocation), id: d.id })).filter((a) => a.companyId === ctx.companyId);
      if (allocs.some((a) => a.settlementId)) throw new ValidationError(["オーナー精算に含まれた入金配分があるため取消できません。精算の訂正を先に行ってください"]);
      const allocTotal = allocs.reduce((s, a) => s + a.amount, 0);
      if (allocs.length && !ack) {
        throw new ValidationError([`この請求には ${allocs.length}件・${allocTotal.toLocaleString()}円の入金配分があります。取消すると配分も取り消され、入金は未配分額に戻ります。影響を確認のうえ実行してください。`]);
      }
      const payIds = [...new Set(allocs.map((a) => a.paymentId))];
      const paySnaps = payIds.length ? await tx.getAll(...payIds.map((p) => col(ctx.companyId, C.payments).doc(p))) : [];
      const payments = new Map(paySnaps.filter((s) => s.exists).map((s) => [s.id, { ...(s.data() as Payment), id: s.id }]));
      await txAssertPeriodsOpen(tx, ctx, [inv.period, todayJst().slice(0, 7)], "請求の取消");
      const number = await txNextNumber(tx, ctx, "invoice", "INV-");
      // ── 書込み ──
      const at = nowIso();
      for (const a of allocs) {
        txUpdate(tx, ctx, C.allocations, a, null, { reversed: true, reversedBy: ctx.uid, reversedAt: at, reason: `請求取消: ${reason}` });
      }
      for (const [pid, p] of payments) {
        const minus = allocs.filter((a) => a.paymentId === pid).reduce((s, a) => s + a.amount, 0);
        const allocated = p.allocated - minus;
        txUpdate(tx, ctx, C.payments, p, null, { allocated, status: paymentStatusOf({ ...p, allocated }) });
      }
      const negLines: InvoiceLine[] = inv.lines.map((l) => ({
        ...l,
        unitPrice: l.unitPrice.startsWith("-") ? l.unitPrice.slice(1) : `-${l.unitPrice}`,
        amount: -l.amount,
        formula: `取消（元請求 ${inv.number}）`,
        dedupeKey: null,
        adjustsInvoiceId: inv.id,
      }));
      const cancelId = txCreate(tx, ctx, C.invoices, {
        number, kind: "cancellation", status: "confirmed", billToPartyId: inv.billToPartyId, billToName: inv.billToName,
        contractId: inv.contractId, unitId: inv.unitId, propertyId: inv.propertyId, storeId: inv.storeId, period: inv.period,
        issueDate: todayJst(), dueDate: null, lines: negLines, subtotal: -inv.subtotal, tax: -inv.tax, total: -inv.total,
        paid: 0, paidState: "full", confirmedAt: at, confirmedBy: ctx.uid, cancelOf: inv.id, correctedBy: null, cancelReason: reason,
        payerKana: [], keywords: keywords(number, inv.number, inv.billToName),
      } satisfies Omit<Invoice, keyof BaseDoc>);
      txUpdate(tx, ctx, C.invoices, inv, null, { status: "cancelled", cancelReason: reason, correctedBy: cancelId, paid: 0, paidState: "none" });
      audit(tx, ctx, "invoice.cancel", C.invoices, id, { reason, cancellationId: cancelId, reversedAllocations: allocs.map((a) => ({ id: a.id, amount: a.amount })) });
      return null;
    });
    return null;
  });
}

/**
 * 訂正（B16）: 元請求は変更せず、訂正後の明細との差額明細を持つ差額調整請求（下書き）を作成する。
 * 入金配分がある場合は影響の確認を必須とする。
 */
export async function createAdjustment(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("billing.confirm");
    const id = str(v.id);
    const settings = await companySettings(ctx.companyId);
    const fe: Record<string, string> = {};
    const reason = str(v.reason);
    if (!reason) fe.reason = "訂正の理由を入力してください";
    const period = str(v.period) || todayJst().slice(0, 7);
    if (!isValidPeriod(period)) fe.period = "計上月は YYYY-MM 形式で入力してください";
    const dueDate = optStr(v.dueDate);
    if (dueDate && !isValidBizDate(dueDate)) fe.dueDate = "支払期限の日付が正しくありません";
    const { lines: corrected, errors } = buildLines(parseLineInput(v.lines), settings.lineRounding ?? "floor", { allowNegative: true });
    if (errors.length) fe.lines = errors.join(" / ");
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const ack = v.acknowledge === true || v.acknowledge === "on" || v.acknowledge === "true";
    const newId = await runOnce(ctx, str(v._requestId), async (tx) => {
      const inv = await txGet<Invoice>(tx, ctx, C.invoices, id);
      if (inv.status !== "confirmed" || !["monthly", "initial", "one_time", "adjustment"].includes(inv.kind)) {
        throw new ValidationError(["確定済みの請求だけ訂正できます（下書きはそのまま編集してください）"]);
      }
      if (!canAccessStore(ctx, inv.storeId)) throw new ValidationError(["この店舗の請求を訂正する権限がありません"]);
      const diffs = differenceLines(inv.lines, corrected);
      if (!diffs.length) throw new ValidationError(["元の請求から変更された明細がありません"]);
      if (inv.paid > 0 && !ack) {
        throw new ValidationError([`この請求には ${inv.paid.toLocaleString()}円の入金配分があります。配分への影響（減額で過入金になる場合は配分の取消・返金指定が必要）を確認し、「影響を確認しました」にチェックしてください。`]);
      }
      await txAssertPeriodsOpen(tx, ctx, [period], "訂正の作成");
      const number = await txNextNumber(tx, ctx, "invoice", "INV-");
      const lines: InvoiceLine[] = diffs.map((d) => ({
        itemCode: d.itemCode, name: `${d.name}（訂正差額）`, quantity: "1", unitPrice: String(d.amount), amount: d.amount, tax: d.tax,
        period, from: null, to: null, formula: `訂正: ${d.before.toLocaleString()}円 → ${d.after.toLocaleString()}円（差額 ${d.amount.toLocaleString()}円）`,
        dedupeKey: null, contractVersionId: null, adjustsInvoiceId: inv.id,
      }));
      const tot = invoiceTotals(lines, settings.taxRounding ?? "floor");
      const adjId = txCreate(tx, ctx, C.invoices, {
        number, kind: "adjustment", status: "draft", billToPartyId: inv.billToPartyId, billToName: inv.billToName,
        contractId: inv.contractId, unitId: inv.unitId, propertyId: inv.propertyId, storeId: inv.storeId, period,
        issueDate: todayJst(), dueDate: dueDate ?? inv.dueDate, lines, subtotal: tot.subtotal, tax: tot.tax, total: tot.total,
        paid: 0, paidState: paidStateOf(tot.total, 0), confirmedAt: null, confirmedBy: null, cancelOf: inv.id, correctedBy: null, cancelReason: reason,
        payerKana: inv.payerKana, keywords: keywords(number, inv.number, inv.billToName, period),
      } satisfies Omit<Invoice, keyof BaseDoc>);
      txUpdate(tx, ctx, C.invoices, inv, null, { correctedBy: adjId });
      audit(tx, ctx, "invoice.adjustment", C.invoices, inv.id, { adjustmentId: adjId, reason, diffs: diffs.map((d) => ({ item: d.itemCode, before: d.before, after: d.after })) });
      return adjId;
    });
    return { redirect: `/billing/invoices/${newId}` };
  });
}

// ───────────── 月次請求 ─────────────

export async function runMonthlyBilling(input: Record<string, unknown>): Promise<ActionResult<{ created: number; existing: number; invoices: number; skipped: number }>> {
  return run(async () => {
    const ctx = await requireStaff("billing.write");
    const period = str(input.period);
    const contractIds = Array.isArray(input.contractIds) ? (input.contractIds as unknown[]).map(str).filter(Boolean) : undefined;
    const r = await generateMonthlyInvoices(ctx, period, { contractIds });
    return { created: r.created, existing: r.existing, invoices: r.invoiceIds.length, skipped: r.skipped.length };
  });
}

/** B05: 契約変更後の再計算（下書きのみ） */
export async function recalcInvoices(input: Record<string, unknown>): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const ctx = await requireStaff("billing.write");
    const ids = (Array.isArray(input.ids) ? input.ids : [input.id]).map(str).filter(Boolean).slice(0, 100);
    if (!ids.length) throw new ValidationError(["再計算する請求を選択してください"]);
    let count = 0;
    for (const id of ids) {
      await recalcDraftInvoice(ctx, id);
      count++;
    }
    return { count };
  });
}

/** 請求先・オーナーの検索（名称・読み・顧客番号） */
export async function searchPartiesForBilling(input: { q: string }): Promise<ActionResult<{ value: string; label: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff();
    if (!ctx.caps.has("billing.write") && !ctx.caps.has("settlement.write")) throw new ValidationError(["権限がありません"]);
    const q = str(input.q);
    if (!q) return [];
    const page = await listDocs<Party>(ctx, C.parties, { search: q, pageSize: 25, orderBy: "updatedAt" });
    return page.items.map((p) => ({ value: p.id, label: `${p.name}${p.kana ? `（${p.kana}）` : ""} ${p.number ?? ""}`.trim() }));
  });
}
