"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useState } from "react";
import { Icon } from "./Icon";

export function Shell({
  nav,
  companyName,
  userName,
  roleLabel,
  stores,
  unread,
  currentStore,
  children,
}: {
  nav: { href: string; label: string; icon: string }[];
  companyName: string;
  userName: string;
  roleLabel: string;
  stores: { id: string; name: string }[];
  unread: number;
  currentStore: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col gap-0.5 p-3" aria-label="業務メニュー">
      {nav.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setOpen(false)}
            className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-[0.95rem] ${
              active ? "bg-primary-soft font-semibold text-primary" : "text-ink hover:bg-bg"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={n.icon} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen">
      {/* 上部: 全体検索・店舗切替・通知・利用者メニュー */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 lg:pl-4">
        <button className="btn btn-ghost !px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="メニューを開く">
          <Icon name="menu" />
        </button>
        <Link href="/home" className="mr-2 shrink-0 font-bold text-primary">
          <span className="hidden sm:inline">{companyName || "不動産業務クラウド"}</span>
          <span className="sm:hidden">ホーム</span>
        </Link>
        <form
          className="hidden max-w-md flex-1 md:flex"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            router.push(`/search?q=${encodeURIComponent(String(q ?? ""))}`);
          }}
        >
          <input name="q" className="input" placeholder="物件・顧客・契約番号などを全体検索" aria-label="全体検索" />
        </form>
        <div className="ml-auto flex items-center gap-2">
          {stores.length > 0 && (
            <select
              className="input !w-auto max-w-40"
              aria-label="店舗切替"
              value={currentStore}
              onChange={(e) => {
                document.cookie = `store=${encodeURIComponent(e.target.value)}; path=/; max-age=31536000; samesite=lax`;
                router.refresh();
              }}
            >
              <option value="">全店舗</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <Link href="/notifications" className="btn btn-ghost relative !px-2" aria-label={`通知 未読${unread}件`}>
            <Icon name="bell" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-xs text-white">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
          <div className="relative">
            <button className="btn btn-ghost !px-2" onClick={() => setUserMenu((v) => !v)} aria-expanded={userMenu}>
              <span className="max-w-32 truncate text-ink">{userName}</span>
            </button>
            {userMenu && (
              <div className="absolute right-0 mt-1 w-60 rounded-md border border-line bg-surface p-2 shadow-lg">
                <div className="px-2 py-1 text-sm">
                  <div className="font-semibold">{userName}</div>
                  <div className="text-muted">{roleLabel}</div>
                </div>
                <Link href="/search" className="block rounded px-2 py-2 text-sm hover:bg-bg md:hidden">全体検索</Link>
                <button
                  className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-bg"
                  onClick={async () => {
                    await fetch("/api/session", { method: "DELETE" });
                    location.href = "/login";
                  }}
                >
                  ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 左: 業務メニュー */}
      <aside className="fixed top-14 bottom-0 left-0 hidden w-64 overflow-y-auto border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute top-0 bottom-0 left-0 w-72 overflow-y-auto bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <span className="font-bold">メニュー</span>
              <button className="btn btn-ghost !px-2" onClick={() => setOpen(false)} aria-label="閉じる"><Icon name="x" /></button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      {/* 中央: 作業画面 */}
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
