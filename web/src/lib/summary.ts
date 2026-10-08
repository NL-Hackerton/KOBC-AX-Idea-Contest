import type { Condition, DecisionSummary, LiveDecision, ReplayCase, Risk } from '../types'

/** 설명·문안 생성 입력. 서버 kjit/service/agent_examples.summary_from_replay 와 키가 같다. */
export function fromReplay(c: ReplayCase, cond: Condition, risk: Risk): DecisionSummary {
  const r = c.conditions[cond]
  const p = r.policies[risk]
  return {
    port: c.port,
    berth: c.berth,
    vessel: c.vessel,
    group: c.group,
    gt: c.gt,
    tau: c.tau,
    a0: c.a0,
    condition: cond,
    risk,
    quantilesH: r.quantilesH,
    busyAtTau: c.busyAtTau && r.queue.length > 0,
    queue: r.queue.map((m) => ({ vessel: m.vessel, status: m.status })),
    policy: { rta: p.rta, delayH: p.delayH, speedKn: p.speedKn, fuelT: p.fuelT, co2T: p.co2T },
    designSpeedKn: c.designSpeedKn,
    maxDelayH: c.maxDelayH,
  }
}

export function fromLive(d: LiveDecision, risk: Risk, port: string, vessel: string, group: string, gt: number | null): DecisionSummary {
  const p = d.policies[risk]
  return {
    port,
    berth: d.berth,
    vessel,
    group,
    gt,
    tau: d.tau,
    a0: d.a0,
    condition: d.condition,
    risk,
    quantilesH: d.quantilesH,
    busyAtTau: d.busyAtTau,
    queue: d.queue.map((m) => ({ vessel: m.vessel, status: m.status })),
    policy: { rta: p.rta, delayH: p.delayH, speedKn: p.speedKn, fuelT: p.fuelT, co2T: p.co2T },
    designSpeedKn: d.designSpeedKn,
    maxDelayH: d.maxDelayH,
  }
}
