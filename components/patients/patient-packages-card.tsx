"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SellPackageDialog } from "./sell-package-dialog"

type ActivePackage = {
  id: string
  sessionsUsed: number
  sessionsTotal: number
  expiresAt: string
  package: { name: string }
}

export function PatientPackagesCard({
  patientId,
  branchId,
  canSell,
  activePackages,
  catalog,
}: {
  patientId: string
  branchId: string
  canSell: boolean
  activePackages: ActivePackage[]
  catalog: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Packages</CardTitle>
        {canSell ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Sell package
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {activePackages.length === 0 ? (
          <p className="text-muted-foreground">No active packages.</p>
        ) : (
          activePackages.map((p) => (
            <div key={p.id} className="flex items-center justify-between">
              <span>{p.package.name}</span>
              <Badge variant="secondary" className="font-numeric">
                {p.sessionsUsed}/{p.sessionsTotal} used
              </Badge>
            </div>
          ))
        )}
      </CardContent>
      {canSell ? (
        <SellPackageDialog open={open} onOpenChange={setOpen} patientId={patientId} branchId={branchId} packages={catalog} />
      ) : null}
    </Card>
  )
}
