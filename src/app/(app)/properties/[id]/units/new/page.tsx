import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { saveUnit } from "@/lib/server/actions/properties";
import { C, Property } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { UnitForm } from "../UnitForm";

export default async function NewUnit({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("property.write");
  const { id } = await params;
  const p = await getDoc<Property>(ctx, C.properties, id);
  if (!p) notFound();
  return (
    <>
      <PageHeader title="区画の追加" sub={`${p.number} ${p.name}`} />
      <UnitForm action={saveUnit.bind(null, id, null)} initial={{ usage: "residential", occupancy: "vacant", areas: [] }} cancelHref={`/properties/${id}?tab=units`} />
    </>
  );
}
