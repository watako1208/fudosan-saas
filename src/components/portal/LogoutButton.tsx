"use client";

export function LogoutButton() {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await fetch("/api/session", { method: "DELETE" });
        location.href = "/login";
      }}
    >
      ログアウト
    </button>
  );
}

export function PrintButton() {
  return (
    <button className="btn btn-secondary print:hidden" onClick={() => window.print()}>
      印刷・PDF保存
    </button>
  );
}
