import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownViewProps {
  text: string
}

export function MarkdownView({ text }: MarkdownViewProps) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')

  return (
    <div className="md-shell">
      <div className="md-toolbar" role="tablist" aria-label="Markdown view">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          className={mode === 'preview' ? 'chip selected' : 'chip'}
          onClick={() => setMode('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'source'}
          className={mode === 'source' ? 'chip selected' : 'chip'}
          onClick={() => setMode('source')}
        >
          Source
        </button>
      </div>
      {mode === 'source' ? (
        <pre className="md-editor" tabIndex={0}>
          {text}
        </pre>
      ) : (
        <div className="md-preview" tabIndex={0}>
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      )}
    </div>
  )
}
