import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { companyName } from "@/lib/server/lookups";
import { EXTERNAL_LABEL, ExternalKind } from "@/lib/permissions";
import { LogoutButton } from "@/components/portal/LogoutButton";

export const dynamic = "force-dynamic";

const NAV: Record<ExternalKind, { href: string; label: string }[]> = {
  customer: [
    { href: "/portal", label: "ホーム" },
    { href: "/portal/proposals", label: "ご提案" },
    { href: "/portal/documents", label: "書類" },
    { href: "/portal/uploads", label: "提出資料" },
  ],
  tenant: [
    { href: "/portal", label: "ホーム" },
    { href: "/portal/contracts", label: "ご契約" },
    { href: "/portal/inquiries", label: "問い合わせ・申請" },
    { href: "/portal/documents", label: "書類" },
  ],
  owner: [
    { href: "/portal", label: "ホーム" },
    { href: "/portal/settlements", label: "収支報告" },
    { href: "/portal/estimates", label: "見積の承認" },
    { href: "/portal/inquiries", label: "問い合わせ" },
    { href: "/portal/documents", label: "書類" },
  ],
  vendor: [
    { href: "/portal", label: "ホーム" },
    { href: "/portal/repairs", label: "依頼一覧" },
  ],
};

/** 外部利用者ページ（社内メニューは表示しない） */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await requireExternalPage();
  const kind = ctx.user.kind as ExternalKind;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <Link href="/portal" className="font-bold text-primary">{(await companyName(ctx.companyId)) || "お客様ページ"}</Link>
          <span className="text-sm text-muted">{EXTERNAL_LABEL[kind] ?? ""}向けページ</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="max-w-40 truncate">{ctx.user.displayName} 様</span>
            <LogoutButton />
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2" aria-label="メニュー">
          {(NAV[kind] ?? []).map((n) => (
            <Link key={n.href} href={n.href} className="rounded-t-md px-3 py-2 text-sm font-medium whitespace-nowrap text-ink hover:bg-bg">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
    </div>
  );
}
