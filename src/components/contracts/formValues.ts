import type { Contract, ContractVersion, ItemTypeDoc } from "@/lib/types";
import type { ItemTypeOption } from "./ItemsEditors";
import { DEFAULT_ITEM_TYPES } from "@/lib/defaults";

/** 契約＋版 → 編集フォームの初期値（フォーム項目名に平坦化） */
export function versionToForm(c: Contract, v: ContractVersion): Record<string, unknown> {
  const bf = v.brokerageFee;
  return JSON.parse(
    JSON.stringify({
      title: c.title,
      assigneeUid: c.assigneeUid,
      unitId: c.unitId,
      propertyIds: c.propertyIds ?? [],
      depositHolder: c.depositHolder,
      parties: v.parties ?? [],
      leaseType: v.leaseType,
      start: v.start,
      end: v.end,
      rounding: v.rounding ?? "floor",
      paymentDueDay: v.paymentDueDay,
      paymentTiming: v.paymentTiming ?? "prev_month",
      depositAmount: v.depositAmount,
      monthlyItems: v.monthlyItems ?? [],
      initialItems: v.initialItems ?? [],
      renewalTermMonths: v.renewal?.termMonths ?? null,
      renewalFee: v.renewal?.fee ?? null,
      renewalNoticeAmount: v.renewal?.noticeRule?.amount ?? null,
      renewalNoticeUnit: v.renewal?.noticeRule?.unit ?? "months",
      renewalNoticeHoliday: v.renewal?.noticeRule?.holidayAdjust ?? "none",
      terminationNoticeAmount: v.termination?.noticeRule?.amount ?? null,
      terminationNoticeUnit: v.termination?.noticeRule?.unit ?? "months",
      terminationNoticeHoliday: v.termination?.noticeRule?.holidayAdjust ?? "none",
      brokerageMethod: bf?.method ?? "",
      brokerageRate: bf?.rate ?? null,
      brokerageFixed: bf?.fixed ?? null,
      brokeragePlus: bf?.plus ?? null,
      brokerageTaxCategory: bf?.tax.category ?? "taxable",
      brokerageTaxRate: bf?.tax.rate ?? "0.10",
      brokeragePriceMode: bf?.tax.priceMode ?? "exclusive",
      brokerageBillTo: bf?.billTo ?? "",
      specialTerms: v.specialTerms,
      documentsChecked: v.documentsChecked,
      salePrice: v.salePrice,
      earnestMoney: v.earnestMoney,
      balanceAmount: v.balanceAmount,
      contractDate: v.contractDate,
      settlementDate: v.settlementDate,
      deliveryDate: v.deliveryDate,
      loanAmount: v.loan?.amount ?? null,
      loanDeadline: v.loan?.deadline ?? null,
      loanLender: v.loan?.lender ?? null,
      loanContingent: v.loan?.contingent ?? false,
      effectiveFrom: v.effectiveFrom,
      changeReason: v.changeReason,
    }),
  );
}

/** 会社の費目設定（未設定なら初期費目）→ 画面用 */
export function itemTypeOptions(types: ItemTypeDoc[]): ItemTypeOption[] {
  const src: Pick<ItemTypeDoc, "code" | "name" | "kind" | "tax" | "proration">[] = types.length ? types : DEFAULT_ITEM_TYPES;
  return src.map((t) => ({ code: t.code, name: t.name, kind: t.kind, tax: t.tax, proration: t.proration }));
}
