#!/usr/bin/env bash
# Bootstrap GTSAM source headers matching the installed gtsam-develop wheel.
# Configure-only: generates build/gtsam/config.h; never compiles libgtsam.
# Cached per wheel version under ~/.cache/srs-gtsam-tooling; safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PY="$REPO_ROOT/backend/.venv/bin/python"
CACHE="${GTSAM_TOOLING_CACHE:-$HOME/.cache/srs-gtsam-tooling}"
mkdir -p "$CACHE"

VERSION=$("$PY" -c "from importlib.metadata import version; print(version('gtsam-develop'))")
if [[ "$VERSION" != *".dev"* ]]; then
  echo "ERROR: expected a gtsam-develop nightly (X.Y.devYYYYMMDDHHMM), got $VERSION" >&2
  exit 1
fi
STAMP="${VERSION##*.dev}"
DATE_UTC="${STAMP:0:4}-${STAMP:4:2}-${STAMP:6:2} ${STAMP:8:2}:${STAMP:10:2} +0000"
SRC="$CACHE/gtsam-$VERSION"

LIBS_DIR=$("$PY" -c "import gtsam, pathlib; print(pathlib.Path(gtsam.__file__).parent.parent / 'gtsam_develop.libs')")
BOOST_VER=$(ls "$LIBS_DIR" | grep -oP 'boost.*\.so\.\K[0-9.]+' | sort -u | head -1)
BOOST_PREFIX="$CACHE/boost-$BOOST_VER"

# Boost headers+libs so GTSAM's find_package(Boost COMPONENTS ...) succeeds at
# configure time. Version + component set mirror the wheel's cibw_before_all.sh.
# We never link these libs ourselves.
BOOST_COMPONENTS=(graph program_options random serialization timer chrono)
MISSING=()
for c in "${BOOST_COMPONENTS[@]}"; do
  ls "$BOOST_PREFIX/lib/libboost_$c"* >/dev/null 2>&1 || MISSING+=("$c")
done
if [ ! -f "$BOOST_PREFIX/include/boost/version.hpp" ] || [ "${#MISSING[@]}" -gt 0 ]; then
  BOOST_US="${BOOST_VER//./_}"
  TARBALL="$CACHE/boost_$BOOST_US.tar.gz"
  [ -f "$TARBALL" ] || curl -fL --retry 3 -o "$TARBALL" \
    "https://archives.boost.io/release/$BOOST_VER/source/boost_$BOOST_US.tar.gz"
  rm -rf "$CACHE/boost_$BOOST_US"
  tar -xzf "$TARBALL" -C "$CACHE"
  pushd "$CACHE/boost_$BOOST_US" >/dev/null
  ./bootstrap.sh --prefix="$BOOST_PREFIX" >/dev/null
  B2_WITH=(); for c in "${BOOST_COMPONENTS[@]}"; do B2_WITH+=("--with-$c"); done
  ./b2 -j"$(nproc)" -d0 variant=release "${B2_WITH[@]}" install
  popd >/dev/null
  rm -rf "$CACHE/boost_$BOOST_US"
fi

if [ ! -d "$SRC/.git" ]; then
  git clone --filter=blob:none https://github.com/borglab/gtsam.git "$SRC"
fi
git -C "$SRC" fetch origin develop
COMMIT=$(git -C "$SRC" rev-list -1 --before="$DATE_UTC" origin/develop)
[ -n "$COMMIT" ] || { echo "ERROR: no commit found before $DATE_UTC" >&2; exit 1; }
git -C "$SRC" checkout --quiet "$COMMIT"
git -C "$SRC" submodule update --init --recursive
echo "$COMMIT" > "$SRC/.wheel-commit"

PYBIND_DIR=$(find "$SRC" -maxdepth 3 -type d -name pybind11 | head -1)
[ -n "$PYBIND_DIR" ] || { echo "ERROR: vendored pybind11 not found in $SRC" >&2; exit 1; }
echo "pybind11 internals version (wheel expects 11):"
grep -rh "define PYBIND11_INTERNALS_VERSION" "$PYBIND_DIR/include" | head -3 || true

# Flags mirror .github/scripts/python_wheels/cibw_before_all.sh at the wheel's
# commit (minus python/doc), so the generated config.h matches the wheel build.
cmake -S "$SRC" -B "$SRC/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBoost_ROOT="$BOOST_PREFIX" -DBOOST_ROOT="$BOOST_PREFIX" \
  -DGTSAM_BUILD_PYTHON=OFF \
  -DGTSAM_BUILD_TESTS=OFF \
  -DGTSAM_BUILD_UNSTABLE=ON \
  -DGTSAM_USE_QUATERNIONS=OFF \
  -DGTSAM_WITH_TBB=OFF \
  -DGTSAM_BUILD_EXAMPLES_ALWAYS=OFF \
  -DGTSAM_BUILD_WITH_MARCH_NATIVE=OFF \
  -DGTSAM_ALLOW_DEPRECATED_SINCE_V43=OFF \
  -DGTSAM_USE_SYSTEM_EIGEN=OFF \
  -DGTSAM_USE_SYSTEM_METIS=OFF

test -f "$SRC/build/gtsam/config.h" || { echo "ERROR: config.h not generated" >&2; exit 1; }
echo "OK gtsam-src=$SRC commit=$COMMIT"
echo "OK pybind11=$PYBIND_DIR"
echo "OK boost=$BOOST_PREFIX"
