cmake_minimum_required(VERSION 3.18)
project(srs_factors LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# All paths are provided by ../../.claude/skills/gtsam-cpp-factors/scripts/build_factors.sh:
#   GTSAM_SRC    - bootstrapped gtsam source checkout (configured, not compiled)
#   BOOST_INCLUDE- boost headers matching the wheel's bundled version
#   WHEEL_LIBS   - site-packages/gtsam_develop.libs of the installed wheel
#   PYBIND11_SRC - the pybind11 vendored in the gtsam checkout (internals must match)
foreach(v GTSAM_SRC BOOST_INCLUDE WHEEL_LIBS PYBIND11_SRC)
  if(NOT DEFINED ${v})
    message(FATAL_ERROR "${v} must be set; build with scripts/build_factors.sh")
  endif()
endforeach()

set(PYBIND11_FINDPYTHON ON)
add_subdirectory(${PYBIND11_SRC} ${CMAKE_BINARY_DIR}/pybind11 EXCLUDE_FROM_ALL)

file(GLOB GTSAM_LIB "${WHEEL_LIBS}/libgtsam-*.so.*")
list(LENGTH GTSAM_LIB _n)
if(NOT _n EQUAL 1)
  message(FATAL_ERROR "expected exactly one libgtsam in ${WHEEL_LIBS}, got: ${GTSAM_LIB}")
endif()

pybind11_add_module(srs_factors bindings.cpp)
target_include_directories(srs_factors SYSTEM PRIVATE
  ${GTSAM_SRC}
  ${GTSAM_SRC}/build
  ${GTSAM_SRC}/gtsam/3rdparty/Eigen
  ${BOOST_INCLUDE})
# must match the manylinux wheel: old libstdc++ ABI, no -march=native
target_compile_definitions(srs_factors PRIVATE _GLIBCXX_USE_CXX11_ABI=0)
target_link_libraries(srs_factors PRIVATE ${GTSAM_LIB})
set_target_properties(srs_factors PROPERTIES
  BUILD_RPATH "${WHEEL_LIBS}"
  INSTALL_RPATH "${WHEEL_LIBS}")
