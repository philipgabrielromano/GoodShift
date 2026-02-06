import { useState } from "react";
import { Bell, ArrowLeftRight, AlertTriangle, Check, CheckCheck } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOccurrenceAlerts, type OccurrenceAlert } from "@/hooks/use-occurrences";
import { getJobTitle } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TradeNotification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  relatedTradeId: number | null;
  isRead: boolean;
  createdAt: string;
}

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

function getTradeNotificationIcon(type: string) {
  switch (type) {
    case "trade_requested": return <ArrowLeftRight className="w-4 h-4 text-blue-500" />;
    case "trade_peer_approved": return <Check className="w-4 h-4 text-green-500" />;
    case "trade_pending_manager": return <ArrowLeftRight className="w-4 h-4 text-amber-500" />;
    case "trade_approved": return <CheckCheck className="w-4 h-4 text-green-600" />;
    case "trade_declined": return <AlertTriangle className="w-4 h-4 text-red-500" />;
    default: return <Bell className="w-4 h-4" />;
  }
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface NotificationBellProps {
  showLabel?: boolean;
}

export function NotificationBell({ showLabel = false }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { data: alerts = [], isLoading: alertsLoading } = useOccurrenceAlerts();

  const { data: tradeNotifications = [], isLoading: tradesLoading } = useQuery<TradeNotification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const handleAlertClick = (alert: OccurrenceAlert) => {
    setOpen(false);
    navigate(`/attendance?employeeId=${alert.employeeId}`);
  };

  const handleTradeNotifClick = async (notif: TradeNotification) => {
    if (!notif.isRead) {
      try {
        await apiRequest("PATCH", `/api/notifications/${notif.id}/read`);
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      } catch (e) {}
    }
    setOpen(false);
    navigate("/trades");
  };

  const handleMarkAllRead = async () => {
    try {
      await apiRequest("PATCH", "/api/notifications/read-all");
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch (e) {}
  };

  const unreadTradeCount = tradeNotifications.filter(n => !n.isRead).length;
  const totalCount = alerts.length + unreadTradeCount;
  const hasAlerts = totalCount > 0;
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
                {totalCount > 9 ? "9+" : totalCount}
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
                {totalCount > 9 ? "9+" : totalCount}
              </span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
        <Tabs defaultValue="trades" className="w-full">
          <div className="p-3 border-b">
            <h4 className="font-semibold mb-2">Notifications</h4>
            <TabsList className="w-full">
              <TabsTrigger value="trades" className="flex-1 text-xs" data-testid="tab-trade-notifications">
                Trades
                {unreadTradeCount > 0 && (
                  <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 text-white text-[10px] px-1">
                    {unreadTradeCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="attendance" className="flex-1 text-xs" data-testid="tab-attendance-notifications">
                Attendance
                {alerts.length > 0 && (
                  <span className={`ml-1 flex h-4 min-w-4 items-center justify-center rounded-full text-white text-[10px] px-1 ${
                    hasCritical ? "bg-red-500" : "bg-orange-500"
                  }`}>
                    {alerts.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="trades" className="m-0">
            {tradesLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : tradeNotifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No trade notifications
              </div>
            ) : (
              <>
                <ScrollArea className="max-h-64">
                  <div className="divide-y">
                    {tradeNotifications.slice(0, 20).map(notif => (
                      <button
                        key={notif.id}
                        onClick={() => handleTradeNotifClick(notif)}
                        className={`w-full p-3 text-left hover-elevate transition-colors ${
                          !notif.isRead ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                        }`}
                        data-testid={`notification-trade-${notif.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5">{getTradeNotificationIcon(notif.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${!notif.isRead ? "font-semibold" : "font-medium"}`}>
                              {notif.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {notif.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatTimeAgo(notif.createdAt)}
                            </p>
                          </div>
                          {!notif.isRead && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                <div className="p-2 border-t flex gap-2">
                  {unreadTradeCount > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="flex-1 text-xs"
                      onClick={handleMarkAllRead}
                      data-testid="button-mark-all-read"
                    >
                      Mark all read
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="flex-1 text-xs"
                    onClick={() => { setOpen(false); navigate("/trades"); }}
                    data-testid="button-view-all-trades"
                  >
                    View All Trades
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="attendance" className="m-0">
            {alertsLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : alerts.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No attendance alerts
              </div>
            ) : (
              <>
                <ScrollArea className="max-h-64">
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
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                <div className="p-2 border-t">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full text-xs"
                    onClick={() => { setOpen(false); navigate("/attendance"); }}
                    data-testid="button-view-all-attendance"
                  >
                    View All Attendance Records
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
