"use server";
import { adminDb, adminBucket } from "../firebase-admin";
import { requireStaff } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, runOnce, getDoc, mustGet, col, ref, nowIso, findDocs, BaseDoc } from "../repo";
import { storeUpload } from "../attachments";
import { C, Allocation, Attachment, ImportBatch, Invoice, Payment } from "@/lib/types";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";
import { validateAllocations } from "@/lib/domain/rules";
import { decodeCsv, parseCsv, normalizePaymentRow, paymentFingerprint, CsvEncoding } from "@/lib/domain/csv";
import {
  allocatableOf, duplicateCandidates, guessPaymentMapping, isoToJstDate, mergeAllocationRequests, paidStateOf, paymentStatusOf, periodOf, splitAllocationByLines,
} from "@/lib/domain/billing";
import { txAssertPeriodsOpen } from "../jobs/billing";

// S17 入金: 手入力・CSV取込み・照合・配分（消込）。
// 配分は1つのトランザクションで入金と対象請求を読み直して検証するため、同時に配分しても金額を二重利用できない（T15）。

// ───────────── 手入力 ─────────────

export async function savePayment(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("payment.write");
    const fe: Record<string, string> = {};
    const id = optStr(v.id);
    const date = str(v.date);
    if (!isValidBizDate(date)) fe.date = "入金日を正しく入力してください";
    const amount = optYen(v.amount, "amount", fe);
    if (amount === null && !fe.amount) fe.amount = "金額を入力してください";
    else if (amount !== null && amount <= 0) fe.amount = "金額は1円以上で入力してください";
    const payerName = str(v.payerName);
    if (!payerName) fe.payerName = "名義を入力してください";
    const reference = optStr(v.reference);
    const account = optStr(v.account);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const fingerprint = paymentFingerprint({ date, amount: amount!, payerName, reference: reference ?? "" });
    const data = { date, amount: amount!, payerName, reference, account, fingerprint, keywords: keywords(payerName, reference, account, String(amount)) };
    if (id) {
      await adminDb().runTransaction(async (tx) => {
        const cur = await txGet<Payment>(tx, ctx, C.payments, id);
        if (cur.allocated > 0 && (cur.amount !== data.amount || cur.date !== data.date)) {
          throw new ValidationError(["配分済みの入金は入金日・金額を変更できません。先に配分を取り消してください"]);
        }
        if (data.amount < cur.allocated) throw new ValidationError(["配分済み額より小さい金額にはできません"]);
        await txAssertPeriodsOpen(tx, ctx, [periodOf(cur.date), periodOf(date)], "入金の編集");
        txUpdate(tx, ctx, C.payments, cur, v._version === null || v._version === undefined ? null : Number(v._version), {
          ...data,
          status: paymentStatusOf({ ...cur, amount: data.amount }),
        });
        audit(tx, ctx, "payment.update", C.payments, id, data);
      });
      return { redirect: `/billing/payments/${id}` };
    }
    const newId = await runOnce(ctx, str(v._requestId), async (tx) => {
      await txAssertPeriodsOpen(tx, ctx, [periodOf(date)], "入金の登録");
      const nid = txCreate(tx, ctx, C.payments, {
        ...data, source: "manual", importBatchId: null, rowNo: null, allocated: 0, unallocatedDisposition: null, status: "unallocated",
      } satisfies Omit<Payment, keyof BaseDoc>);
      audit(tx, ctx, "payment.create", C.payments, nid, { date, amount, source: "manual" });
      return nid;
    });
    return { redirect: `/billing/payments/${newId}` };
  });
}

/** 誤登録の入金をアーカイブ（配分がない場合のみ。削除はしない） */
export async function archivePayment(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("payment.write");
    const id = str(input.id);
    const reason = str(input.reason);
    if (!reason) throw new ValidationError(["理由を入力してください"]);
    await adminDb().runTransaction(async (tx) => {
      const p = await txGet<Payment>(tx, ctx, C.payments, id);
      if (p.allocated > 0) throw new ValidationError(["配分済みの入金はアーカイブできません。先に配分を取り消してください"]);
      await txAssertPeriodsOpen(tx, ctx, [periodOf(p.date)], "入金の取消");
      txUpdate(tx, ctx, C.payments, p, null, { archived: !p.archived, archiveReason: reason });
      audit(tx, ctx, p.archived ? "payment.unarchive" : "payment.archive", C.payments, id, { reason });
    });
    return { redirect: "/billing/payments" };
  });
}

// ───────────── 配分（消込） ─────────────

