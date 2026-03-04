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
    <div className={`rounded-lg border p-4 space-y-3 ${className || ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">Try now</div>
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? "Running..." : "Run request"}
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground font-mono">POST {endpoint}</div>
      <Textarea className="font-mono text-xs min-h-36" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
      {status !== null ? <div className="text-xs">Status: <span className="font-mono">{status}</span></div> : null}
      {errorText ? <pre className="rounded-md border bg-destructive/5 p-3 text-xs overflow-x-auto">{errorText}</pre> : null}
      {responseText ? <pre className="rounded-md border bg-muted/20 p-3 text-xs overflow-x-auto">{responseText}</pre> : null}
    </div>
  )
}

type ExportTryNowProps = {
  url: string
  className?: string
}

export function ExportTryNow({ url, className }: ExportTryNowProps) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [summary, setSummary] = useState<string>("")
  const [errorText, setErrorText] = useState<string>("")
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [filename, setFilename] = useState<string>("export.parquet")

  async function run() {
    setLoading(true)
    setStatus(null)
    setSummary("")
    setErrorText("")
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    setDownloadUrl(null)

    try {
      const response = await fetch(url, { method: "GET" })
      setStatus(response.status)

      if (!response.ok) {
        const text = await response.text()
        setErrorText(text || `Export request failed with status ${response.status}`)
        return
      }

      const rowCount = response.headers.get("X-Export-Row-Count") || "unknown"
      const disposition = response.headers.get("Content-Disposition") || ""
      const matchedName = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
      const nameFromHeader = decodeURIComponent(matchedName?.[1] || matchedName?.[2] || "").trim()
      const resolvedFilename = nameFromHeader || "export.parquet"

      const blob = await response.blob()
      const localUrl = URL.createObjectURL(blob)
      setFilename(resolvedFilename)
      setDownloadUrl(localUrl)
      setSummary(`Rows: ${rowCount} | Bytes: ${blob.size.toLocaleString()} | Type: ${blob.type || "application/x-parquet"}`)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Export request failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${className || ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">Try now</div>
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? "Running..." : "Run export"}
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground font-mono break-all">GET {url}</div>
      {status !== null ? <div className="text-xs">Status: <span className="font-mono">{status}</span></div> : null}
      {summary ? <div className="text-xs text-muted-foreground">{summary}</div> : null}
      {errorText ? <pre className="rounded-md border bg-destructive/5 p-3 text-xs overflow-x-auto">{errorText}</pre> : null}
      {downloadUrl ? (
        <a className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" href={downloadUrl} download={filename}>
          Download {filename}
        </a>
      ) : null}
    </div>
  )
}
