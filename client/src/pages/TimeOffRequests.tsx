import { useTimeOffRequests, useUpdateTimeOffRequest } from "@/hooks/use-time-off";
import { useEmployees } from "@/hooks/use-employees";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Check, X, Calendar, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function TimeOffRequests() {
  const { data: requests, isLoading } = useTimeOffRequests();
  const { data: employees } = useEmployees();
  const updateRequest = useUpdateTimeOffRequest();
  const { toast } = useToast();

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await updateRequest.mutateAsync({ id, status });
      toast({ title: `Request ${status}` });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update status" });
    }
  };

  const getEmployee = (id: number) => employees?.find(e => e.id === id);

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold font-display">Time Off Requests</h1>
        <p className="text-muted-foreground mt-1">Review and manage time off requests from employees.</p>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <div>Loading...</div>
        ) : requests?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded border border-dashed">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No pending requests found.</p>
          </div>
        ) : (
          requests?.map(req => {
            const emp = getEmployee(req.employeeId);
            return (
              <div key={req.id} className="bg-card p-6 rounded border shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div 
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: emp?.color || '#ccc' }}
                  >
                    {emp?.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{emp?.name || "Unknown"}</h3>
                    <div className="flex items-center gap-2 text-muted-foreground text-sm mt-1">
                      <Clock className="w-4 h-4" />
                      <span>{format(req.startDate, "MMM d, yyyy")} — {format(req.endDate, "MMM d, yyyy")}</span>
                    </div>
                    {req.reason && <p className="mt-2 text-sm bg-muted/50 p-2 rounded-md">{req.reason}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto mt-4 md:mt-0">
                  {req.status === 'pending' ? (
                    <>
                      <Button 
                        onClick={() => handleStatusChange(req.id, 'approved')}
                        className="flex-1 md:flex-none bg-green-600 hover:bg-green-700 text-white"
                      >
                        <Check className="w-4 h-4 mr-2" /> Approve
                      </Button>
                      <Button 
                        onClick={() => handleStatusChange(req.id, 'rejected')}
                        variant="destructive"
                        className="flex-1 md:flex-none"
                      >
                        <X className="w-4 h-4 mr-2" /> Reject
                      </Button>
                    </>
                  ) : (
                    <div className={`px-4 py-2 rounded font-medium text-sm capitalize ${
                      req.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {req.status}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
