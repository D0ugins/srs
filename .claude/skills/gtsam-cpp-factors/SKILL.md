---
name: gtsam-cpp-factors
description: Verify the analytical Jacobians of gtsam.CustomFactor callbacks defined in a notebook (analytic reasoning + numeric check), then generate, compile, and verify equivalent C++ factors importable in the notebook. Use when asked to check custom-factor Jacobians, port GTSAM custom factors to C++, or speed up a GTSAM optimization that uses Python CustomFactors.
---

# GTSAM custom factor verification + C++ port

Target notebook is the argument (default `backend/src/notebooks/smooth.ipynb`).
Read `references/conventions.md` before doing any Jacobian reasoning or C++ work —
it holds the tangent-space conventions, the wheel ABI facts, and known gotchas.

## Workflow

1. **Extract.** Find every `gtsam.CustomFactor(...)` in the notebook and the error
   callbacks they reference. For each: callback source, keys + variable types,
   noise model. Copy the callbacks verbatim into a snapshot module in the
   scratchpad. Replace data-dependent context (e.g. the DEM `elevation_spline`)
   with a synthetic stand-in of the same type built from random smooth data —
   never require the DB or data/ to run verification.

2. **Analytic review.** Derive each Jacobian by hand against the conventions doc
   and compare with the code. Record agreement/disagreement per block before
   running anything.

3. **Numeric verify.** Write a small driver that builds each factor with
   `gtsam.noiseModel.Unit.Create(dim)` on randomized realistic states and calls
   `check_factor` from `scripts/verify_jacobians.py`. Classify each mismatching
   block: bug vs knowing approximation (code comments count as evidence).
   Policy: **replicate approximations faithfully and flag them in the report** —
   never silently "fix" the math unless the user asks.

4. **Generate C++.** Write/refresh factors in `backend/cpp/factors/`
   (`factors.h`, `bindings.cpp`, `spline2d.h` if terrain is involved) using
   `references/factor_skeleton.h` as the pattern. Mirror the Python math exactly,
   including approximations and epsilon terms.

5. **Build.** `scripts/setup_gtsam_src.sh` (idempotent, cached per wheel
   version), then `scripts/build_factors.sh`. The module `srs_factors` lands in
   `backend/src/`.

6. **Equivalence gate.** Drive `scripts/compare_factors.py` helpers from a
   scratchpad script: spline vs scipy (tol 1e-10), error + every Jacobian block
   Python-vs-C++ over ~100 random states (tol 1e-9), then a small synthetic
   graph optimized both ways (tol 1e-8) plus a linearize timing comparison.
   Iterate until green. An import error or nonsense numbers here means the
   header/ABI bootstrap drifted — see the fallback section of the conventions doc.

7. **Notebook wiring.** Add (or refresh) a `USE_CPP_FACTORS` cell right after the
   Python factor definitions that builds C++ equivalents (constructing
   `srs_factors.Spline2D` from the scipy spline's knots/coeffs), and factory
   functions `make_<name>_factor(...)` used by the graph-building loop so both
   implementations stay swappable. Report: per-factor Jacobian verdicts, flagged
   approximations, equivalence results, timing.
