import Link from "next/link"
import { requireRole } from "@/lib/auth/guards"
import { listPatients } from "@/lib/actions/patients"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PatientStatus } from "@prisma/client"

const STATUS_LABELS: Record<PatientStatus, string> = {
  LEAD: "Lead",
  INTAKE_PENDING: "Intake pending",
  FOR_ASSESSMENT: "For assessment",
  FOR_DOCTOR_REVIEW: "For doctor review",
  ACTIVE_PROGRAM: "Active program",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  LAPSED: "Lapsed",
  DISCHARGED: "Discharged",
}

const CAN_WRITE = ["OWNER", "BRANCH_MANAGER", "FRONT_DESK"]

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requireRole(["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"])
  const { q } = await searchParams
  const patients = await listPatients({ search: q })
  const canWrite = CAN_WRITE.includes(user.role)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Patients</h1>
          <p className="text-sm text-muted-foreground">
            {user.role === "THERAPIST" ? "Your assigned patients." : "Showing what your role can see."}
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite ? (
            <Button asChild variant="outline">
              <Link href="/console/patients/intake-queue">Intake queue</Link>
            </Button>
          ) : null}
          {canWrite ? (
            <Button asChild>
              <Link href="/console/patients/new">Add patient</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <form className="max-w-sm">
        <Input type="search" name="q" placeholder="Search name, mobile, or patient code" defaultValue={q ?? ""} />
      </form>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last visit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No patients yet.
                </TableCell>
              </TableRow>
            ) : (
              patients.map((p) => (
                <TableRow key={p.id} className="cursor-pointer">
                  <TableCell className="font-numeric">
                    <Link href={`/console/patients/${p.id}`} className="hover:underline">
                      {p.patientCode}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/console/patients/${p.id}`} className="hover:underline">
                      {p.lastName}, {p.firstName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-numeric">{p.mobile}</TableCell>
                  <TableCell>{p.homeBranch.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{STATUS_LABELS[p.status]}</Badge>
                  </TableCell>
                  <TableCell className="font-numeric text-muted-foreground">
                    {p.lastVisitAt ? new Date(p.lastVisitAt).toLocaleDateString("en-PH") : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
