"use client"

import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  checkInAppointment,
  completeAppointment,
  markNoShow,
  cancelAppointment,
  getServicePriceForCheckout,
} from "@/lib/actions/scheduling"
import { recordPayment } from "@/lib/actions/payments"
import type { AppointmentView } from "./appointment-card"
import type { PaymentMethod } from "@prisma/client"

const EMPTY_SOAP = { subjective: "", objective: "", assessment: "", plan: "", painBefore: "", painAfter: "", modalitiesPerformed: "" }

export function AppointmentDetailSheet({
  appointment,
  isOwner,
  canRecordPayments,
  canWriteSoapNotes,
  branchId,
  onOpenChange,
  onChanged,
}: {
  appointment: AppointmentView | null
  isOwner: boolean
  canRecordPayments: boolean
  canWriteSoapNotes: boolean
  branchId: string
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showCancelReason, setShowCancelReason] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [showOverride, setShowOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")
  const [showPayment, setShowPayment] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH")
  const [priceHint, setPriceHint] = useState<{ name: string; priceCentavos: number } | null>(null)
  const [showSoap, setShowSoap] = useState(false)
  const [soap, setSoap] = useState(EMPTY_SOAP)

  if (!appointment) return null

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    setPending(true)
    try {
      await fn()
      onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : "That didn't work."
      if (message.includes("signed, valid prescription") && isOwner) {
        setShowOverride(true)
      }
      setError(message)
    } finally {
      setPending(false)
    }
  }

  function completeWithSoap() {
    if (!soap.subjective.trim() || !soap.objective.trim() || !soap.assessment.trim() || !soap.plan.trim()) {
      setError("Fill in all four SOAP fields, or skip the note.")
      return
    }
    run(() =>
      completeAppointment(appointment!.id, {
        soapNote: {
          subjective: soap.subjective,
          objective: soap.objective,
          assessment: soap.assessment,
          plan: soap.plan,
          painBefore: soap.painBefore ? Number(soap.painBefore) : undefined,
          painAfter: soap.painAfter ? Number(soap.painAfter) : undefined,
          modalitiesPerformed: soap.modalitiesPerformed
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      })
    )
  }

  async function openPaymentForm() {
    setError(null)
    try {
      const service = await getServicePriceForCheckout(appointment!.serviceId)
      setPriceHint(service)
      setPaymentAmount((service.priceCentavos / 100).toFixed(2))
      setShowPayment(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the price.")
    }
  }

  async function submitPayment() {
    const centavos = Math.round(parseFloat(paymentAmount || "0") * 100)
    if (!centavos || centavos <= 0) {
      setError("Enter a valid amount.")
      return
    }
    await run(() =>
      recordPayment({
        patientId: appointment!.patientId,
        branchId,
        amountCentavos: centavos,
        method: paymentMethod,
        appointmentId: appointment!.id,
      })
    )
    setShowPayment(false)
  }

  return (
    <Sheet open={!!appointment} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{appointment.patientName}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1 text-sm">
            <p className="font-numeric text-muted-foreground">{appointment.patientCode}</p>
            <p>{appointment.serviceName}</p>
            <p className="text-muted-foreground">{appointment.roomName ?? "No room assigned"}</p>
            <p className="font-numeric">
              {new Date(appointment.startsAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}
            </p>
            <Badge variant="secondary">{appointment.status.replaceAll("_", " ")}</Badge>
            {appointment.hasPackage ? <Badge variant="outline">Using package credit</Badge> : null}
          </div>

          {showOverride ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>Owner override reason</Label>
              <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              <Button
                size="sm"
                disabled={pending || !overrideReason.trim()}
                onClick={() => run(() => completeAppointment(appointment.id, { overrideReason }))}
              >
                Complete with override
              </Button>
            </div>
          ) : null}

          {showSoap ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>SOAP note</Label>
              <Textarea placeholder="Subjective" value={soap.subjective} onChange={(e) => setSoap({ ...soap, subjective: e.target.value })} />
              <Textarea placeholder="Objective" value={soap.objective} onChange={(e) => setSoap({ ...soap, objective: e.target.value })} />
              <Textarea placeholder="Assessment" value={soap.assessment} onChange={(e) => setSoap({ ...soap, assessment: e.target.value })} />
              <Textarea placeholder="Plan" value={soap.plan} onChange={(e) => setSoap({ ...soap, plan: e.target.value })} />
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  placeholder="Pain before (0-10)"
                  value={soap.painBefore}
                  onChange={(e) => setSoap({ ...soap, painBefore: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  max={10}
                  placeholder="Pain after (0-10)"
                  value={soap.painAfter}
                  onChange={(e) => setSoap({ ...soap, painAfter: e.target.value })}
                />
              </div>
              <Input
                placeholder="Modalities performed, comma-separated"
                value={soap.modalitiesPerformed}
                onChange={(e) => setSoap({ ...soap, modalitiesPerformed: e.target.value })}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending} onClick={completeWithSoap}>
                  Complete with note
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => completeAppointment(appointment.id))}
                >
                  Complete without note
                </Button>
              </div>
            </div>
          ) : null}

          {showPayment ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>Record payment {priceHint ? `for ${priceHint.name}` : ""}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="font-numeric"
                />
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger className="w-32">
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
              <Button size="sm" disabled={pending} onClick={submitPayment}>
                Save payment
              </Button>
            </div>
          ) : null}

          {showCancelReason ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>Cancellation reason</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              <Button
                size="sm"
                variant="destructive"
                disabled={pending || !cancelReason.trim()}
                onClick={() => run(() => cancelAppointment(appointment.id, cancelReason))}
              >
                Confirm cancel
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {["BOOKED", "CONFIRMED"].includes(appointment.status) && (
              <Button size="sm" disabled={pending} onClick={() => run(() => checkInAppointment(appointment.id))}>
                Check in
              </Button>
            )}
            {appointment.status === "CHECKED_IN" && !showSoap && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => (canWriteSoapNotes ? setShowSoap(true) : run(() => completeAppointment(appointment.id)))}
              >
                Complete
              </Button>
            )}
            {!appointment.hasPackage && canRecordPayments && !["CANCELLED", "NO_SHOW"].includes(appointment.status) && (
              <Button size="sm" variant="outline" disabled={pending} onClick={openPaymentForm}>
                Record payment
              </Button>
            )}
            {["BOOKED", "CONFIRMED"].includes(appointment.status) && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markNoShow(appointment.id))}>
                No-show
              </Button>
            )}
            {!["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status) && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowCancelReason(true)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
