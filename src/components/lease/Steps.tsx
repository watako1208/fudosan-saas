/** 手続きの進行状況（現在の段階を文字と記号で示す。色だけに依存しない） */
export function Steps({ steps, current }: { steps: { key: string; label: string }[]; current: string }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="mb-4 flex flex-wrap gap-1 text-sm" aria-label="手続きの段階">
      {steps.map((s, i) => {
        const state = idx < 0 ? "todo" : i < idx ? "done" : i === idx ? "current" : "todo";
        return (
          <li
            key={s.key}
            aria-current={state === "current" ? "step" : undefined}
            className={`rounded border px-2 py-1 ${
              state === "current" ? "border-primary bg-primary text-white font-semibold" : state === "done" ? "border-ok/30 bg-ok-soft text-ok" : "border-line bg-surface text-muted"
            }`}
          >
            {state === "done" ? "✓ " : state === "current" ? "● " : ""}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
