"""CII 계산이 IMO 결의에 실린 예시와 맞는지 확인한다."""

from kjit.engine import cii


def test_g4_worked_example():
    # MEPC.354(78) Table 1 아래 예시: 벌크선 필요 CII 10 → 경계 8.6, 9.4, 10.6, 11.8, 실적 9 → B
    dd = cii.SHIP_TYPES["벌크선"][1][6]
    bounds = [10 * d for d in dd]
    assert [round(b, 1) for b in bounds] == [8.6, 9.4, 10.6, 11.8]
    assert cii.rate(9.0, bounds) == "B"


def test_reference_and_required():
    ref = cii.reference("탱커", 50000)
    assert abs(ref - 5247 * 50000 ** -0.610) < 1e-9
    req, bounds = cii.boundaries("탱커", 50000, 2027)
    assert abs(req - ref * (1 - 0.13625)) < 1e-9
    assert bounds == sorted(bounds)


def test_fixed_capacity_segments():
    assert cii.reference("벌크선", 300000) == cii.reference("벌크선", 279000)
    assert cii.reference("LNG 운반선", 150000) == 9.827
