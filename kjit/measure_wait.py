"""항차 표에서 정박지 대기를 추정한다 (go/no-go 판별 실험).

선박운항정보에는 정박지에서 선석으로 옮긴 시각이 없다. 그래서 같은 선석을 쓴
선박들의 출항 시각을 이어 붙여 선석이 비는 시각을 복원한다.

- 정박지 경유 항차: 입항 계선시설이 정박지이고 출항 계선시설이 선석인 항차
- 선행 선박: 같은 선석에서 이 항차보다 먼저 출항한 마지막 선박
- 선석 대기 하한: max(0, 선행 선박 출항 시각 - 이 항차 정박지 입항 시각)

이동(shift)에 걸린 시간과 선석 외 사유(조석·도선·화물 준비)는 빼므로 하한값이다.
한 선석에 여러 척이 동시에 붙는 시설은 선행 선박을 정할 수 없으므로, 직접 접안한
항차들의 체류 구간이 겹치는 비율로 다중 접안 시설을 찾아 대기 추정에서 제외한다.

    uv run python -m kjit.measure_wait
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CALLS = ROOT / "data" / "processed" / "calls.parquet"
OUT_DIR = ROOT / "data" / "processed"

OVERLAP_TOL = pd.Timedelta(minutes=30)
MULTI_BERTH_OVERLAP = 0.10  # 직접 접안 항차의 10% 넘게 겹치면 다중 접안 시설로 본다
MIN_DIRECT_CALLS = 5


def ship_group(kind: str | None) -> str:
    k = kind or ""
    if any(s in k for s in ("원유", "석유", "케미칼", "LPG", "LNG", "가스", "유조")):
        return "탱커·가스"
    if any(s in k for s in ("산물", "벌크", "광석", "석탄", "시멘트", "곡물", "모래")):
        return "벌크"
    if "컨테이너" in k:
        return "컨테이너"
    if "자동차" in k:
        return "자동차운반"
    if any(s in k for s in ("일반화물", "잡화", "냉동", "다목적", "철강", "화물선")):
        return "일반화물"
    if any(s in k for s in ("예선", "예인", "급유", "급수", "부선", "도선", "작업", "어선", "관공", "여객", "준설", "통선", "바지")):
        return "작업·지원·여객"
    return "기타"


def is_anchorage(name: object) -> bool:
    return isinstance(name, str) and "정박지" in name


def berth_key(df: pd.DataFrame, side: str) -> pd.Series:
    return df["prtAgCd"] + "|" + df[f"{side}_laidupFcltyCd"].fillna("") + "|" + df[f"{side}_laidupFcltySubCd"].fillna("")


def classify(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["group"] = df["vsslKndNm"].map(ship_group)
    in_anch = df["in_laidupFcltyNm"].map(is_anchorage)
    out_anch = df["out_laidupFcltyNm"].map(is_anchorage)
    bunker = df["in_laidupFcltyNm"].fillna("").str.contains("벙커링")
    has_out = df["out_time"].notna() & df["out_laidupFcltyNm"].notna()
    df["route"] = np.select(
        [~in_anch, in_anch & bunker, in_anch & has_out & ~out_anch, in_anch],
        ["직접 접안", "벙커링 정박지", "정박지→선석", "정박지 체류만"],
        default="기타",
    )
    df["in_berth"] = berth_key(df, "in")
    df["out_berth"] = berth_key(df, "out")
    df["stay_h"] = (df["out_time"] - df["in_time"]).dt.total_seconds() / 3600
    return df


def multi_occupancy(df: pd.DataFrame) -> pd.DataFrame:
    """직접 접안해서 같은 선석에서 출항한 항차의 체류 구간 겹침 비율."""
    d = df[(df["route"] == "직접 접안") & (df["in_berth"] == df["out_berth"]) & df["out_time"].notna()]
    rows = []
    for b, g in d.sort_values("in_time").groupby("out_berth"):
        prev_out = g["out_time"].cummax().shift()
        overlap = (g["in_time"] < prev_out - OVERLAP_TOL).sum()
        n = len(g)
        rows.append({"berth": b, "name": g["out_laidupFcltyNm"].iloc[0], "direct_calls": n, "overlap_rate": overlap / max(n - 1, 1)})
    occ = pd.DataFrame(rows)
    occ["single"] = (occ["direct_calls"] >= MIN_DIRECT_CALLS) & (occ["overlap_rate"] <= MULTI_BERTH_OVERLAP)
    return occ


def berth_wait(df: pd.DataFrame, occ: pd.DataFrame) -> pd.DataFrame:
    single = set(occ.loc[occ["single"], "berth"])
    deps = df[df["out_time"].notna()][["out_berth", "out_time"]].sort_values("out_time")
    target = df[(df["route"] == "정박지→선석") & df["out_berth"].isin(single)].copy()
    waits = []
    utc = lambda s: s.dt.tz_convert("UTC").dt.tz_localize(None).to_numpy()  # noqa: E731
    by_berth = {b: utc(g["out_time"]) for b, g in deps.groupby("out_berth")}
    for idx, r in target.iterrows():
        times = by_berth.get(r["out_berth"])
        pos = np.searchsorted(times, np.datetime64(r["out_time"].tz_convert("UTC").tz_localize(None)), side="left") if times is not None else 0
        if times is None or pos == 0:
            waits.append((idx, np.nan, None))
            continue
        pred_out = pd.Timestamp(times[pos - 1]).tz_localize("UTC").tz_convert("Asia/Seoul")
        w = max(0.0, (pred_out - r["in_time"]).total_seconds() / 3600)
        w = min(w, r["stay_h"])
        waits.append((idx, w, pred_out))
    w = pd.DataFrame(waits, columns=["idx", "berth_wait_h", "pred_out"]).set_index("idx")
    target = target.join(w)
    return target


def summarize(df: pd.DataFrame, waits: pd.DataFrame) -> pd.DataFrame:
    cargo = df[~df["group"].isin(["작업·지원·여객"])]
    cargo_waits = waits[~waits["group"].isin(["작업·지원·여객"])]
    rows = []
    for port, g in cargo.groupby("prtAgNm"):
        wt = cargo_waits[cargo_waits["prtAgNm"] == port]["berth_wait_h"].dropna()
        n = len(g)
        rows.append({
            "항만": port,
            "화물선 항차": n,
            "직접 접안 %": round(100 * (g["route"] == "직접 접안").mean(), 1),
            "정박지→선석 %": round(100 * (g["route"] == "정박지→선석").mean(), 1),
            "정박지 체류만 %": round(100 * (g["route"] == "정박지 체류만").mean(), 1),
            "대기 추정 항차": len(wt),
            "대기 중앙값 h": round(wt.median(), 1) if len(wt) else np.nan,
            "대기 p75 h": round(wt.quantile(0.75), 1) if len(wt) else np.nan,
            "대기 p90 h": round(wt.quantile(0.90), 1) if len(wt) else np.nan,
            "12h 이상 %": round(100 * (wt >= 12).mean(), 1) if len(wt) else np.nan,
            "대기 합계 h": round(wt.sum()),
            "대기 합계 h (72h 상한)": round(wt.clip(upper=72).sum()),
        })
    return pd.DataFrame(rows).sort_values("화물선 항차", ascending=False)


def main() -> None:
    df = classify(pd.read_parquet(CALLS))
    occ = multi_occupancy(df)
    waits = berth_wait(df, occ)
    summary = summarize(df, waits)

    pd.set_option("display.width", 200)
    print("== 항만별 요약 (작업·지원·여객선 제외)")
    print(summary.to_string(index=False))
    print("\n== 선종별 (정박지→선석, 단일 접안 선석, 대기 추정값)")
    print(waits.groupby("group")["berth_wait_h"].describe(percentiles=[0.5, 0.75, 0.9]).round(1).to_string())
    print(f"\n단일 접안 선석 {occ['single'].sum()} / 전체 {len(occ)} (직접 접안 {MIN_DIRECT_CALLS}회 이상·겹침 {MULTI_BERTH_OVERLAP:.0%} 이하)")

    summary.to_csv(OUT_DIR / "wait_summary.csv", index=False)
    occ.to_csv(OUT_DIR / "berth_occupancy.csv", index=False)
    waits.drop(columns=["in_berth"]).to_parquet(OUT_DIR / "berth_waits.parquet", index=False)


if __name__ == "__main__":
    main()
