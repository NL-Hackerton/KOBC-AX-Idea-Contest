# K-JIT 배포

서버(FastAPI + 수집 스케줄러 + SQLite)는 컨테이너 하나로 돌고, 웹 앱은 GitHub Pages(정적)와 단일 HTML 두 가지로 낸다. 웹 앱은 서버가 응답하지 않으면 내장 저장본으로 바뀌므로, 서버가 멈춰도 URL과 단일 HTML은 열린다.

비용이 드는 단계(호스팅, Anthropic API)는 팀 승인 뒤에만 실행한다.

## 1. 데이터 묶음

```bash
uv run python -m kjit.service.pack
```

`build/kjit-data.tar.gz`(약 21MB)가 만들어진다. 학습된 모델, 재생 사례, 시뮬레이터 사전 계산, 근거·예시 JSON, 수집 DB의 일관된 사본(sqlite backup)이 들어 있다. 원자료(`data/raw`)와 `.env`는 넣지 않는다.

## 2. 로컬 리허설 (비용 없음)

```bash
docker build -t kjit:local .
mkdir -p /tmp/kjit-vol && tar -xzf build/kjit-data.tar.gz -C /tmp/kjit-vol
docker run -d --name kjit-test -p 8081:8080 -e KJIT_INGEST=0 -v /tmp/kjit-vol:/data kjit:local
curl localhost:8081/api/health
```

로컬 확인 시에는 `KJIT_INGEST=0`으로 수집을 끈다(공공데이터 일일 한도를 실서버와 나눠 쓰지 않도록). 2026-10-08 리허설: 전 경로 200, 시뮬레이터 시험 구간 연료 1,922.6t(문서 1,923t), 최고 메모리 815MB.

## 3. 서버 (Fly.io 기준, 승인 뒤)

```bash
fly apps create kjit-<이름>
fly volumes create kjit_data --region nrt --size 3
fly secrets set DATA_GO_KR_KEY=... CORS_ORIGINS=https://nl-hackerton.github.io
fly deploy --config deploy/fly.toml --dockerfile Dockerfile   # 저장소 루트에서 실행
fly ssh sftp shell   # put build/kjit-data.tar.gz /data/ 후
fly ssh console -C "tar -xzf /data/kjit-data.tar.gz -C /data"
fly machine restart
```

- 수집 스케줄러가 계속 돌아야 하므로 머신 자동 정지를 끈다(`auto_stop_machines = "off"`).
- 같은 공공데이터 키를 로컬 서버와 실서버가 함께 쓰면 일일 한도(10,000회)를 나눠 쓴다. 실서버를 켠 뒤 로컬 수집은 끈다(`KJIT_INGEST=0`).
- 가동 감시: `/api/health`의 `lastIngest`가 1시간 넘게 멈추면 알림(외부 감시 서비스 또는 Fly 체크).

## 4. LLM 에이전트 (승인 뒤)

```bash
fly secrets set ANTHROPIC_API_KEY=... KJIT_AGENT_LIVE=1 AGENT_DAILY_USD_CAP=5
```

두 값이 모두 있어야 LLM을 부른다. 하루 사용액(`agent_log` 합계)이 상한을 넘거나 호출·검증이 실패하면 규칙·템플릿 결과로 같은 화면을 유지한다. 기본 모델은 `claude-opus-5-5`(`KJIT_AGENT_MODEL`로 바꿈).

## 5. 웹 앱

- Pages: 저장소 공개 전환(10/26) 뒤 Settings → Pages → Source를 GitHub Actions로 두고, 저장소 변수 `KJIT_API_BASE`에 서버 주소를 넣은 다음 `pages` 워크플로를 수동 실행한다. 결과물에 단일 HTML(`k-jit-single.html`)도 함께 올라간다.
- 단일 HTML: `cd web && VITE_API_BASE=https://<서버> npm run build:single` → `web/dist-single/index.html`. 서버 주소 없이 빌드하면 저장본 전용이다.
- 저장본 갱신: `uv run python -m kjit.service.snapshot` 뒤 웹을 다시 빌드한다(제출 직전 10/28 기준으로 고정).

## 6. 장애 리허설

서버를 멈추고 Pages URL과 단일 HTML을 열어 상단 표식이 "저장본"으로 바뀌는지, 재생·근거·CII·시뮬레이터 격자·에이전트 예시가 보이는지 확인한다. 2026-10-08 단일 HTML(서버 주소 없음)로 조항 추출 예시와 대표 사례 지시문이 저장본으로 표시되는 것을 확인했다.