/**
 * B13/B14/T07/T15: 1つの入金を複数の請求へ配分する。
 * 入金と全対象請求をトランザクション内で読み直し、最新値で validateAllocations を行う。
 */
export async function allocatePayment(input: Record<string, unknown>): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const ctx = await requireStaff("payment.confirm");
    const paymentId = str(input.paymentId);
    let raw: unknown;
    try {
      raw = typeof input.items === "string" ? JSON.parse(input.items) : input.items;
    } catch {
      throw new ValidationError(["配分の入力内容を読み取れません"]);
    }
    if (!Array.isArray(raw)) throw new ValidationError(["配分先を指定してください"]);
    const reqs = (raw as { invoiceId: unknown; amount: unknown }[])
      .map((r) => ({ invoiceId: str(r.invoiceId), amount: Number(str(r.amount).normalize("NFKC").replace(/[,¥円]/g, "")) }))
      .filter((r) => r.invoiceId && str(r.amount) !== "0" && !Number.isNaN(r.amount));
    if (!reqs.length) throw new ValidationError(["配分する請求と金額を入力してください"]);
    if (reqs.length > 50) throw new ValidationError(["一度に配分できるのは50件までです"]);
    const merged = mergeAllocationRequests(reqs);
    const count = await runOnce(ctx, str(input._requestId), async (tx) => {
      const p = await txGet<Payment>(tx, ctx, C.payments, paymentId);
      if (p.archived) throw new ValidationError(["アーカイブ済みの入金には配分できません"]);
      const snaps = await tx.getAll(...merged.map((m) => ref(ctx, C.invoices, m.invoiceId)));
      const invs = new Map<string, Invoice>();
      for (const s of snaps) if (s.exists && s.data()!.companyId === ctx.companyId) invs.set(s.id, { ...(s.data() as Invoice), id: s.id });
      await txAssertPeriodsOpen(tx, ctx, [todayJst().slice(0, 7)], "入金配分");
      const refund = p.unallocatedDisposition?.kind === "refund" ? p.unallocatedDisposition.amount : 0;
      const errs = validateAllocations(
        { amount: p.amount - refund, allocated: p.allocated },
        reqs,
        new Map([...invs].map(([id, i]) => [id, { status: i.status, total: i.total, paid: i.paid, companyMatch: true }])),
      );
      if (refund && errs.length) errs.push(`返金指定 ${refund.toLocaleString()}円は配分できません`);
      if (errs.length) throw new ValidationError([...new Set(errs)]);
      // ── 書込み ──
      const at = nowIso();
      let sum = 0;
      for (const m of merged) {
        const inv = invs.get(m.invoiceId)!;
        sum += m.amount;
        const aid = txCreate(tx, ctx, C.allocations, {
          paymentId: p.id, invoiceId: inv.id, amount: m.amount, allocatedAt: at, allocatedBy: ctx.uid, reversed: false, reversedBy: null, reason: null,
          settlementId: null, propertyId: inv.propertyId, contractId: inv.contractId,
          itemBreakdown: splitAllocationByLines(m.amount, inv.lines), paymentDate: p.date,
        } satisfies Omit<Allocation, keyof BaseDoc>);
        const paid = inv.paid + m.amount;
        txUpdate(tx, ctx, C.invoices, inv, null, { paid, paidState: paidStateOf(inv.total, paid) });
        audit(tx, ctx, "allocation.create", C.allocations, aid, { paymentId: p.id, invoiceId: inv.id, invoiceNumber: inv.number, amount: m.amount });
      }
      const allocated = p.allocated + sum;
      txUpdate(tx, ctx, C.payments, p, null, { allocated, status: paymentStatusOf({ ...p, allocated }) });
      return merged.length;
    });
    return { count };
  });
}

/** 配分の取消（理由必須）。精算に含まれた配分は取り消せない（B19） */
export async function reverseAllocation(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("payment.confirm");
    const id = str(input.id);
    const reason = str(input.reason);
    if (!reason) throw new ValidationError(["取消の理由を入力してください"]);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const a = await txGet<Allocation>(tx, ctx, C.allocations, id);
      if (a.reversed) throw new ValidationError(["既に取り消されています"]);
      if (a.settlementId) throw new ValidationError(["オーナー精算に含まれた配分は取り消せません。精算の訂正で調整してください"]);
      const p = await txGet<Payment>(tx, ctx, C.payments, a.paymentId);
      const inv = await txGet<Invoice>(tx, ctx, C.invoices, a.invoiceId);
      await txAssertPeriodsOpen(tx, ctx, [isoToJstDate(a.allocatedAt).slice(0, 7), todayJst().slice(0, 7)], "配分の取消");
      txUpdate(tx, ctx, C.allocations, a, null, { reversed: true, reversedBy: ctx.uid, reversedAt: nowIso(), reason });
      const paid = inv.paid - a.amount;
      txUpdate(tx, ctx, C.invoices, inv, null, { paid, paidState: paidStateOf(inv.total, paid) });
      const allocated = p.allocated - a.amount;
      txUpdate(tx, ctx, C.payments, p, null, { allocated, status: paymentStatusOf({ ...p, allocated }) });
      audit(tx, ctx, "allocation.reverse", C.allocations, id, { reason, amount: a.amount, invoiceId: inv.id, paymentId: p.id });
      return null;
    });
    return null;
  });
}

