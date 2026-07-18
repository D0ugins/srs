# GTSAM conventions + wheel ABI facts

## Tangent-space conventions (what the Jacobian columns mean)

All Jacobians are `∂error/∂ξ` where `ξ` is a **right** (local, body-frame)
perturbation: `T ← T · Exp(ξ)`. For `gtsam.CustomFactor`, `jacobians[k]` is the
block for the k-th key, shape `(error_dim, tangent_dim)`. Same convention as
C++ `evaluateError`'s `H` outputs.

- **Rot3** (tangent dim 3): `R ← R·Exp(ω̂)`. Useful identities at ω→0:
  `d(R·v) = -R·[v]ₓ·ω` for perturbation of R; `d(Rᵀ·v) = [Rᵀv]ₓ·ω`.
- **Pose3** (tangent dim 6, order **[ω(0:3), t(3:6)]** — rotation first):
  retract is the full SE(3) expmap (`GTSAM_POSE3_EXPMAP=ON` in the wheel).
  Translation columns: `∂t_world/∂ξ_t = R` (body-frame translation perturbation).
  The ω→translation coupling vanishes at ξ=0 (second order), so a factor whose
  error depends only on world translation legitimately has zero ω-columns.
- **Vector / Point3**: tangent = the vector itself, retract is `+`.
- The notebook inserts velocities/offsets as plain numpy arrays (stored as
  dynamic `Vector`); GTSAM's `Values::at<Vector3>` converts fixed↔dynamic, so
  C++ factors can use `Vector3`/`Vector1` template args.

## Numeric verification method

Build the factor with `gtsam.noiseModel.Unit.Create(dim)` — then
`factor.linearize(values).jacobian()` returns the **unwhitened** `(A, b)`, where
A's columns are grouped per key in the factor's key order. Numeric side:
central differences of `factor.unwhitenedError(values.retract(delta))` with a
unit `VectorValues` delta per tangent dim (`values.zeroVectors()` gives the
per-key dims). Compare per key block. ε=1e-6, tol ~1e-5 on relative error.
`scripts/verify_jacobians.py` implements this.

## Wheel ABI facts (gtsam-develop nightly, PyPI)

The wheel ships **no headers and no CMake config** — only:
- `site-packages/gtsam/gtsam.cpython-*.so` (pybind11 module)
- `site-packages/gtsam_develop.libs/libgtsam-<hash>.so.<version>` etc.
  (auditwheel-mangled sonames; link them **by full path**, rpath to that dir)

A C++ module whose objects must interop with the wheel's Python objects must
match, exactly:
- **pybind11**: internals version **11** → use the pybind11 vendored in the
  gtsam source checkout (`wrap/pybind11`) at the matching commit; never a pip
  pybind11.
- **`-D_GLIBCXX_USE_CXX11_ABI=0`** (wheel is manylinux2014 / old libstdc++ ABI).
- **No `-march=native`** (wheel: `GTSAM_BUILD_WITH_MARCH_NATIVE=OFF`); AVX would
  change Eigen member alignment inside GTSAM classes.
- Holder type `std::shared_ptr`; register factors as
  `py::class_<F, gtsam::NoiseModelFactor, std::shared_ptr<F>>` and
  `py::module_::import("gtsam")` first inside `PYBIND11_MODULE`.
- Boost **1.87.0** headers (configure-time only; we never link boost).

`scripts/setup_gtsam_src.sh` reproduces the wheel's configure (flags copied from
`.github/scripts/python_wheels/cibw_before_all.sh` at the wheel's commit:
quaternions OFF, TBB OFF, march-native OFF, deprecated-since-V43 OFF, unstable
ON) so `build/gtsam/config.h` matches the wheel build. The source commit is
resolved from the nightly version's timestamp
(`git rev-list -1 --before="<YYYY-MM-DD HH:MM> +0000" origin/develop`).

## Gotchas

- **Import order**: `import gtsam` before `import srs_factors` (bindings do this
  defensively via `py::module_::import`).
- **RectBivariateSpline port**: pass `get_knots()`, `get_coeffs().reshape(nx, ny)`,
  and `degrees` to `srs_factors.Spline2D`. FITPACK (and the port) **clamps**
  query points to the knot domain; verify equivalence in-domain.
- **Failure modes of ABI drift**: `ImportError` (missing symbol), pybind
  "referenced unknown base type", segfault in first `linearize`, or garbage
  numbers — all caught by the equivalence gate. If that happens: re-check the
  resolved commit (try neighbors around the timestamp), re-check config.h flags.
- **Ultimate fallback** (only if header-vs-wheel cannot be made to work): build
  GTSAM + its Python wrapper from source at the same commit and install that
  wheel into the venv, replacing `gtsam-develop` (~30-45 min at -j8; keep the
  link stage at low -j on a 15 GiB machine), then build factors against that
  install with `find_package(GTSAM)`.
- Python `CustomFactor` callbacks close over notebook globals (e.g. the spline);
  snapshot them with a synthetic spline for verification so no DB/data is needed.
- GTSAM upstream reference for this pattern: `python/CustomFactors.md` in the
  gtsam source checkout.
