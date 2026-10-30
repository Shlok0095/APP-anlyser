import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnalysisInput, AnalysisProfile, InputKind, TargetType } from '@shared/types/engine'
import { DEFAULT_PROFILE } from '@shared/types/engine'
import { missingAnalysisTarget } from '@shared/validation/input'
import { TypeIcon } from '../assets/types/TypeIcon'
import { getDesktopApi } from '../services/desktop-api'
import { useJobs } from '../hooks/useJobs'
import { useJobReport } from '../hooks/useJobReport'
import { MarkdownView } from '../components/MarkdownView'

interface TypeCard {
  id: TargetType
  title: string
  detail: string
}

const TYPE_CARDS: TypeCard[] = [
  { id: 'android', title: 'Android APK', detail: 'APK / AAB / Play / ADB' },
  { id: 'windows', title: 'Windows EXE', detail: 'EXE, MSI, Electron' },
  { id: 'website', title: 'Web App', detail: 'ZIP, folder, URL' },
  { id: 'tool', title: 'Tool / Utility', detail: 'Source, installer, CLI' },
  { id: 'package', title: 'Python Package', detail: 'requirements.txt, wheel' },
  { id: 'container', title: 'Docker Image', detail: 'Dockerfile / compose' },
  { id: 'archive', title: 'Other', detail: 'ZIP and custom files' }
]

function defaultKind(type: TargetType): InputKind {
  if (
    type === 'source' ||
    type === 'tool' ||
    type === 'container' ||
    type === 'package' ||
    type === 'website'
  ) {
    return 'folder'
  }
  return 'file'
}

