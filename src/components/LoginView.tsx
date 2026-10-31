import { useState, type FormEvent } from "react";
import { HardHat } from "lucide-react";
import { api, type CurrentUser } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginView({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Введіть шестизначний код."); return; }
    setPending(true);
    setError("");
    try {
      const user = await api.login(code);
      setCode("");
      onLogin(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося увійти. Спробуйте ще раз.");
    } finally {
      setPending(false);
    }
  }

  return <main className="login-page">
    <section className="login-card">
      <div className="brand-lockup"><div className="brand-mark"><HardHat size={19} /></div><div><strong>GIS Reports</strong><span>ВИРОБНИЦТВО</span></div></div>
      <div><h1>Вхід до системи</h1><p>Введіть персональний ключ-код, наданий адміністратором.</p></div>
      <form className="form-stack" onSubmit={submit}>
        <div className="field"><Label htmlFor="key-code">Ключ-код</Label><Input id="key-code" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" className="primary-shadcn" disabled={pending}>{pending ? "Вхід…" : "Увійти"}</Button>
      </form>
    </section>
  </main>;
}