/** T06: 過入金（未配分残高）の扱いを指定する。次月充当は残高を保持し後で配分、返金は配分不可にする */
export async function setDisposition(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("payment.confirm");
    const id = str(v.id);
    const kind = str(v.kind);
    const fe: Record<string, string> = {};
    if (kind !== "carry_forward" && kind !== "refund" && kind !== "clear") fe.kind = "扱いを選択してください";
    const amount = kind === "clear" ? 0 : optYen(v.amount, "amount", fe);
    if (kind !== "clear" && (amount === null || amount <= 0) && !fe.amount) fe.amount = "金額を入力してください";
    const note = optStr(v.note);
    if (kind === "refund" && !note) fe.note = "返金の方法・予定日などを記録してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const p = await txGet<Payment>(tx, ctx, C.payments, id);
      const base = { ...p, unallocatedDisposition: null };
      const free = allocatableOf(base);
      if (kind !== "clear" && amount! > free) throw new ValidationError([`未配分残高（${free.toLocaleString()}円）を超えています`]);
      const disp = kind === "clear" ? null : { kind: kind as "carry_forward" | "refund", amount: amount!, note, by: ctx.uid, at: nowIso() };
      txUpdate(tx, ctx, C.payments, p, v._version === undefined || v._version === null ? null : Number(v._version), {
        unallocatedDisposition: disp,
        status: paymentStatusOf({ ...p, unallocatedDisposition: disp }),
      });
      audit(tx, ctx, "payment.disposition", C.payments, id, { kind, amount, note });
    });
    return null;
  });
}

// ───────────── CSV取込み ─────────────

export type PaymentImportBatch = ImportBatch & {
  headers: string[];
  attachmentId: string | null;
  validated: { rowNo: number; date: string; amount: number; payerName: string; reference: string; account: string; fingerprint: string }[];
  sameFileDuplicates: Record<string, number[]>;
  results: { created: number; skipped: number; existed: number } | null;
};

const MAX_BYTES = 500 * 1024;
const MAX_ROWS = 2000;

/** 手順1: アップロード（文字コードは自動判定。後で手動変更可） */
export async function uploadPaymentCsv(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("payment.write");
    const file = fd.get("file");
    if (!file || typeof file === "string") throw new ValidationError(["CSVファイルを選択してください"]);
    if (!/\.csv$/i.test(file.name)) throw new ValidationError(["CSVファイル（.csv）を選択してください"]);
    if (file.size > MAX_BYTES) throw new ValidationError([`ファイルが大きすぎます（${MAX_BYTES / 1024}KBまで）。分割して取り込んでください`]);
    const buf = new Uint8Array(await file.arrayBuffer());
    const encOverride = str(fd.get("encoding"));
    const { text, encoding } = decodeCsv(buf, encOverride === "utf-8" || encOverride === "shift_jis" ? (encOverride as CsvEncoding) : undefined);
    const { headers, rows } = parseCsv(text);
    if (!headers.length) throw new ValidationError(["CSVに見出し行がありません"]);
    if (rows.length > MAX_ROWS) throw new ValidationError([`行数が多すぎます（${MAX_ROWS}行まで）。分割して取り込んでください`]);
    const batchRef = col(ctx.companyId, C.importBatches).doc();
    const stored = await storeUpload(ctx, { file, entity: "import", entityId: batchRef.id, category: "取込元CSV", visibility: "internal", sensitive: false });
    if (!stored.ok) throw new ValidationError([stored.error]);
    const g = guessPaymentMapping(headers);
    const mapping: Record<string, number> = {};
    for (const [k, i] of Object.entries(g)) if (i !== undefined) mapping[k] = i;
    await adminDb().runTransaction(async (tx) => {
      txCreate(tx, ctx, C.importBatches, {
        kind: "payments", fileName: file.name.slice(0, 200), encoding, status: "uploaded", mapping,
        rows: rows.map((raw, i) => ({ rowNo: i + 1, raw: raw.map((c) => String(c).slice(0, 200)), action: "skip" as const, error: null, duplicateOf: [], resultId: null })),
        committedAt: null, headers, attachmentId: stored.id, validated: [], sameFileDuplicates: {}, results: null,
      } satisfies Omit<PaymentImportBatch, keyof BaseDoc>, batchRef.id);
      audit(tx, ctx, "import.upload", C.importBatches, batchRef.id, { fileName: file.name, encoding, rows: rows.length });
    });
    return { redirect: `/billing/payments/import/${batchRef.id}` };
  });
}