export function AnalyzePage() {
  const { jobs, refresh, error: jobsError } = useJobs()
  const [targetType, setTargetType] = useState<TargetType>('windows')
  const [inputKind, setInputKind] = useState<InputKind>('file')
  const [path, setPath] = useState('')
  const [url, setUrl] = useState('')
  const [packageName, setPackageName] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [profile, setProfile] = useState<AnalysisProfile>(DEFAULT_PROFILE)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info')
  const [trackedId, setTrackedId] = useState<string | null>(null)
  const trackedJob = useMemo(
    () => (trackedId ? jobs.find((job) => job.id === trackedId) : jobs[0]),
    [jobs, trackedId]
  )
  const displayJob = trackedJob
  const running = displayJob?.status === 'queued' || displayJob?.status === 'running'
  const { report, evidence } = useJobReport(
    displayJob?.status === 'completed' ? displayJob.id : undefined,
    displayJob?.updatedAt
  )

  useEffect(() => {
    if (!displayJob) {
      return
    }
    if (displayJob.status === 'completed') {
      setMessageTone('info')
      setMessage('Done. Markdown is in Report.')
    }
    if (displayJob.status === 'failed') {
      setMessageTone('error')
      setMessage(displayJob.errors[0] ?? 'Analysis failed. See the log below.')
    }
  }, [displayJob])

  const pick = async (): Promise<void> => {
    const api = getDesktopApi()
    if (!api) {
      setMessage('Desktop API unavailable.')
      return
    }
    if (inputKind === 'folder') {
      const folder = await api.pickFolder()
      if (folder) {
        setPath(folder)
      }
      return
    }
    const file = await api.pickFile()
    if (file) {
      setPath(file)
    }
  }

  const start = async (): Promise<void> => {
    const api = getDesktopApi()
    if (!api) {
      setMessage('Desktop API unavailable. Start the Electron shell to run analysis.')
      return
    }
    const input: AnalysisInput = {
      targetType,
      inputKind,
      label: path || url || packageName || targetType,
      path: path || undefined,
      url: url || undefined,
      packageName: packageName || undefined,
      deviceId: deviceId || undefined,
      profile
    }
    const missing = missingAnalysisTarget(input)
    if (missing) {
      setMessageTone('error')
      setMessage(missing)
      return
    }
    setBusy(true)
    setMessageTone('info')
    setMessage('Starting analysis…')
    try {
      const job = await api.createJob(input)
      setTrackedId(job.id)
      setMessage(
        job.status === 'failed'
          ? (job.errors[0] ?? 'Job failed before engines started.')
          : `Job ${job.status}. REA progress appears below.`
      )
      setMessageTone(job.status === 'failed' ? 'error' : 'info')
      await refresh()
    } catch (error) {
      setMessageTone('error')
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="analyze-page">
      <div className="analyze-main">
        <section className="panel">
          <div className="panel-kicker">Target</div>
          <p className="muted">Pick a type, choose a file, start analysis.</p>
          <div className="type-grid">
            {TYPE_CARDS.map((card) => {
              const selected = targetType === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  className={selected ? 'type-card selected' : 'type-card'}
                  onClick={() => {
                    setTargetType(card.id)
                    setInputKind(defaultKind(card.id))
                  }}
                >
                  <TypeIcon type={card.id} />
                  <span>
                    <strong>{card.title}</strong>
                    <span>{card.detail}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-kicker">File</div>
          <div className="input-kind-row">
            {(['file', 'folder', 'url', 'package-name', 'device-package'] as InputKind[]).map(
              (kind) => (
                <button
                  key={kind}
                  type="button"
                  className={inputKind === kind ? 'chip selected' : 'chip'}
                  onClick={() => setInputKind(kind)}
                >
                  {kind}
                </button>
              )
            )}
          </div>
          {(inputKind === 'file' || inputKind === 'folder') && (
            <div className="dropzone">
              <button type="button" className="button" onClick={() => void pick()}>
                Browse
              </button>
              <input
                className="text-input"
                placeholder="C:\path\to\app.exe"
                value={path}
                onChange={(event) => setPath(event.target.value)}
              />
            </div>
          )}
          {inputKind === 'url' && (
            <input
              className="text-input"
              placeholder="https://play.google.com/... or http://127.0.0.1:..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
          {inputKind === 'package-name' && (
            <input
              className="text-input"
              placeholder="com.example.app"
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
            />
          )}
          {inputKind === 'device-package' && (
            <div className="button-row">
              <input
                className="text-input"
                placeholder="Device id"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
              />
              <input
                className="text-input"
                placeholder="Package name"
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
              />
            </div>
          )}
          <div className="profile-row">
            {(
              [
                ['architecture', 'Architecture'],
                ['dependencies', 'Dependencies'],
                ['security', 'Security'],
                ['api', 'API inspection'],
                ['runtime', 'Runtime'],
                ['ai', 'AI explanations'],
                ['allowNetwork', 'Allow network']
              ] as Array<[keyof AnalysisProfile, string]>
            ).map(([key, label]) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={Boolean(profile[key])}
                  onChange={(event) => setProfile({ ...profile, [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="start-btn"
            disabled={busy || running}
            onClick={() => void start()}
          >
            {busy || running ? 'Analysis running…' : 'Start Analysis'}
          </button>
          {running && displayJob ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                void getDesktopApi()?.cancelJob(displayJob.id)
              }}
            >
              Cancel
            </button>
          ) : null}
          {jobsError ? (
            <p className="status-error" role="alert">
              {jobsError}
            </p>
          ) : null}
          {message ? (
            <p className={messageTone === 'error' ? 'status-error' : 'status-info'} role="status">
              {message}
            </p>
          ) : null}
          {displayJob ? (
            <section className="job-trace" aria-live="polite">
              <div className="job-trace-head">
                <strong>
                  {displayJob.status.toUpperCase()}
                  {displayJob.status === 'completed'
                    ? ' · 100%'
                    : displayJob.progressPercent !== undefined
                      ? ` · ${displayJob.progressPercent}%`
                      : ''}
                </strong>
                <span>{displayJob.progressLabel || displayJob.targetLabel}</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div
                  className="progress-fill"
                  style={{
                    width: `${
                      displayJob.status === 'completed'
                        ? 100
                        : displayJob.status === 'failed'
                          ? 100
                          : Math.max(running ? 8 : 0, displayJob.progressPercent ?? 0)
                    }%`
                  }}
                />
              </div>
              <ol className="trace-log">
                {displayJob.logs.slice(-12).map((entry) => (
                  <li key={`${entry.at}-${entry.message}`}>{entry.message}</li>
                ))}
              </ol>
              {displayJob.errors.length > 0 ? (
                <p className="status-error">{displayJob.errors.join(' ')}</p>
              ) : null}
              {displayJob.warnings.length > 0 ? (
                <p className="status-info">{displayJob.warnings.slice(-2).join(' ')}</p>
              ) : null}
            </section>
          ) : null}
          {displayJob?.status === 'completed' ? (
            <Link className="button primary" to={`/report/${displayJob.id}`}>
              Open report
            </Link>
          ) : null}
        </section>
      </div>

      <aside className="results-panel panel">
        <div className="panel-kicker">Evidence</div>
        {evidence ? (
          <MarkdownView text={evidence.content} />
        ) : report ? (
          <MarkdownView text={report.content} />
        ) : displayJob?.status === 'running' || displayJob?.status === 'queued' ? (
          <p className="muted">Evidence appears here when analysis finishes.</p>
        ) : (
          <p className="muted">Run an analysis to see the reconstruction pack here.</p>
        )}
      </aside>
    </div>
  )
}
