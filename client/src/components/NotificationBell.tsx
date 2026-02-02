import { useState } from "react";
import { Bell } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOccurrenceAlerts, type OccurrenceAlert } from "@/hooks/use-occurrences";
import { getJobTitle } from "@/lib/utils";

function getThresholdColor(threshold: 5 | 7 | 8) {
  switch (threshold) {
    case 8: return "bg-red-600 text-white";
    case 7: return "bg-red-500 text-white";
    case 5: return "bg-orange-500 text-white";
    default: return "bg-muted";
  }
}

function getThresholdLabel(threshold: 5 | 7 | 8) {
  switch (threshold) {
    case 8: return "Termination";
    case 7: return "Final Warning";
    case 5: return "Warning";
    default: return "";
  }
}

interface NotificationBellProps {
  showLabel?: boolean;
}

export function NotificationBell({ showLabel = false }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { data: alerts = [], isLoading } = useOccurrenceAlerts();

  const handleAlertClick = (alert: OccurrenceAlert) => {
    setOpen(false);
    navigate(`/attendance?employeeId=${alert.employeeId}`);
  };

  const alertCount = alerts.length;
  const hasAlerts = alertCount > 0;
  const hasCritical = alerts.some(a => a.threshold >= 8);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {showLabel ? (
          <Button 
            variant="outline" 
            className={`w-full justify-start gap-2 relative ${hasAlerts ? "border-orange-300 dark:border-orange-700" : ""}`}
            data-testid="button-notifications"
          >
            <Bell className={`w-5 h-5 ${hasCritical ? "text-red-500" : hasAlerts ? "text-orange-500" : ""}`} />
            <span>Notifications</span>
            {hasAlerts && (
              <span 
                className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full text-xs font-bold px-1.5 ${
                  hasCritical ? "bg-red-500 text-white" : "bg-orange-500 text-white"
                }`}
                data-testid="badge-notification-count"
              >
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </Button>
        ) : (
          <Button 
            variant="ghost" 
            size="icon" 
            className={`relative ${hasAlerts ? "animate-notification-glow" : ""}`}
            data-testid="button-notifications"
          >
            <Bell className={`w-6 h-6 ${hasCritical ? "text-red-500" : hasAlerts ? "text-orange-500" : ""}`} />
            {hasAlerts && (
              <span 
                className={`absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold shadow-lg ${
                  hasCritical ? "bg-red-500 text-white" : "bg-orange-500 text-white"
                }`}
                data-testid="badge-notification-count"
              >
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
        <div className="p-3 border-b">
          <h4 className="font-semibold">Attendance Alerts</h4>
          <p className="text-xs text-muted-foreground">Employees requiring attention</p>
        </div>
        
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No alerts at this time
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="divide-y">
              {alerts.map((alert) => (
                <button
                  key={alert.employeeId}
                  onClick={() => handleAlertClick(alert)}
                  className="w-full p-3 text-left hover-elevate active-elevate-2 transition-colors"
                  data-testid={`notification-item-${alert.employeeId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{alert.employeeName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {getJobTitle(alert.jobTitle)} {alert.location && `• ${alert.location}`}
                      </p>
                    </div>
                    <Badge className={`shrink-0 text-xs ${getThresholdColor(alert.threshold)}`}>
                      {alert.netTally.toFixed(1)}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {getThresholdLabel(alert.threshold)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Click to review and take action
                  </p>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
        
        {alerts.length > 0 && (
          <div className="p-2 border-t">
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full"
              onClick={() => {
                setOpen(false);
                navigate("/attendance");
              }}
              data-testid="button-view-all-attendance"
            >
              View All Attendance Records
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
