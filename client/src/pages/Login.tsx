import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import goodshiftLogo from "@assets/goodshift_1770590279218.png";
import { APP_VERSION, changelog } from "@/lib/changelog";

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  );
}

const DEFAULT_TAGLINE = "Changing lives through the power of work.";

function formatReleaseDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function Login() {
  const [tagline, setTagline] = useState<string>(DEFAULT_TAGLINE);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/login-info", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.tagline) setTagline(data.tagline);
      })
      .catch(() => { /* keep default */ });
    return () => { cancelled = true; };
  }, []);

  const handleLogin = () => {
    window.location.href = "/api/auth/login";
  };

  const latestRelease = changelog.find(c => c.version === APP_VERSION) || changelog[0];
  const releaseDate = latestRelease ? formatReleaseDate(latestRelease.date) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="login-page">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <img src={goodshiftLogo} alt="GoodShift" className="mx-auto w-64 h-auto" />
          <CardDescription data-testid="text-login-tagline">
            {tagline}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleLogin} 
            className="w-full gap-2"
            size="lg"
            data-testid="button-microsoft-login"
          >
            <MicrosoftIcon className="w-5 h-5" />
            Sign in with Microsoft 365
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Use your organization's Microsoft 365 account to sign in
          </p>
          <div className="pt-2 text-center text-xs text-muted-foreground" data-testid="text-version-info">
            Version {APP_VERSION}
            {releaseDate && <> &middot; Released {releaseDate}</>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
