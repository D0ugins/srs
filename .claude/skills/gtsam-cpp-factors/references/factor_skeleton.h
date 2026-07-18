// Pattern for porting a gtsam.CustomFactor callback to C++.
// Mirror the Python math exactly (including epsilons and approximations).
//
// H blocks: H[k] is d(error)/d(xi_k), right/local perturbation, Pose3 tangent
// order [omega(0:3), t(3:6)]. Same layout the Python callback filled in.

#pragma once
#include <gtsam/geometry/Pose3.h>
#include <gtsam/nonlinear/NoiseModelFactorN.h>  // NoiseModelFactorN lives here, not NonlinearFactor.h

class ExampleFactor : public gtsam::NoiseModelFactorN<gtsam::Pose3, gtsam::Vector3> {
  using Base = gtsam::NoiseModelFactorN<gtsam::Pose3, gtsam::Vector3>;

 public:
  ExampleFactor(gtsam::Key poseKey, gtsam::Key vKey, const gtsam::SharedNoiseModel& noise)
      : Base(noise, poseKey, vKey) {}

  gtsam::Vector evaluateError(const gtsam::Pose3& pose, const gtsam::Vector3& v,
                              gtsam::OptionalMatrixType H1,
                              gtsam::OptionalMatrixType H2) const override {
    const gtsam::Matrix3 R = pose.rotation().matrix();
    const gtsam::Vector3 error = R.transpose() * v;
    if (H1) {
      H1->setZero(3, 6);
      H1->leftCols<3>() = gtsam::skewSymmetric(error);  // rotation block
      // translation block stays zero: error ignores position
    }
    if (H2) *H2 = R.transpose();
    return error;
  }
};

// bindings.cpp registration (cross-module interop with the gtsam wheel):
//
//   PYBIND11_MODULE(srs_factors, m) {
//     py::module_::import("gtsam");  // base classes must be registered first
//     py::class_<ExampleFactor, gtsam::NoiseModelFactor,
//                std::shared_ptr<ExampleFactor>>(m, "ExampleFactor")
//         .def(py::init<gtsam::Key, gtsam::Key, const gtsam::SharedNoiseModel&>());
//   }
//
// Python then uses it like any native factor:
//   graph.add(srs_factors.ExampleFactor(X(i), V(i), noise))
