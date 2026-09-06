"use client"

import { useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { BranchDTO } from "@/lib/dto/branch"
import type { Weekday } from "@/lib/validation/operating-hours"
import {
  ANNOUNCEMENT_SAMPLE,
  DEFAULT_ANNOUNCEMENT_TEMPLATE,
  announcementTemplateProblem,
  renderAnnouncement,
} from "@/lib/utils/announcement"
import {
  OperatingHoursFields,
  toDayForms,
  toOperatingHours,
  type DayForm,
} from "../clinics/operating-hours-fields"
import { updateBranchSettingsAction } from "./actions"

// Hydration-safe "can this browser speak": the server has no
// speechSynthesis, so it must render the same `false` the client starts
// from. Same pattern as app/now-serving/now-serving-screen.tsx.
const noopSubscribe = () => () => {}
const speechOnClient = () => "speechSynthesis" in window
const speechOnServer = () => false

export function BranchSettingsForm({ branch }: { branch: BranchDTO }) {
  const [address, setAddress] = useState(branch.address)
  const [city, setCity] = useState(branch.city)
  const [phone, setPhone] = useState(branch.phone)
  const [facebookPageUrl, setFacebookPageUrl] = useState(branch.facebookPageUrl ?? "")
  const [hours, setHours] = useState<Record<Weekday, DayForm>>(() => toDayForms(branch.operatingHours))
  const [announcementTemplate, setAnnouncementTemplate] = useState(branch.announcementTemplate ?? "")
  const [systemFeeEnabled, setSystemFeeEnabled] = useState(branch.systemFeeEnabled)
  const [systemFeePesos, setSystemFeePesos] = useState((branch.systemFeeAmount / 100).toFixed(2))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const canSpeak = useSyncExternalStore(noopSubscribe, speechOnClient, speechOnServer)

  // Blank means "use the default", so only a non-blank template can be
  // wrong. The same check the server runs, so the form never accepts what
  // the action would then refuse.
  const announcementProblem = announcementTemplate.trim() ? announcementTemplateProblem(announcementTemplate) : null
  const announcementPreview = announcementProblem ? null : renderAnnouncement(announcementTemplate, ANNOUNCEMENT_SAMPLE)

  /**
   * Speaks the preview with the board's own pace. Doubles as the check
   * that matters — an admin hears exactly what the waiting room will,
   * with a sample number and name, before saving it.
   */
  function hearAnnouncement() {
    if (!announcementPreview || !("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(announcementPreview)
    utterance.rate = 0.85
    window.speechSynthesis.speak(utterance)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    if (announcementProblem) {
      setError(announcementProblem)
      return
    }
    setPending(true)
    setError(null)
    // No branch id in this payload — the server resolves it from the
    // session. Nothing here identifies which branch to write.
    const res = await updateBranchSettingsAction({
      address,
      city,
      phone,
      facebookPageUrl,
      operatingHours: toOperatingHours(hours),
      announcementTemplate,
      systemFeeEnabled,
      systemFeeAmount: Math.round(Number(systemFeePesos) * 100),
    })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSaved(true)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Address</Label>
        <Input id="address" required value={address} onChange={(e) => setAddress(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="city">City</Label>
        <Input id="city" required value={city} onChange={(e) => setCity(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="facebookPageUrl">Facebook page (optional)</Label>
        <Input
          id="facebookPageUrl"
          type="url"
          placeholder="https://facebook.com/…"
          value={facebookPageUrl}
          onChange={(e) => setFacebookPageUrl(e.target.value)}
          className="h-10"
        />
      </div>

      <OperatingHoursFields value={hours} onChange={setHours} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="announcementTemplate">Calling-board announcement</Label>
        <Textarea
          id="announcementTemplate"
          rows={2}
          placeholder={DEFAULT_ANNOUNCEMENT_TEMPLATE}
          value={announcementTemplate}
          onChange={(e) => setAnnouncementTemplate(e.target.value)}
          aria-invalid={announcementProblem ? true : undefined}
        />
        <p className="text-xs text-muted-foreground">
          What the board says aloud when a patient is called. <code>{"{number}"}</code> is the queue number and{" "}
          <code>{"{name}"}</code> is the patient. Leave blank for the default.
        </p>
        {announcementProblem ? (
          <p className="text-xs text-destructive">{announcementProblem}</p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Sounds like: <span className="text-foreground">&ldquo;{announcementPreview}&rdquo;</span>
            </p>
            {canSpeak && (
              <Button type="button" variant="outline" size="sm" onClick={hearAnnouncement} className="shrink-0">
                Hear it
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>System fee</Label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={systemFeeEnabled} onCheckedChange={(c) => setSystemFeeEnabled(c === true)} />
          Add a system fee to every consultation
        </label>
        <Label htmlFor="systemFeePesos" className="mt-1 text-xs text-muted-foreground">
          Amount (₱)
        </Label>
        <Input
          id="systemFeePesos"
          type="number"
          step="0.01"
          min={0}
          inputMode="decimal"
          value={systemFeePesos}
          onChange={(e) => setSystemFeePesos(e.target.value)}
          disabled={!systemFeeEnabled}
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">
          Charged to the patient on top of the consultation fee and medicines, for the use of the queue and booking
          system. It appears as its own line on the doctor&rsquo;s payment screen. The amount is kept while the fee
          is switched off.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" disabled={pending} className="h-11 text-base">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}
