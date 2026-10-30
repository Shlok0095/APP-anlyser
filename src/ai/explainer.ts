import type { AnalysisResult, Finding } from '../shared/types/analysis'

export interface AiExplanation {
  findingId: string
  text: string
  hypothesis: boolean
  evidenceIds: string[]
}

export interface AiProvider {
  id: string
  explain(result: AnalysisResult): Promise<AiExplanation[]>
}

export class EvidenceRestatingProvider implements AiProvider {
  id = 'deterministic-local'

  async explain(result: AnalysisResult): Promise<AiExplanation[]> {
    return result.findings.map((finding) => this.explainFinding(finding))
  }

  explainFinding(finding: Finding): AiExplanation {
    const evidenceIds = finding.evidence.map((item) => item.id)
    const evidenceNotes = finding.evidence.map((item) => item.note).join('; ')
    return {
      findingId: finding.id,
      text: `${finding.title}. Evidence: ${evidenceNotes || 'none recorded'}. ${finding.explanation} Suggested fix: ${finding.remediation}`,
      hypothesis: false,
      evidenceIds
    }
  }
}

export async function explainWithOptionalRemote(
  result: AnalysisResult,
  options: { mode: 'off' | 'local' | 'cloud'; endpoint?: string }
): Promise<{ explanations: AiExplanation[]; skipped?: string }> {
  const local = new EvidenceRestatingProvider()
  if (options.mode === 'off') {
    return { explanations: [], skipped: 'AI explanations are disabled.' }
  }
  const baseline = await local.explain(result)
  if (!options.endpoint) {
    return {
      explanations: baseline,
      skipped: 'No remote model configured; used evidence-restating explanations only.'
    }
  }
  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'uaa-local',
        prompt: `Explain these evidence-backed findings without inventing files or vulnerabilities:\n${JSON.stringify(
          result.findings.map((f) => ({
            id: f.id,
            title: f.title,
            evidence: f.evidence.map((e) => e.note)
          }))
        )}`,
        stream: false
      }),
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) {
      return {
        explanations: baseline,
        skipped: `Remote model HTTP ${response.status}; fell back to local explanations.`
      }
    }
    const json = (await response.json()) as { response?: string }
    if (!json.response) {
      return {
        explanations: baseline,
        skipped: 'Remote model returned no text; used local explanations.'
      }
    }
    return {
      explanations: baseline.map((item) => ({
        ...item,
        text: `${item.text}\nModel note (must not invent facts): ${json.response?.slice(0, 400)}`,
        hypothesis: true
      }))
    }
  } catch {
    return {
      explanations: baseline,
      skipped: 'Remote model was unreachable; used local explanations.'
    }
  }
}
