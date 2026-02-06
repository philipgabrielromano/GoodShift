import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import goodshiftLogo from "@assets/2_1770387977850.png";

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

export default function Login() {
  const handleLogin = () => {
    window.location.href = "/api/auth/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="login-page">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <img src={goodshiftLogo} alt="GoodShift" className="mx-auto h-16 w-auto" />
          <CardDescription>
            Employee scheduling and workforce management
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
        </CardContent>
      </Card>
    </div>
  );
}
