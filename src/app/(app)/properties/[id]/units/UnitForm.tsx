"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea } from "@/components/EditForm";
import { AreaEditor } from "@/components/AreaEditor";
import { USAGE, OCCUPANCY, LISTING_STATUS, opts } from "@/lib/labels";
import type { ActionResult } from "@/lib/server/action";

export function UnitForm({ action, initial, version, cancelHref }: { action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>; initial: Record<string, unknown>; version?: number; cancelHref: string }) {
  return (
    <EditForm action={action} initial={initial} version={version} cancelHref={cancelHref}>
      <FormSection title="区画">
        <TextField name="number" label="部屋番号・区画番号" required />
        <SelectField name="usage" label="用途" required options={opts(USAGE)} />
        <TextField name="layout" label="間取り" placeholder="例: 1LDK" />
        <TextField name="floor" label="階" inputMode="numeric" />
        <AreaEditor />
        <TextArea name="equipment" label="設備（読点・改行区切り）" rows={2} className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
      <FormSection title="入居状態と募集状態" desc="入居状態と募集状態は別々に管理します。退去予定の部屋は募集できます。">
        <SelectField name="occupancy" label="入居状態" required options={opts(OCCUPANCY)} allowEmpty={false} />
        <SelectField name="listingStatus" label="募集状態" options={opts(LISTING_STATUS)} emptyLabel="募集なし" />
        <TextField name="expectedVacancyDate" label="退去予定日" type="date" />
        <TextField name="availableFrom" label="入居可能日・募集予定" type="date" />
      </FormSection>
    </EditForm>
  );
}
