import { changelog, APP_VERSION } from "@/lib/changelog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Sparkles, Wrench, Bug, Shield } from "lucide-react";

const typeConfig = {
  feature: { label: "New", icon: Sparkles, className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  improvement: { label: "Improved", icon: Wrench, className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  fix: { label: "Fixed", icon: Bug, className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  security: { label: "Security", icon: Shield, className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

export default function Changelog() {
  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[900px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <ScrollText className="w-8 h-8 text-primary" />
            Changelog
          </h1>
          <p className="text-muted-foreground mt-1">
            Track all updates and improvements to GoodShift
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1 self-start" data-testid="badge-version">
          Current Version: {APP_VERSION}
        </Badge>
      </div>

      <div className="space-y-6">
        {changelog.map((entry, index) => (
          <Card key={entry.version} className={index === 0 ? "border-primary/50 shadow-lg" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-xl flex items-center gap-2" data-testid={`text-version-${entry.version}`}>
                  v{entry.version}
                  {index === 0 && (
                    <Badge className="bg-primary/10 text-primary border-primary/20">Latest</Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-sm" data-testid={`text-date-${entry.version}`}>
                  {new Date(entry.date).toLocaleDateString("en-US", { 
                    year: "numeric", 
                    month: "long", 
                    day: "numeric" 
                  })}
                </CardDescription>
              </div>
              <p className="text-foreground font-medium">{entry.title}</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {entry.changes.map((change, i) => {
                  const config = typeConfig[change.type];
                  const Icon = config.icon;
                  return (
                    <li 
                      key={i} 
                      className="flex items-start gap-3 text-sm"
                      data-testid={`text-change-${entry.version}-${i}`}
                    >
                      <Badge 
                        variant="secondary" 
                        className={`${config.className} text-xs font-medium shrink-0 mt-0.5`}
                      >
                        <Icon className="w-3 h-3 mr-1" />
                        {config.label}
                      </Badge>
                      <span className="text-muted-foreground">{change.description}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-center text-sm text-muted-foreground pt-4 border-t">
        <p>GoodShift - Employee Scheduling for Goodwill</p>
      </div>
    </div>
  );
}
