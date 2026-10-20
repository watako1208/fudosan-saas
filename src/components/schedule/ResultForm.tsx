"use client";
import { EditForm, FormSection, TextArea } from "@/components/EditForm";
import type { ActionResult } from "@/lib/server/action";

export function ResultForm({
  action,
  initial,
  version,
  cancelHref,
  hasDeal,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version: number;
  cancelHref: string;
  hasDeal: boolean;
}) {
  return (
    <EditForm action={action} initial={initial} version={version} cancelHref={cancelHref} buttons={[{ label: "実施済みとして保存", intent: "save", primary: true }]}>
      <FormSection title="実施結果" desc={hasDeal ? "保存すると案件の対応記録にも残ります" : undefined}>
        <TextArea
          name="result"
          label="内容・顧客の反応・次の対応"
          required
          rows={8}
          className="sm:col-span-2 lg:col-span-3"
          help="例: 日当たり良好で好感触。駐輪場の空きを確認して連絡する。"
        />
      </FormSection>
    </EditForm>
  );
}
