import { StateMessage } from "@/components/ui";

export function NoScope() {
  return (
    <div className="card">
      <StateMessage kind="forbidden" message="ご利用者の情報が登録されていないため表示できません。担当者へお問い合わせください。" />
    </div>
  );
}

export function NotForYou() {
  return (
    <div className="card">
      <StateMessage kind="forbidden" message="このページはご利用いただけません。" />
    </div>
  );
}
