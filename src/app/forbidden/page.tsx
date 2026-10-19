import Link from "next/link";
import { StateMessage } from "@/components/ui";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md">
        <StateMessage
          kind="forbidden"
          message="この画面を利用する権限が付与されていません。必要な場合は会社管理者に依頼してください。"
          action={<Link className="btn btn-secondary" href="/home">ホームへ戻る</Link>}
        />
      </div>
    </div>
  );
}