/** 手順2: 文字コード・列対応を確定し、各行を検証して重複候補を調べる */
export async function mapPaymentImport(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("payment.write");
    const id = str(v.id);
    const batch = await mustGet<PaymentImportBatch>(ctx, C.importBatches, id);
    if (batch.kind !== "payments") throw new ValidationError(["入金の取込みではありません"]);
    if (batch.status === "committed") throw new ValidationError(["取込み済みです"]);
    const fe: Record<string, string> = {};
    const idx = (k: string) => (str(v[k]) === "" ? undefined : Number(v[k]));
    const map = { date: idx("date"), amount: idx("amount"), payer: idx("payer"), reference: idx("reference"), account: idx("account") };
    if (map.date === undefined) fe.date = "入金日の列を選択してください";
    if (map.amount === undefined) fe.amount = "金額の列を選択してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);

    // 文字コードを変更した場合は原本から読み直す
    let headers = batch.headers;
    let rows = batch.rows.map((r) => r.raw);
    let encoding = batch.encoding;
    const enc = str(v.encoding);
    if ((enc === "utf-8" || enc === "shift_jis") && enc !== batch.encoding) {
      const att = batch.attachmentId ? await getDoc<Attachment>(ctx, C.attachments, batch.attachmentId) : null;
      if (!att || att.quarantined) throw new ValidationError(["原本ファイルを読み込めません。もう一度アップロードしてください"]);
      const [buf] = await adminBucket().file(att.storagePath).download();
      const parsed = parseCsv(decodeCsv(new Uint8Array(buf), enc).text);
      headers = parsed.headers;
      rows = parsed.rows;
      encoding = enc;
    }
    const m = { date: map.date!, amount: map.amount!, payer: map.payer, reference: map.reference, account: map.account };
    const validated: PaymentImportBatch["validated"] = [];
    const resultRows: ImportBatch["rows"] = rows.map((raw, i) => {
      const rowNo = i + 1;
      const r = normalizePaymentRow(raw, m);
      if (!r.ok) return { rowNo, raw: raw.map((c) => String(c).slice(0, 200)), action: "skip", error: r.error, duplicateOf: [], resultId: null };
      validated.push({ rowNo, ...r.value, fingerprint: paymentFingerprint(r.value) });
      return { rowNo, raw: raw.map((c) => String(c).slice(0, 200)), action: "create", error: null, duplicateOf: [], resultId: null };
    });
    // 重複候補（他の取込み・手入力の入金、同じファイル内）
    const fps = [...new Set(validated.map((x) => x.fingerprint))];
    const existing: { id: string; fingerprint: string; importBatchId: string | null }[] = [];
    for (let i = 0; i < fps.length; i += 30) {
      const found = await findDocs<Payment>(ctx, C.payments, [["fingerprint", "in", fps.slice(i, i + 30)]], 1000);
      existing.push(...found.filter((p) => !p.archived).map((p) => ({ id: p.id, fingerprint: p.fingerprint, importBatchId: p.importBatchId })));
    }
    const dup = duplicateCandidates(validated.map((x) => ({ rowNo: x.rowNo, fingerprint: x.fingerprint })), existing, id);
    const sameFileDuplicates: Record<string, number[]> = {};
    for (const r of resultRows) {
      const d = dup.get(r.rowNo);
      if (!d) continue;
      r.duplicateOf = d.otherIds;
      if (d.sameFileRows.length) sameFileDuplicates[String(r.rowNo)] = d.sameFileRows;
      // 別の取込み・手入力と一致する行は初期値を「取込まない」にする（担当者が変更可能）。同じファイル内の一致は正当な同日同額入金の可能性があるため取込む
      if (d.otherIds.length) r.action = "skip";
    }
    const mapping: Record<string, number> = {};
    for (const [k, i] of Object.entries(map)) if (i !== undefined) mapping[k] = i;
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<PaymentImportBatch>(tx, ctx, C.importBatches, id);
      if (cur.status === "committed") throw new ValidationError(["取込み済みです"]);
      txUpdate(tx, ctx, C.importBatches, cur, null, { headers, rows: resultRows, encoding, mapping, validated, sameFileDuplicates, status: "validated" });
      audit(tx, ctx, "import.validate", C.importBatches, id, { encoding, mapping, valid: validated.length, errors: resultRows.length - validated.length });
    });
    return null;
  });
}

