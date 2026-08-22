import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function DateRangeForm({ start, end }: { start: string; end: string }) {
  return (
    <form className="flex items-end gap-2" action="/console/reports">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="start">From</label>
        <Input id="start" name="start" type="date" defaultValue={start} className="h-9" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="end">To</label>
        <Input id="end" name="end" type="date" defaultValue={end} className="h-9" />
      </div>
      <Button type="submit" variant="outline" className="h-9">
        Filter
      </Button>
    </form>
  )
}
