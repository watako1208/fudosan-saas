"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea, MoneyField, CheckField, SubmitButton } from "@/components/EditForm";
import type { ActionResult } from "@/lib/server/action";
import { opts } from "@/lib/labels";
import {
  LEASE_TYPE, PAYMENT_TIMING, DEPOSIT_HOLDER, ROUNDING, DEADLINE_UNIT, HOLIDAY_ADJUST, BROKERAGE_METHOD, TAX_CATEGORY, PRICE_MODE,
  LEASE_PARTY_ROLES, SALE_PARTY_ROLES,
} from "@/lib/labels-contracts";
import { PartiesEditor } from "./PartiesEditor";
import { MonthlyItemsEditor, InitialItemsEditor, ItemTypeOption } from "./ItemsEditors";
import { UnitField, PropertiesField } from "./RefPickers";

type Opt = { value: string; label: string };

function DeadlineRuleFields({ prefix, title }: { prefix: string; title: string }) {
  return (
    <>
      <TextField name={`${prefix}Amount`} label={`${title}（期間）`} inputMode="numeric" help="空欄の場合は期限を計算しません" />
      <SelectField name={`${prefix}Unit`} label="単位（契約終了日から）" options={opts(DEADLINE_UNIT)} allowEmpty={false} />
      <SelectField name={`${prefix}Holiday`} label="休日の調整" options={opts(HOLIDAY_ADJUST)} allowEmpty={false} />
    </>
  );
}

function BrokerageSection({ billTo }: { billTo: Opt[] }) {
  return (
    <FormSection title="仲介手数料" desc="計算方法・料率・請求先を記録します。">
      <SelectField name="brokerageMethod" label="計算方法" options={opts(BROKERAGE_METHOD)} emptyLabel="設定しない" />
      <TextField name="brokerageRate" label="料率" inputMode="decimal" help="小数で入力（3% → 0.03、賃料1か月分 → 1.0）" />
      <MoneyField name="brokerageFixed" label="定額（定額方式の場合）" />
      <MoneyField name="brokeragePlus" label="加算額" help="料率に加算する金額（任意）" />
      <SelectField name="brokerageTaxCategory" label="税区分" options={opts(TAX_CATEGORY)} allowEmpty={false} />
      <TextField name="brokerageTaxRate" label="税率" inputMode="decimal" help="10% → 0.10" />
      <SelectField name="brokeragePriceMode" label="金額の扱い" options={opts(PRICE_MODE)} allowEmpty={false} />
      <SelectField name="brokerageBillTo" label="請求先" options={billTo} emptyLabel="未設定" />
    </FormSection>
  );
}

