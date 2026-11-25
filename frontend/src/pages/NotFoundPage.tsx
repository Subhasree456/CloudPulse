import { Compass, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { LogoMark } from "../components/Logo";
import { Button } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 w-fit">
          <LogoMark size={48} />
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">404 · signal lost</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink">This route is not monitored.</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The page you requested does not exist. Return to the operations overview to continue monitoring your fleet.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link to="/">
            <Button variant="primary" icon={<Home className="h-3.5 w-3.5" />}>
              Back to overview
            </Button>
          </Link>
          <Link to="/services">
            <Button variant="secondary" icon={<Compass className="h-3.5 w-3.5" />}>
              Service inventory
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
