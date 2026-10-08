"""수집 스케줄러: 입출항 신고 30분, 울산 위치 5분. 신고 수집 뒤에는 상태 문맥을 다시 만든다."""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from kjit.service import ingest

log = logging.getLogger("kjit.scheduler")


def start(ctx) -> BackgroundScheduler:
    sched = BackgroundScheduler(timezone="Asia/Seoul", job_defaults={"coalesce": True, "max_instances": 1,
                                                                     "misfire_grace_time": 600})

    def calls_job() -> None:
        n = ingest.ingest_calls()
        log.info("calls ingest: %s changed", n)
        if ctx is not None:
            ctx.refresh()

    def positions_job() -> None:
        log.info("positions ingest: %s new", ingest.ingest_positions())

    sched.add_job(calls_job, "interval", minutes=30, id="calls")
    sched.add_job(positions_job, "interval", minutes=5, id="positions")
    sched.start()
    # 시작 직후 한 번 신고를 받는다 (백그라운드)
    sched.add_job(calls_job, id="calls-boot")
    return sched
