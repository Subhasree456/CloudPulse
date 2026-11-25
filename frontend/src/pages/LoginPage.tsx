import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Server,
  ShieldCheck,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { cn } from "../lib/format";
import { Logo } from "../components/Logo";
import { Button, FormField, Input } from "../components/ui";

const HIGHLIGHTS = [
  {
    icon: Activity,
    title: "Real-time telemetry",
    detail: "CPU, memory, disk, network and latency streamed over Socket.IO with a clear live/demo boundary.",
  },
  {
    icon: BrainCircuit,
    title: "Isolation Forest analytics",
    detail: "Unsupervised anomaly detection surfaces outliers before static thresholds catch them.",
  },
  {
    icon: ShieldCheck,
    title: "Role-based operations",
    detail: "JWT sessions, scrypt password hashing and separate admin and viewer capabilities.",
  },
];

const DEMO_EMAIL = "admin@cloudpulse.dev";
const DEMO_PASSWORD = "Admin@12345";

export function LoginPage() {
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from || "/";

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true });
  }, [user, navigate, redirectTo]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (mode === "register" && name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Passwords must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.field) setFieldError(caught.field);
      } else {
        setError(caught instanceof Error ? caught.message : "Unable to sign in. Check that the API is running.");
      }
    } finally {
      setLoading(false);
    }
  };

  const useDemoAccount = () => {
    setMode("login");
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-info/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-accent/8 blur-3xl" />
      </div>

      {/* Brand / marketing panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line/10 px-10 py-9 lg:flex xl:px-14">
        <Logo />
        <div className="max-w-lg">
          <span className="chip border-accent/25 bg-accent/8 text-accent">
            <Sparkles className="h-3 w-3" /> Intelligent cloud observability
          </span>
          <h1 className="mt-5 text-[42px] font-semibold leading-[1.06] tracking-[-0.045em] text-ink xl:text-[50px]">
            Your infrastructure,
            <br />
            with a{" "}
            <span className="bg-gradient-to-r from-accent via-info to-accent bg-clip-text text-transparent">pulse.</span>
          </h1>
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
            CloudPulse combines real host telemetry, threshold alerting, Isolation Forest anomaly detection and
            operational reporting in one premium monitoring workspace.
          </p>

          <div className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line/15 bg-panel/60 text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 max-w-sm text-[11px] leading-relaxed text-muted/85">{item.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 grid max-w-md grid-cols-3 gap-2">
            {[
              { value: "8", label: "Demo targets" },
              { value: "4,900", label: "Seed samples" },
              { value: "0–100", label: "Health score" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-line/12 bg-panel/35 px-3 py-2.5">
                <p className="font-mono text-sm font-semibold text-ink">{stat.value}</p>
                <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-muted/70">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted/60">
          <span className="h-1.5 w-1.5 rounded-full bg-positive shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
          React · Flask · MongoDB Atlas / SQLite fallback · Isolation Forest
        </div>
      </section>

      {/* Form panel */}
      <section className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px] animate-fade-up">
          <div className="mb-7 flex items-center justify-between lg:hidden">
            <Logo />
          </div>

          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Zap className="h-3 w-3" />
            {mode === "login" ? "Welcome back" : "Create your workspace"}
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.035em] text-ink">
            {mode === "login" ? "Sign in to CloudPulse" : "Start monitoring in minutes"}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            {mode === "login"
              ? "Use your operator credentials to access the monitoring workspace."
              : "The first registered account becomes the administrator; later accounts are viewers."}
          </p>

          <div className="mt-5 grid grid-cols-2 rounded-xl border border-line/15 bg-canvas/40 p-1">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={cn(
                  "h-8 rounded-lg text-[11px] font-semibold transition",
                  mode === value ? "bg-panel text-ink shadow-sm ring-1 ring-line/15" : "text-muted hover:text-ink",
                )}
              >
                {value === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>

          <form className="mt-4 space-y-3.5" onSubmit={submit} noValidate>
            {mode === "register" && (
              <FormField label="Full name" error={fieldError === "name" ? error : null}>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ada Lovelace"
                    autoComplete="name"
                    className="pl-9"
                    required
                  />
                </div>
              </FormField>
            )}

            <FormField label="Email address" error={fieldError === "email" ? error : null}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="operator@company.com"
                  autoComplete="email"
                  className="pl-9"
                  required
                />
              </div>
            </FormField>

            <FormField
              label="Password"
              hint={mode === "register" ? "At least 8 characters with a letter and a number." : undefined}
              error={fieldError === "password" ? error : null}
            >
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="pl-9 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:text-ink"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </FormField>

            {error && !fieldError && (
              <div className="rounded-xl border border-danger/25 bg-danger/8 px-3 py-2.5 text-[11px] leading-relaxed text-danger">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              {mode === "login" ? "Sign in securely" : "Create account"}
              {!loading && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </form>

          <div className="mt-4 rounded-xl border border-line/12 bg-panel/35 p-3">
            <div className="flex items-start gap-2.5">
              <Server className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="text-[11px] font-semibold text-ink">Seeded administrator</p>
                  <span className="text-[9px] uppercase tracking-[0.12em] text-muted/60">Development only</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-muted">
                  {DEMO_EMAIL} · {DEMO_PASSWORD}
                </p>
                <button
                  type="button"
                  onClick={useDemoAccount}
                  className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-accent transition hover:brightness-110"
                >
                  Fill demo credentials <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] text-muted/60">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-positive" /> JWT sessions
            </span>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-positive" /> scrypt hashing
            </span>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-positive" /> Admin / viewer roles
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
