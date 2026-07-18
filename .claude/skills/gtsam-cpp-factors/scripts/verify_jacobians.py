"""Numeric-vs-analytic Jacobian checks for GTSAM nonlinear factors.

Contract: build the factor with gtsam.noiseModel.Unit.Create(error_dim) so
linearize() returns raw (unwhitened) Jacobians, and pass a Values holding
exactly the factor's keys.
"""

import numpy as np
import gtsam


def _dims(values, keys):
    try:
        zv = values.zeroVectors()
        return {k: zv.at(k).shape[0] for k in keys}
    except AttributeError:
        dims = {}
        for k in keys:
            for probe, d in (
                (values.atPose3, 6),
                (values.atRot3, 3),
                (values.atConstantBias, 6),
            ):
                try:
                    probe(k)
                    dims[k] = d
                    break
                except Exception:
                    continue
            else:
                dims[k] = len(values.atVector(k))
        return dims


def _unwhitened(factor, values):
    try:
        return np.atleast_1d(factor.unwhitenedError(values))
    except AttributeError:
        # unit noise model: b == -error
        return -factor.linearize(values).jacobian()[1]


def check_factor(factor, values, eps=1e-6, name=""):
    """Central-difference check of every Jacobian block.

    Returns a list of per-key dicts with analytic/numeric blocks and max
    absolute difference.
    """
    keys = list(factor.keys())
    dims = _dims(values, keys)
    A, _ = factor.linearize(values).jacobian()

    def shifted(key, j, sign):
        vv = gtsam.VectorValues()
        for k in keys:
            v = np.zeros(dims[k])
            if k == key:
                v[j] = sign * eps
            vv.insert(k, v)
        return values.retract(vv)

    results, col = [], 0
    for idx, k in enumerate(keys):
        d = dims[k]
        cols = [
            (_unwhitened(factor, shifted(k, j, +1)) - _unwhitened(factor, shifted(k, j, -1)))
            / (2 * eps)
            for j in range(d)
        ]
        numeric = np.column_stack(cols)
        analytic = A[:, col : col + d]
        results.append(
            {
                "name": name,
                "key_index": idx,
                "dim": d,
                "max_abs_diff": float(np.abs(analytic - numeric).max()),
                "scale": float(max(1.0, np.abs(numeric).max())),
                "analytic": analytic,
                "numeric": numeric,
            }
        )
        col += d
    return results


def report(results, tol=1e-5, expected_mismatch=()):
    """Print per-block verdicts. expected_mismatch: (name, key_index) pairs whose
    analytic block is knowingly approximate. Returns True if no unexpected
    mismatches."""
    ok = True
    for r in results:
        rel = r["max_abs_diff"] / r["scale"]
        bad = rel > tol
        if bad and (r["name"], r["key_index"]) in set(expected_mismatch):
            tag = "KNOWN-APPROX"
        elif bad:
            tag = "MISMATCH"
            ok = False
        else:
            tag = "ok"
        shape = f'{r["analytic"].shape[0]}x{r["dim"]}'
        print(f'{r["name"]:>16s}  H[{r["key_index"]}] {shape:>4s}  max|d|={r["max_abs_diff"]:.3e}  rel={rel:.3e}  {tag}')
    return ok
