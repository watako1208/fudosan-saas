import Link from "next/link";

const ITEMS = [
  { key: "invoices", href: "/billing", label: "請求" },
  { key: "monthly", href: "/billing/monthly", label: "月次請求作成" },
  { key: "payments", href: "/billing/payments", label: "入金" },
  { key: "import", href: "/billing/payments/import", label: "入金CSV取込み" },
  { key: "close", href: "/billing/close", label: "月次締め", admin: true },
  { key: "jobs", href: "/billing/jobs", label: "定期処理", admin: true },
];

/** 請求・入金の画面切替 */
export function BillingNav({ current, isAdmin }: { current: string; isAdmin: boolean }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="請求・入金メニュー">
      {ITEMS.filter((i) => !i.admin || isAdmin).map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${i.key === current ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"}`}
          aria-current={i.key === current ? "page" : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
