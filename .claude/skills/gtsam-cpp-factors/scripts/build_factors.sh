#!/usr/bin/env bash
# Build backend/cpp/factors -> srs_factors*.so and copy it into backend/src/.
# Requires setup_gtsam_src.sh to have run for the installed wheel version.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PY="$REPO_ROOT/backend/.venv/bin/python"
CACHE="${GTSAM_TOOLING_CACHE:-$HOME/.cache/srs-gtsam-tooling}"

VERSION=$("$PY" -c "from importlib.metadata import version; print(version('gtsam-develop'))")
GTSAM_SRC="$CACHE/gtsam-$VERSION"
[ -f "$GTSAM_SRC/build/gtsam/config.h" ] || {
  echo "ERROR: $GTSAM_SRC not bootstrapped; run setup_gtsam_src.sh" >&2
  exit 1
}

WHEEL_LIBS=$("$PY" -c "import gtsam, pathlib; print(pathlib.Path(gtsam.__file__).parent.parent / 'gtsam_develop.libs')")
BOOST_VER=$(ls "$WHEEL_LIBS" | grep -oP 'boost.*\.so\.\K[0-9.]+' | sort -u | head -1)
BOOST_PREFIX="$CACHE/boost-$BOOST_VER"
PYBIND_DIR=$(find "$GTSAM_SRC" -maxdepth 3 -type d -name pybind11 | head -1)

SRC_DIR="$REPO_ROOT/backend/cpp/factors"
BUILD_DIR="$SRC_DIR/build"

cmake -S "$SRC_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGTSAM_SRC="$GTSAM_SRC" \
  -DBOOST_INCLUDE="$BOOST_PREFIX/include" \
  -DWHEEL_LIBS="$WHEEL_LIBS" \
  -DPYBIND11_SRC="$PYBIND_DIR" \
  -DPython_EXECUTABLE="$PY"
cmake --build "$BUILD_DIR" -j"$(nproc)"

cp "$BUILD_DIR"/srs_factors*.so "$REPO_ROOT/backend/src/"
ls "$REPO_ROOT/backend/src/"srs_factors*.so
