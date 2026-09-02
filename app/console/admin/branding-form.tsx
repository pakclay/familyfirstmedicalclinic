"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateBrandingAction } from "./actions"

/**
 * `brandName` is null when the company has never set one, which is not the
 * same as an empty string the admin typed — but the input can only hold a
 * string, so null renders as blank and `placeholder` carries what blank
 * actually resolves to. Submitting blank stores null again.
 */
export function BrandingForm({
  brandName,
  defaultAppName,
}: {
  brandName: string | null
  defaultAppName: string
}) {
  const [value, setValue] = useState(brandName ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    const res = await updateBrandingAction({ brandName: value })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSaved(true)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-4 py-3 sm:max-w-md">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brandName">App name</Label>
        <Input
          id="brandName"
          value={value}
          maxLength={80}
          placeholder={defaultAppName}
          onChange={(e) => setValue(e.target.value)}
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">
          Shown in the browser tab, on the sign-in page, in the header, and above the clinic name on the public
          booking page. Leave it blank to use &ldquo;{defaultAppName}&rdquo;.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" disabled={pending} className="h-11 text-base sm:h-10 sm:text-sm">
        {pending ? "Saving…" : "Save app name"}
      </Button>
    </form>
  )
}
