import Link from "next/link";
import { ReactNode } from "react";

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "bg-[#eef0f3] text-ink border-line",
  info: "bg-primary-soft text-primary border-primary/20",
  ok: "bg-ok-soft text-ok border-ok/20",
  warn: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-danger-soft text-danger border-danger/30",
};

/** 状態表示。色だけに依存せず必ず文字で状態名を表示する */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1>{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** 詳細画面上部: 名称・番号・状態・担当者・主操作を固定表示 */
export function DetailHeader({
  title,
  number,
  badges,
  meta,
  actions,
  back,
}: {
  title: ReactNode;
  number?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      {back && (
        <Link href={back.href} className="text-sm text-primary hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {number && <span className="text-sm text-muted">{number}</span>}
            {badges}
          </div>
          <h1 className="mt-0.5 break-words">{title}</h1>
          {meta && <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** タブ（URLの ?tab= で切替。直接リンク可能） */
export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string; count?: number }[] }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="タブ">
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={`${base}?tab=${t.key}`}
            scroll={false}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${
              active ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1 text-xs text-muted">({t.count})</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          {title && <h2 className="text-base">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="card-pad">{children}</div>
    </section>
  );
}

/** 空・検索0件・読込失敗・権限不足を区別して表示する */
export function StateMessage({
  kind,
  message,
  action,
}: {
  kind: "empty" | "no_results" | "error" | "forbidden";
  message?: string;
  action?: ReactNode;
}) {
  const conf = {
    empty: { title: "まだ登録がありません", tone: "text-muted" },
    no_results: { title: "条件に一致するデータはありません", tone: "text-muted" },
    error: { title: "読み込みに失敗しました", tone: "text-danger" },
    forbidden: { title: "閲覧する権限がありません", tone: "text-warn" },
  }[kind];
  return (
    <div className="px-4 py-10 text-center" role={kind === "error" ? "alert" : undefined}>
      <p className={`font-semibold ${conf.tone}`}>{conf.title}</p>
      {message && <p className="mt-1 text-sm text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function DL({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === "" ? <span className="text-muted">未入力</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Unset() {
  return <span className="text-muted">未入力</span>;
}
