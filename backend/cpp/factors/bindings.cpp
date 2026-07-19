#include <pybind11/eigen.h>
#include <pybind11/pybind11.h>

#include "factors.h"

namespace py = pybind11;

PYBIND11_MODULE(srs_factors, m) {
  // base classes (NoiseModelFactor, noise models, ...) must be registered first
  py::module_::import("gtsam");

  py::class_<srs::Spline2D, std::shared_ptr<srs::Spline2D>>(m, "Spline2D")
      .def(py::init<const Eigen::VectorXd&, const Eigen::VectorXd&,
                    const Eigen::MatrixXd&, int, int>(),
           py::arg("tx"), py::arg("ty"), py::arg("coeffs"), py::arg("kx"), py::arg("ky"))
      .def("ev", &srs::Spline2D::ev, py::arg("x"), py::arg("y"),
           py::arg("dx") = 0, py::arg("dy") = 0);

  py::class_<srs::HeadingFactor, gtsam::NoiseModelFactor,
             std::shared_ptr<srs::HeadingFactor>>(m, "HeadingFactor")
      .def(py::init<gtsam::Key, gtsam::Key, gtsam::Key, const gtsam::SharedNoiseModel&>(),
           py::arg("pose_key"), py::arg("vel_key"), py::arg("rvi_key"), py::arg("noise"));

  py::class_<srs::ElevationFactor, gtsam::NoiseModelFactor,
             std::shared_ptr<srs::ElevationFactor>>(m, "ElevationFactor")
      .def(py::init<gtsam::Key, gtsam::Key, std::shared_ptr<srs::Spline2D>,
                    const gtsam::SharedNoiseModel&>(),
           py::arg("pose_key"), py::arg("offset_key"), py::arg("spline"), py::arg("noise"));

  py::class_<srs::NormalFactor, gtsam::NoiseModelFactor,
             std::shared_ptr<srs::NormalFactor>>(m, "NormalFactor")
      .def(py::init<gtsam::Key, gtsam::Key, std::shared_ptr<srs::Spline2D>,
                    const gtsam::SharedNoiseModel&>(),
           py::arg("pose_key"), py::arg("rvi_key"), py::arg("spline"), py::arg("noise"));
}
