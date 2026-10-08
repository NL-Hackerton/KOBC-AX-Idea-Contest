export type Condition = 'public' | 'lineup' | 'plan'
export type Risk = '0.1' | '0.2' | '0.3' | '0.5'

export interface QueueMember {
  vessel: string
  callsign: string
  group?: string
  status: 'berthed' | 'waiting' | 'planned'
  source?: string
  elapsedH: number | null
  arrivedAt: string | null
  plannedAt: string | null
  predQ: number[]
  actualDepart?: string | null
}

export interface Policy {
  rta: string
  delayH: number
  speedKn: number
  fuelT: number
  co2T: number
  residualWaitH?: number
  extraIdleH?: number
}

export interface CondResult {
  quantilesH: number[]
  queue: QueueMember[]
  policies: Record<Risk, Policy>
}

export interface ReplayCase {
  id: string
  port: string
  portCode: string
  vessel: string
  callsign: string
  group: string
  kind: string
  gt: number | null
  cargoTon: number | null
  domestic: boolean
  berth: string
  anchorage: string
  a0: string
  tau: string
  horizonH: number
  designSpeedKn: number
  fuelPerDayT: number
  maxDelayH: number
  actualFree: string
  actualWaitH: number
  busyAtTau: boolean
  conditions: Record<Condition, CondResult>
}

export interface ReplayIndex {
  period: string[]
  featured: string[]
  nominal: number[]
  riskLevels: number[]
  conditions: Record<Condition, { label: string; desc: string }>
  cases: ReplayCase[]
}

export interface LiveDecision extends CondResult {
  basis: 'live'
  tau: string
  a0: string
  horizonH: number
  busyAtTau: boolean
  condition: Condition
  berth: string
  designSpeedKn: number
  fuelPerDayT: number
  maxDelayH: number
}

export interface BerthOcc {
  berthKey: string
  berth: string
  vessel: string
  callsign: string
  group: string
  gt: number | null
  since: string
  elapsedH: number
  predQ: number[]
  source: string
  actualDepart: string | null
  declaredDepart: string | null
}

export interface Waiting {
  vessel: string
  callsign: string
  group: string
  since: string
  waitedH: number
  targetBerth: string | null
  targetKey: string | null
  source: string
  gt: number | null
  anchorage?: string
}

export interface Inbound {
  id: string
  vessel: string
  callsign: string
  group: string
  kind: string
  gt: number | null
  eta: string
  facility: string
  targetKey: string | null
  domestic: boolean
  source: string
}

export interface PortState {
  port: string
  at: string
  live: boolean
  updatedAt: string
  berths: BerthOcc[]
  anchorage: Waiting[]
  inbound: Inbound[]
  shiftedByPosition: number
  positions: { callsign: string; name: string; lat: number; lon: number; sog: number; t: string }[]
  singleBerths: { key: string; name: string }[]
}

export interface PortInfo {
  code: string
  name: string
  berths: { key: string; name: string }[]
}

// ---- 에이전트 ----

export interface DecisionSummary {
  port: string
  berth: string
  vessel: string
  group: string
  gt: number | null
  tau: string
  a0: string
  condition: Condition
  risk: Risk
  quantilesH: number[]
  busyAtTau: boolean
  queue: { vessel: string; status: string }[]
  policy: { rta: string; delayH: number; speedKn: number; fuelT: number; co2T: number }
  designSpeedKn: number
  maxDelayH: number
}

export interface AgentMeta {
  generatedBy: 'llm' | 'fallback'
  fallbackReason?: string
  ungrounded?: string[]
  rejected?: string[]
}

export interface Clause {
  kind: string
  label: string
  quote: string
  start: number
  end: number
  note: string
}

export interface ContractResult extends AgentMeta {
  clauses: Clause[]
  assessment: string
}

export interface LineupShip {
  berth: string | null
  berthKey: string | null
  order: number
  vessel: string
  status: 'berthed' | 'waiting' | 'inbound'
  time: string | null
  cargo: string | null
  line: string | null
}

export interface LineupResult extends AgentMeta {
  port: string | null
  ships: LineupShip[]
}

export interface ExplainResult extends AgentMeta {
  text: string
}

export interface DraftResult extends AgentMeta {
  ko: string
  en: string
}

export interface ToolCall {
  name: string
  input: Record<string, unknown>
  ok: boolean
  result: unknown
}

export interface ChatResult extends AgentMeta {
  answer: string
  tools: ToolCall[]
}

export interface AgentExamples {
  contracts: { id: string; title: string; text: string; result: ContractResult }[]
  mails: { id: string; title: string; port: string; text: string; result: LineupResult }[]
  questions: string[]
  explain: Record<string, ExplainResult>
  drafts: Record<string, { master: DraftResult; charterer: DraftResult }>
}
