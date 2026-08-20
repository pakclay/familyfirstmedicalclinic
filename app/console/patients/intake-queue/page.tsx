import { requireRole } from "@/lib/auth/guards"
import { listIntakeQueue } from "@/lib/actions/intake"
import { ProcessIntakeButton } from "./process-intake-button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default async function IntakeQueuePage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "FRONT_DESK"])
  const queue = await listIntakeQueue()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Intake queue</h1>
        <p className="text-sm text-muted-foreground">
          Submissions from the public intake link and kiosk, waiting to become patient records.
        </p>
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submitted</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Via</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Nothing pending. Nice.
                </TableCell>
              </TableRow>
            ) : (
              queue.map((s) => {
                const answers = s.answers as { firstName?: string; lastName?: string; mobile?: string }
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-numeric text-muted-foreground">
                      {new Date(s.submittedAt).toLocaleString("en-PH")}
                    </TableCell>
                    <TableCell>
                      {answers.lastName}, {answers.firstName}
                    </TableCell>
                    <TableCell className="font-numeric">{answers.mobile}</TableCell>
                    <TableCell>{s.branch.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.submittedVia}</TableCell>
                    <TableCell className="text-right">
                      <ProcessIntakeButton submissionId={s.id} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
