"""선석 가용 확률 예측(B): 점유 선박의 잔여 출항 시간(RTD) 분위수 예측과 conformal 보정.

시간순 분할: 학습 ~2026-05, 보정 2026-06~07, 시험 2026-08~09.
- 기준선 H: 같은 선석 최근 5개 항차 체류 중앙값 - 경과 시간 (구간은 보정 잔차의 분위수로 만든다)
- 모델 G: HistGradientBoosting 분위수 회귀(q=0.1, 0.5, 0.9), 목표는 log1p(RTD).
  보정 구간에서 CQR(conformalized quantile regression)로 80% 구간 폭을 맞춘다.

    uv run python -m kjit.forecast
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
TRAIN_END = pd.Timestamp("2026-06-01", tz="Asia/Seoul")
CALIB_END = pd.Timestamp("2026-08-01", tz="Asia/Seoul")
QS = (0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9)
ALPHA = 0.2  # 80% 구간

CAT = ["prtAgNm", "group", "vsslKndNm", "in_ibobprtNm", "etryptPurpsNm", "in_tugYn", "in_piltgYn", "is_kr"]
NUM = ["elapsed_h", "gt", "in_ldadngTon", "hour", "dow", "month", "berth_med_h", "berth_last_h", "anch_queue"]


def prepare(s: pd.DataFrame, levels: dict[str, list[str]] | None = None) -> tuple[pd.DataFrame, list[bool], dict[str, list[str]]]:
    """범주형은 학습 때의 수준(levels)을 그대로 써야 새 표본에서도 같은 코드가 붙는다."""
    x = s.copy()
    x["is_kr"] = (x["vsslNltyCd"] == "KR").astype(str)
    levels = dict(levels or {})
    for c in CAT:
        v = x[c].fillna("NA").astype(str)
        if c not in levels:
            levels[c] = sorted(v.unique())
        x[c] = pd.Categorical(v, categories=levels[c])
    X = x[CAT + NUM]
    return X, [True] * len(CAT) + [False] * len(NUM), levels


def predict_quantiles(bundle: dict, s: pd.DataFrame) -> dict[float, np.ndarray]:
    """저장한 모델 묶음으로 RTD 분위수를 예측한다 (분위수 교차는 정렬로 정리)."""
    X, _, _ = prepare(s, bundle["levels"])
    qs = sorted(bundle["models"])
    P = np.sort(np.column_stack([np.expm1(bundle["models"][q].predict(X)) for q in qs]), axis=1)
    return {q: np.clip(P[:, i], 0, None) for i, q in enumerate(qs)}


def pinball(y, q, tau):
    d = y - q
    return np.mean(np.maximum(tau * d, (tau - 1) * d))


def evaluate(name: str, y: np.ndarray, lo: np.ndarray, med: np.ndarray, hi: np.ndarray) -> dict:
    return {
        "모델": name,
        "MAE(중앙값) h": round(float(np.mean(np.abs(y - med))), 2),
        "pinball 평균": round(float(np.mean([pinball(y, lo, 0.1), pinball(y, med, 0.5), pinball(y, hi, 0.9)])), 2),
        "80% 구간 적중률": round(float(np.mean((y >= lo) & (y <= hi))), 3),
        "80% 구간 평균 폭 h": round(float(np.mean(hi - lo)), 1),
    }


def main() -> None:
    s = pd.read_parquet(PROC / "berth_samples.parquet")
    s = s[s["group"] != "작업·지원·여객"].reset_index(drop=True)
    X, cat_mask, levels = prepare(s)
    y = s["rtd_h"].to_numpy()
    tr = (s["t"] < TRAIN_END).to_numpy()
    ca = ((s["t"] >= TRAIN_END) & (s["t"] < CALIB_END)).to_numpy()
    te = (s["t"] >= CALIB_END).to_numpy()
    print(f"표본: 학습 {tr.sum():,} / 보정 {ca.sum():,} / 시험 {te.sum():,}")

    # 기준선 H: 선석 이력 중앙값 - 경과, 구간은 보정 잔차 분위수
    h_point = np.clip(s["berth_med_h"].fillna(s.loc[tr, "dur_h"].median()) - s["elapsed_h"], 0.5, None).to_numpy()
    res = y[ca] - h_point[ca]
    r_lo, r_hi = np.quantile(res, [0.1, 0.9])
    h_lo, h_hi = np.clip(h_point + r_lo, 0, None), h_point + r_hi

    # 모델 G: 분위수 GBM (log1p 목표)
    preds, models = {}, {}
    for q in QS:
        m = HistGradientBoostingRegressor(
            loss="quantile", quantile=q, max_iter=400, learning_rate=0.05,
            max_leaf_nodes=31, min_samples_leaf=40, categorical_features=cat_mask, random_state=0,
        )
        m.fit(X[tr], np.log1p(y[tr]))
        models[q] = m
        preds[q] = np.expm1(m.predict(X))
    g_lo, g_med, g_hi = preds[0.1], preds[0.5], preds[0.9]
    g_lo, g_hi = np.minimum(g_lo, g_med), np.maximum(g_hi, g_med)

    # CQR: 보정 구간 비적합 점수의 (1-alpha) 분위수만큼 구간을 넓히거나 좁힌다 (log 척도)
    ly = np.log1p(y)
    score = np.maximum(np.log1p(g_lo[ca]) - ly[ca], ly[ca] - np.log1p(g_hi[ca]))
    n = ca.sum()
    qhat = np.quantile(score, min(1.0, np.ceil((n + 1) * (1 - ALPHA)) / n))
    c_lo = np.clip(np.expm1(np.log1p(g_lo) - qhat), 0, None)
    c_hi = np.expm1(np.log1p(g_hi) + qhat)

    rows = [
        evaluate("기준선 H (선석 이력)", y[te], h_lo[te], h_point[te], h_hi[te]),
        evaluate("분위수 GBM", y[te], g_lo[te], g_med[te], g_hi[te]),
        evaluate("분위수 GBM + CQR", y[te], c_lo[te], g_med[te], c_hi[te]),
    ]
    out = pd.DataFrame(rows)
    pd.set_option("display.width", 200)
    print("\n== 시험 구간 (2026-08~09)")
    print(out.to_string(index=False))

    by_port = []
    for port in sorted(s.loc[te, "prtAgNm"].unique()):
        sel = te & (s["prtAgNm"] == port).to_numpy()
        by_port.append({"항만": port, "표본": int(sel.sum()),
                        "기준선 MAE": round(float(np.mean(np.abs(y[sel] - h_point[sel]))), 1),
                        "GBM MAE": round(float(np.mean(np.abs(y[sel] - g_med[sel]))), 1),
                        "CQR 적중률": round(float(np.mean((y[sel] >= c_lo[sel]) & (y[sel] <= c_hi[sel]))), 3)})
    print("\n== 항만별 (시험)")
    print(pd.DataFrame(by_port).to_string(index=False))

    s_out = s[["occ_id", "t", "prtAgNm", "out_berth", "group", "rtd_h", "elapsed_h"]].copy()
    s_out["split"] = np.select([tr, ca, te], ["train", "calib", "test"], default="none")
    s_out["h_point"], s_out["h_lo"], s_out["h_hi"] = h_point, h_lo, h_hi
    s_out["g_med"], s_out["c_lo"], s_out["c_hi"] = g_med, c_lo, c_hi
    for q in QS:
        s_out[f"q{int(q * 100):02d}"] = preds[q]
    s_out.to_parquet(PROC / "forecast_predictions.parquet", index=False)
    out.to_csv(PROC / "forecast_metrics.csv", index=False)
    (PROC / "models").mkdir(exist_ok=True)
    joblib.dump({"models": models, "levels": levels, "qhat_log": float(qhat)}, PROC / "models" / "rtd_quantile.joblib")
    (PROC / "forecast_meta.json").write_text(json.dumps({"qhat_log": float(qhat), "baseline_resid_q": [float(r_lo), float(r_hi)]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
