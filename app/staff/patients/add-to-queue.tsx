"use client"

import { useId, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { addToQueueAction } from "./actions"

export type AddToQueuePatient = {
  id: string
  firstName: string
  lastName: string
  age: number
  phone: string
}

/** The place the patient already holds in today's queue, if any — the row shows this instead of the button. */
export type QueuedToday = { queueNumber: number; label: string }

/**
 * The patient search's way into today's queue. Asks the same two questions
 * the register screen asks before it checks anyone in — reason for visit
 * and priority — because the board prints the first on every row and
 * orders by the second; a one-tap add would put a blank row on it. Ends on
 * the queue number, large, the way the register screen does, so the desk
 * can read it out across the counter.
 *
 * One component renders both the row's state and the dialog, deliberately:
 * the server action revalidates this page, so the row turns into the
 * patient's number in the same round trip as the check-in. Were the button
 * and the number separate components, that re-render would unmount the
 * button — and the dialog holding the number the desk is reading with it.
 */
export function AddToQueue({ patient, inQueue }: { patient: AddToQueuePatient; inQueue: QueuedToday | null }) {
  const router = useRouter()
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const [reasonForVisit, setReasonForVisit] = useState("")
  const [priority, setPriority] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueNumber, setQueueNumber] = useState<number | null>(null)

  const name = `${patient.firstName} ${patient.lastName}`

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Belt and braces: the action's revalidation normally has the row
      // showing the number already; this covers a stale router cache.
      if (queueNumber !== null) router.refresh()
      // Reopening starts clean — the last visit's reason is not this one's.
      setReasonForVisit("")
      setPriority(false)
      setError(null)
      setQueueNumber(null)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await addToQueueAction(patient.id, { reasonForVisit, priority })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setQueueNumber(res.queueEntry.queueNumber)
  }

  return (
    <>
      {inQueue ? (
        <Link
          prefetch={false}
          href="/staff/queue"
          className="shrink-0 text-right text-xs text-muted-foreground hover:underline underline-offset-4"
        >
          <span className="block font-numeric text-lg font-semibold leading-tight text-brand">#{inQueue.queueNumber}</span>
          {inQueue.label}
        </Link>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          Add to queue
        </Button>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {queueNumber !== null ? (
            <>
              <DialogHeader className="items-center text-center">
                <DialogTitle>{name} is in the queue</DialogTitle>
                <DialogDescription>
                  {patient.age}y · {patient.phone}
                </DialogDescription>
              </DialogHeader>
              <p className="font-numeric text-center text-7xl font-bold text-brand">{queueNumber}</p>
              <p className="text-center text-sm text-muted-foreground">Queue number</p>
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
                <Button type="button" className="h-11" onClick={() => router.push("/staff/queue")}>
                  Go to queue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Add to today&apos;s queue</DialogTitle>
                <DialogDescription>
                  {patient.lastName}, {patient.firstName} · {patient.age}y · {patient.phone}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={reasonId}>Reason for visit</Label>
                <Input
                  id={reasonId}
                  required
                  autoFocus
                  autoComplete="off"
                  value={reasonForVisit}
                  onChange={(e) => setReasonForVisit(e.target.value)}
                  className="h-11"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={priority} onCheckedChange={(checked) => setPriority(checked === true)} />
                Priority (senior citizen, PWD, pregnant, infant, or emergency)
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={pending}
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="h-11" disabled={pending}>
                  {pending ? "Adding…" : "Add to queue"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
