"""Python-vs-C++ factor equivalence helpers.

Build both factors with the same keys (same order) and Unit noise so
linearize() output is directly comparable.
"""

import time

import numpy as np


def spline_diff(scipy_spline, cpp_spline, n=500, seed=0):
    """Max |scipy - cpp| for the value and first partials, random in-domain points."""
    rng = np.random.default_rng(seed)
    tx, ty = scipy_spline.get_knots()
    kx, ky = scipy_spline.degrees
    xs = rng.uniform(tx[kx], tx[-kx - 1], n)
    ys = rng.uniform(ty[ky], ty[-ky - 1], n)
    out = {}
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        a = scipy_spline.ev(xs, ys, dx=dx, dy=dy)
        b = np.array([cpp_spline.ev(x, y, dx, dy) for x, y in zip(xs, ys)])
        out[(dx, dy)] = float(np.abs(a - b).max())
    return out


def factor_diff(f_py, f_cpp, values):
    """(max error diff, max Jacobian diff) between two factors on the same values."""
    e1 = np.atleast_1d(f_py.unwhitenedError(values))
    e2 = np.atleast_1d(f_cpp.unwhitenedError(values))
    A1, _ = f_py.linearize(values).jacobian()
    A2, _ = f_cpp.linearize(values).jacobian()
    return float(np.abs(e1 - e2).max()), float(np.abs(A1 - A2).max())


def time_linearize(factor, values, n=1000):
    """Mean seconds per linearize() call."""
    t0 = time.perf_counter()
    for _ in range(n):
        factor.linearize(values)
    return (time.perf_counter() - t0) / n
