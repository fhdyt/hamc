import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { toolPreview } from '../../lib/feed'
import type { Step } from '../../lib/transcript'

const SHORT = 70

function timeLabel(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`
}

function pretty(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}

/** One tool call: name, short arguments, approximate duration and a guess whether it failed. Opens to input and output. */
export function ToolChip({ step }: { step: Step }) {
  const [open, setOpen] = useState(false)
  const name = step.name ?? 'tool'
  const compact = toolPreview(step.args ?? '')
  const brief = compact.length > SHORT ? `${compact.slice(0, SHORT)}…` : compact
  const output = step.result?.text ?? (step.args === '' ? step.item.text : null)
  return (
    <div className={`ses-tool${step.failed ? ' failed' : ''}`}>
      <button type="button" className="ses-tool-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chev-down' : 'chev-right'} size={12} />
        <Icon name="tool" size={11} />
        <span className="ses-tool-name">{name}</span>
        {brief && <span className="ses-tool-args">{brief}</span>}
        {step.ms !== undefined && <span className="ses-tool-ms num">{timeLabel(step.ms)}</span>}
        {step.failed && (
          <span className="ses-tool-fail" title="Detected from the result text; it may be wrong">
            failed?
          </span>
        )}
      </button>
      {open && (
        <div className="ses-tool-body">
          {step.args !== undefined && step.args !== '' && (
            <>
              <span className="ses-tool-lbl">Input</span>
              <pre>{pretty(step.args)}</pre>
            </>
          )}
          <span className="ses-tool-lbl">Output</span>
          <pre>{output ?? 'No result recorded yet.'}</pre>
          {(step.result?.truncated || (step.args === '' && step.item.truncated)) && <span className="ses-tool-lbl">The output was cut short in the transcript.</span>}
        </div>
      )}
    </div>
  )
}