export function ContractForm({
  kind,
  mode,
  action,
  initial,
  version,
  contractVersion,
  cancelHref,
  staff,
  itemTypes,
  unitLabel,
  propertyLabels,
  canApprove,
}: {
  kind: "lease" | "sale";
  mode: "initial" | "change";
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version: number;
  contractVersion: number;
  cancelHref: string;
  staff: Opt[];
  itemTypes: ItemTypeOption[];
  unitLabel: string | null;
  propertyLabels: Record<string, string>;
  canApprove: boolean;
}) {
  const buttons: SubmitButton[] =
    mode === "initial"
      ? [
          { label: "下書き保存", intent: "draft" },
          { label: "保存して社内確認へ提出", intent: "submit", primary: true, confirm: "入力内容を検証し、社内確認（社内承認の依頼）へ提出します。よろしいですか？" },
        ]
      : [
          { label: "下書き保存", intent: "draft", primary: !canApprove },
          ...(canApprove
            ? [{ label: "条件変更を確定", intent: "confirm", primary: true, confirm: "この版を確定します。前の版は変更開始日の前日で適用終了となります。確定後は変更できません。よろしいですか？" }]
            : []),
        ];

  return (
    <EditForm
      action={action}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      buttons={buttons}
      fieldLabels={{ title: "件名", start: "開始日", end: "終了日", depositAmount: "敷金", salePrice: "売買代金", specialTerms: "特約" }}
    >
      <input type="hidden" name="_contractVersion" defaultValue={contractVersion} />
      {mode === "change" && (
        <FormSection title="条件変更" desc="変更開始日から新しい条件を適用します。確定済みの請求や発行済みの書類は変更されません。">
          <TextField name="effectiveFrom" label="変更開始日" type="date" required />
          <TextArea name="changeReason" label="変更理由" required rows={2} className="sm:col-span-2" />
        </FormSection>
      )}
      {kind === "lease" ? (
        <>
          <FormSection title="基本条件">
            <TextField name="title" label="件名" required className="sm:col-span-2" />
            <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
            <UnitField initialLabel={unitLabel} disabled={mode === "change"} />
            <SelectField name="leaseType" label="契約種別" options={opts(LEASE_TYPE)} />
            <TextField name="start" label="契約開始日" type="date" />
            <TextField name="end" label="契約終了日" type="date" help="開始日・終了日とも当日を含みます" />
            <TextField name="paymentDueDay" label="毎月の支払期日（日）" inputMode="numeric" placeholder="例: 27" />
            <SelectField name="paymentTiming" label="支払時期" options={opts(PAYMENT_TIMING)} allowEmpty={false} />
            <SelectField name="rounding" label="金額の円未満の扱い" options={opts(ROUNDING)} allowEmpty={false} />
          </FormSection>
          <FormSection title="当事者" desc="貸主・借主・連帯保証人・入居者を登録します">
            <PartiesEditor roles={LEASE_PARTY_ROLES} />
          </FormSection>
          <FormSection title="月額費用" desc="費目ごとに税区分と日割り方法を設定し、この契約条件に保存します">
            <MonthlyItemsEditor itemTypes={itemTypes} />
          </FormSection>
          <FormSection title="初期費用・敷金">
            <InitialItemsEditor itemTypes={itemTypes} />
            <MoneyField name="depositAmount" label="敷金（預り金）" help="家賃収入とは区別して預り金として管理します" />
            <SelectField name="depositHolder" label="敷金の保管主体" options={opts(DEPOSIT_HOLDER)} help="貸主が保管する敷金は自社の現金残高に含めません" />
          </FormSection>
          <BrokerageSection billTo={[{ value: "lessee", label: "借主" }, { value: "lessor", label: "貸主" }, { value: "both", label: "借主・貸主" }]} />
          <FormSection title="更新・解約" desc="期限の計算ルールはこの契約条件に保存します（会社設定を変更しても、この契約の期限は変わりません）">
            <TextField name="renewalTermMonths" label="更新後の期間（か月）" inputMode="numeric" placeholder="例: 24" />
            <MoneyField name="renewalFee" label="更新料" />
            <div className="hidden lg:block" />
            <DeadlineRuleFields prefix="renewalNotice" title="更新案内の期限" />
            <DeadlineRuleFields prefix="terminationNotice" title="解約予告の期限" />
          </FormSection>
        </>
      ) : (
        <>
          <FormSection title="基本条件">
            <TextField name="title" label="件名" required className="sm:col-span-2" />
            <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
            <TextField name="contractDate" label="契約日" type="date" />
            <TextField name="settlementDate" label="決済予定日" type="date" />
            <TextField name="deliveryDate" label="引渡日" type="date" />
            <SelectField name="rounding" label="金額の円未満の扱い" options={opts(ROUNDING)} allowEmpty={false} />
          </FormSection>
          <FormSection title="対象の土地・建物">
            <PropertiesField initialLabels={propertyLabels} />
          </FormSection>
          <FormSection title="当事者" desc="売主・買主（代理人がいる場合は代理人）を登録します">
            <PartiesEditor roles={SALE_PARTY_ROLES} />
          </FormSection>
          <FormSection title="売買代金">
            <MoneyField name="salePrice" label="売買代金" />
            <MoneyField name="earnestMoney" label="手付金" />
            <MoneyField name="balanceAmount" label="残代金" help="手付金＋残代金＝売買代金を確定時に検証します" />
          </FormSection>
          <FormSection title="融資条件" desc="保存時に「融資承認期限」「決済必要書類の提出確認」「決済準備」のタスクを作成・更新します">
            <MoneyField name="loanAmount" label="融資額" />
            <TextField name="loanDeadline" label="融資承認期限" type="date" />
            <TextField name="loanLender" label="金融機関" />
            <CheckField name="loanContingent" label="融資特約あり（融資不成立時の解除）" />
          </FormSection>
          <BrokerageSection billTo={[{ value: "buyer", label: "買主" }, { value: "seller", label: "売主" }, { value: "both", label: "売主・買主" }]} />
        </>
      )}
      <FormSection title="特約・書類">
        <TextArea name="specialTerms" label="特約" rows={6} className="sm:col-span-2 lg:col-span-3" />
        <CheckField name="documentsChecked" label="契約書類（重要事項説明・契約書の内容）を確認済み" help="確定（社内確認への提出）には確認済みが必要です" />
      </FormSection>
    </EditForm>
  );
}
