"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { sellPackage } from "@/lib/actions/packages"
import type { PaymentMethod } from "@prisma/client"

export function SellPackageDialog({
  open,
  onOpenChange,
  patientId,
  branchId,
  packages,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  branchId: string
  packages: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [packageId, setPackageId] = useState("")
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSell() {
    if (!packageId) {
      setError("Choose a package.")
      return
    }
    setError(null)
    setPending(true)
    try {
      await sellPackage({ patientId, branchId, packageId, method })
      onOpenChange(false)
      setPackageId("")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sell this package.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sell package</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label>Package</Label>
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a package" />
              </SelectTrigger>
              <SelectContent>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="GCASH">GCash</SelectItem>
                <SelectItem value="MAYA">Maya</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="BANK">Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSell} disabled={pending}>
            {pending ? "Selling…" : "Sell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
