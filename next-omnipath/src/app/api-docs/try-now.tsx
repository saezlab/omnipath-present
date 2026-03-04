"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type JsonTryNowProps = {
  endpoint: string
  initialBody: unknown
  className?: string
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function JsonTryNow({ endpoint, initialBody, className }: JsonTryNowProps) {
  const initialText = useMemo(() => JSON.stringify(initialBody, null, 2), [initialBody])
  const [bodyText, setBodyText] = useState(initialText)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [responseText, setResponseText] = useState<string>("")
  const [errorText, setErrorText] = useState<string>("")

  async function run() {
    setLoading(true)
    setStatus(null)
    setResponseText("")
    setErrorText("")

    try {
      JSON.parse(bodyText)
    } catch (error) {
      setErrorText(`Invalid JSON payload: ${error instanceof Error ? error.message : "Unknown JSON parse error"}`)
      setLoading(false)
      return
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyText,
      })
      setStatus(response.status)
      const text = await response.text()
      const parsed = tryParseJson(text)
      setResponseText(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Request failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`rounded-xl border bg-card/60 p-4 md:p-5 ${className || ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Try now</div>
        {status !== null ? <div className="text-xs text-muted-foreground">Status <span className="font-mono text-foreground">{status}</span></div> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-3">
          <div className="rounded-lg border bg-background/80 p-3">
            <div className="text-[11px] text-muted-foreground font-mono">POST {endpoint}</div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">Request payload (filters + options)</div>
            <Textarea
              className="min-h-64 font-mono text-xs"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
          </div>

          {errorText ? <pre className="max-h-36 overflow-auto rounded-md border bg-destructive/5 p-3 text-xs">{errorText}</pre> : null}
        </div>

        <div className="rounded-lg border bg-background/80 p-3">
          {responseText ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-muted-foreground">Response</div>
                <Button size="sm" onClick={run} disabled={loading}>
                  {loading ? "Running..." : "Run request"}
                </Button>
              </div>
              <pre className="max-h-[34rem] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">{responseText}</pre>
            </div>
          ) : (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/10 p-4 text-center">
              <div className="text-xs text-muted-foreground">Response will appear here</div>
              <Button size="sm" onClick={run} disabled={loading}>
                {loading ? "Running..." : "Run request"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type ExportTryNowProps = {
  url: string
  className?: string
}

export function ExportTryNow({ url, className }: ExportTryNowProps) {
  return (
    <div className={`rounded-lg border p-4 space-y-3 ${className || ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">Try now</div>
        <Button size="sm" asChild>
          <a href={url}>
            Run export
          </a>
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground font-mono break-all">GET {url}</div>
    </div>
  )
}
