"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea, MoneyField } from "@/components/EditForm";
import { LISTING_STATUS, TRANSACTION_MODE, opts } from "@/lib/labels";
import type { ActionResult } from "@/lib/server/action";

export function ListingForm({
  action,
  initial,
  units,
  cancelHref,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  units: { value: string; label: string }[];
  cancelHref: string;
}) {
  return (
    <EditForm action={action} initial={initial} cancelHref={cancelHref} buttons={[{ label: "新しい版として保存", intent: "save", primary: true }]}>
      <input type="hidden" name="previousId" defaultValue={(initial.previousId as string) ?? ""} />
      <FormSection title="対象と状態">
        <SelectField name="unitId" label="対象区画" options={units} emptyLabel="物件全体（土地・戸建など）" />
        <SelectField name="dealType" label="賃貸・売買" required allowEmpty={false} options={[{ value: "rent", label: "賃貸" }, { value: "sale", label: "売買" }]} />
        <SelectField name="status" label="募集状態" required allowEmpty={false} options={opts(LISTING_STATUS)} />
        <TextField name="effectiveFrom" label="適用開始日" type="date" required />
        <TextField name="availableFrom" label="入居可能日・引渡可能日" type="date" />
        <SelectField name="transactionMode" label="取引態様" options={opts(TRANSACTION_MODE)} help="その取引で自社が売主・代理・仲介などどの立場か" />
      </FormSection>
      <FormSection title="賃料・価格">
        <MoneyField name="rent" label="賃料（月額）" />
        <MoneyField name="commonFee" label="共益費・管理費（月額）" />
        <MoneyField name="deposit" label="敷金" />
        <MoneyField name="keyMoney" label="礼金" />
        <MoneyField name="price" label="売買価格" />
      </FormSection>
      <FormSection title="掲載用コメント">
        <TextArea name="comment" label="コメント" className="sm:col-span-2 lg:col-span-3" help="自社の提案資料・共有ページに表示されます（外部ポータルへの自動掲載は行いません）" />
      </FormSection>
    </EditForm>
  );
}
