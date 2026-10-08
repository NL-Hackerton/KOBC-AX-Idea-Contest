import type { AgentMeta } from '../types'

const REASON: Record<string, string> = {
  disabled: 'LLM이 꺼져 있어 규칙·템플릿으로 만들었습니다',
  cap: '오늘 LLM 비용 상한에 도달해 규칙·템플릿으로 만들었습니다',
  error: 'LLM 호출이 실패해 규칙·템플릿으로 만들었습니다',
  ungrounded: 'LLM 답변에 엔진 결과에 없는 수치가 있어 템플릿으로 바꿨습니다',
  unverified: 'LLM 결과를 원문에서 확인하지 못해 규칙 결과로 바꿨습니다',
  refusal: 'LLM이 응답하지 않아 규칙·템플릿으로 만들었습니다',
  max_tokens: 'LLM 응답이 잘려 규칙·템플릿으로 만들었습니다',
  'invalid-json': 'LLM 응답 형식이 맞지 않아 규칙 결과로 바꿨습니다',
  'too-many-turns': 'LLM 도구 호출이 길어져 규칙으로 답했습니다',
  example: '서버에 연결되어 있지 않아 저장된 예시 결과를 보여줍니다',
}

export default function GenBadge({ meta, offline }: { meta: AgentMeta; offline?: boolean }) {
  const llm = meta.generatedBy === 'llm'
  const reason = offline ? REASON.example : meta.fallbackReason ? REASON[meta.fallbackReason] ?? meta.fallbackReason : ''
  return (
    <p className={`gen small ${llm ? 'gen-llm' : 'gen-rule'}`}>
      <span className="gen-tag">{llm ? 'LLM 생성, 사람 검토 필요' : '규칙·템플릿'}</span>
      {reason && <span className="muted"> {reason}</span>}
      {!!meta.ungrounded?.length && <span className="gen-warn"> 도구 결과에서 확인되지 않은 수치: {meta.ungrounded.join(', ')}</span>}
    </p>
  )
}