/** 列対応からやり直す */
export async function resetPaymentImport(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("payment.write");
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<PaymentImportBatch>(tx, ctx, C.importBatches, str(input.id));
      if (cur.status === "committed") throw new ValidationError(["取込み済みです"]);
      txUpdate(tx, ctx, C.importBatches, cur, null, { status: "uploaded" });
    });
    return null;
  });
}

/**
 * 手順3: 確定。入金の docId = `${batchId}_${rowNo}` を tx.create で作成するため、
 * 同じ取込処理を再試行しても二重登録しない（T08）。行ごとの結果を保存する。
 */
export async function commitPaymentImport(input: Record<string, unknown>): Promise<ActionResult<{ created: number; skipped: number; existed: number }>> {
  return run(async () => {
    const ctx = await requireStaff("payment.write");
    const id = str(input.id);
    const batch = await mustGet<PaymentImportBatch>(ctx, C.importBatches, id);
    if (batch.status !== "validated" && batch.status !== "committed" && batch.status !== "failed") throw new ValidationError(["先に列対応と検証を行ってください"]);
    let actions: Record<string, string> = {};
    try {
      actions = typeof input.actions === "string" ? JSON.parse(input.actions) : ((input.actions as Record<string, string>) ?? {});
    } catch {
      throw new ValidationError(["取込み指定を読み取れません"]);
    }
    const valid = new Map(batch.validated.map((x) => [x.rowNo, x]));
    const rows = batch.rows.map((r) => {
      const a = batch.status === "committed" ? r.action : actions[String(r.rowNo)] ?? r.action;
      return { ...r, action: (r.error || !valid.has(r.rowNo) ? "skip" : a === "create" ? "create" : "skip") as "create" | "skip" };
    });
    const toCreate = rows.filter((r) => r.action === "create");
    const periods = [...new Set(toCreate.map((r) => valid.get(r.rowNo)!.date.slice(0, 7)))];
    let created = 0;
    let existed = 0;
    const resultIds = new Map<number, string>();
    try {
      for (let i = 0; i < toCreate.length; i += 150) {
        const part = toCreate.slice(i, i + 150);
        const r = await adminDb().runTransaction(async (tx) => {
          const refs = part.map((row) => ref(ctx, C.payments, `${id}_${row.rowNo}`));
          const snaps = await tx.getAll(...refs);
          await txAssertPeriodsOpen(tx, ctx, periods, "入金の取込み");
          let c = 0;
          let e = 0;
          part.forEach((row, k) => {
            const pid = `${id}_${row.rowNo}`;
            if (snaps[k].exists) {
              e++;
              return;
            }
            const val = valid.get(row.rowNo)!;
            txCreate(tx, ctx, C.payments, {
              date: val.date, amount: val.amount, payerName: val.payerName, reference: val.reference || null, account: val.account || null,
              source: "csv", importBatchId: id, rowNo: row.rowNo, fingerprint: val.fingerprint, allocated: 0, unallocatedDisposition: null,
              status: "unallocated", keywords: keywords(val.payerName, val.reference, val.account, String(val.amount)),
            } satisfies Omit<Payment, keyof BaseDoc>, pid);
            c++;
          });
          audit(tx, ctx, "import.commit_chunk", C.importBatches, id, { from: part[0].rowNo, to: part[part.length - 1].rowNo, created: c, existed: e });
          return { c, e };
        });
        created += r.c;
        existed += r.e;
        for (const row of part) resultIds.set(row.rowNo, `${id}_${row.rowNo}`);
      }
    } catch (e) {
      await col(ctx.companyId, C.importBatches).doc(id).update({ status: "failed", updatedAt: nowIso(), updatedBy: ctx.uid });
      throw e;
    }
    const results = { created, skipped: rows.length - toCreate.length, existed };
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<PaymentImportBatch>(tx, ctx, C.importBatches, id);
      txUpdate(tx, ctx, C.importBatches, cur, null, {
        status: "committed",
        committedAt: cur.committedAt ?? nowIso(),
        rows: rows.map((r) => ({ ...r, resultId: resultIds.get(r.rowNo) ?? null })),
        results,
      });
      audit(tx, ctx, "import.commit", C.importBatches, id, results);
    });
    return results;
  });
}
