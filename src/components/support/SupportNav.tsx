import Link from "next/link";

/** 問い合わせ・修繕の切替 */
export function SupportNav({ current }: { current: "inquiries" | "repairs" }) {
  const items = [
    { key: "inquiries", href: "/support", label: "問い合わせ" },
    { key: "repairs", href: "/support/repairs", label: "修繕案件" },
  ];
  return (
    <nav className="mb-4 flex gap-1 border-b border-line" aria-label="問い合わせ・修繕">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${i.key === current ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"}`}
          aria-current={i.key === current ? "page" : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Timeline({
  items,
}: {
  items: { id: string; at: string; channel: string; direction: string; summary: string; body: string | null; by: string }[];
}) {
  if (!items.length) return <p className="py-4 text-sm text-muted">対応記録はまだありません</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((a) => (
        <li key={a.id}>
          <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-surface bg-primary" aria-hidden />
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{a.at}</span>
            <span className="rounded border border-line px-1.5 text-xs">{a.channel}</span>
            {a.direction !== "—" && <span className="text-xs">{a.direction}</span>}
            <span>記録: {a.by}</span>
          </div>
          <p className="mt-0.5 font-semibold break-words">{a.summary}</p>
          {a.body && <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{a.body}</p>}
        </li>
      ))}
    </ol>
  );
}
