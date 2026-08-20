import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ComingSoon({ title, phase, note }: { title: string; phase: string; note?: string }) {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Building in {phase}.</p>
        {note ? <p>{note}</p> : null}
      </CardContent>
    </Card>
  )
}
