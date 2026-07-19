// C++ ports of the smooth.ipynb CustomFactor callbacks. The math (including
// the 1e-8 norm softening and the normal factor's knowingly-zero translation
// block) mirrors the Python exactly; keep them in sync.
#pragma once

#include <gtsam/geometry/Pose3.h>
#include <gtsam/nonlinear/NoiseModelFactorN.h>

#include <memory>

#include "spline2d.h"

namespace srs {

using gtsam::Key;
using gtsam::Matrix3;
using gtsam::Pose3;
using gtsam::Rot3;
using gtsam::SharedNoiseModel;
using gtsam::Vector;
using gtsam::Vector1;
using gtsam::Vector3;

// error = R_vi * R_wi^T * v_w - [|v_w|, 0, 0]
class HeadingFactor : public gtsam::NoiseModelFactorN<Pose3, Vector3, Rot3> {
  using Base = gtsam::NoiseModelFactorN<Pose3, Vector3, Rot3>;

 public:
  HeadingFactor(Key poseKey, Key velKey, Key rviKey, const SharedNoiseModel& noise)
      : Base(noise, poseKey, velKey, rviKey) {}

  Vector evaluateError(const Pose3& pose, const Vector3& v_w, const Rot3& Rvi,
                       gtsam::OptionalMatrixType H_pose,
                       gtsam::OptionalMatrixType H_vw,
                       gtsam::OptionalMatrixType H_rvi) const override {
    const Matrix3 R_vi = Rvi.matrix();
    const Matrix3 R_wi = pose.rotation().matrix();
    const Vector3 v_i = R_wi.transpose() * v_w;
    const double speed = v_w.norm();
    const Vector3 error = R_vi * v_i - Vector3(speed, 0.0, 0.0);

    if (H_pose) {
      H_pose->setZero(3, 6);
      H_pose->block<3, 3>(0, 0) = R_vi * gtsam::skewSymmetric(v_i);
    }
    if (H_vw) {
      Matrix3 J_target = Matrix3::Zero();
      J_target.row(0) = v_w.transpose() / (speed + 1e-8);
      *H_vw = R_vi * R_wi.transpose() - J_target;
    }
    if (H_rvi) *H_rvi = -R_vi * gtsam::skewSymmetric(v_i);
    return error;
  }
};

// error = z - spline(east, north) - offset
class ElevationFactor : public gtsam::NoiseModelFactorN<Pose3, Vector1> {
  using Base = gtsam::NoiseModelFactorN<Pose3, Vector1>;
  std::shared_ptr<const Spline2D> spline_;  // shared: one spline serves ~10^3 factors

 public:
  ElevationFactor(Key poseKey, Key offsetKey, std::shared_ptr<const Spline2D> spline,
                  const SharedNoiseModel& noise)
      : Base(noise, poseKey, offsetKey), spline_(std::move(spline)) {}

  Vector evaluateError(const Pose3& pose, const Vector1& offset,
                       gtsam::OptionalMatrixType H_pose,
                       gtsam::OptionalMatrixType H_offset) const override {
    const gtsam::Point3 t = pose.translation();
    Vector1 error;
    error << t.z() - spline_->ev(t.x(), t.y()) - offset(0);

    if (H_pose) {
      const Eigen::RowVector3d de_dt(-spline_->ev(t.x(), t.y(), 1, 0),
                                     -spline_->ev(t.x(), t.y(), 0, 1), 1.0);
      H_pose->setZero(1, 6);
      H_pose->block<1, 3>(0, 3) = de_dt * pose.rotation().matrix();
    }
    if (H_offset) {
      H_offset->resize(1, 1);
      (*H_offset)(0, 0) = -1.0;
    }
    return error;
  }
};

// error = R_wi * R_vi^T * [0,0,1] - terrain_normal(east, north)
class NormalFactor : public gtsam::NoiseModelFactorN<Pose3, Rot3> {
  using Base = gtsam::NoiseModelFactorN<Pose3, Rot3>;
  std::shared_ptr<const Spline2D> spline_;

  Vector3 terrainNormal(double east, double north) const {
    const Vector3 n(-spline_->ev(east, north, 1, 0), -spline_->ev(east, north, 0, 1), 1.0);
    return n / n.norm();
  }

 public:
  NormalFactor(Key poseKey, Key rviKey, std::shared_ptr<const Spline2D> spline,
               const SharedNoiseModel& noise)
      : Base(noise, poseKey, rviKey), spline_(std::move(spline)) {}

  Vector evaluateError(const Pose3& pose, const Rot3& Rvi,
                       gtsam::OptionalMatrixType H_pose,
                       gtsam::OptionalMatrixType H_rvi) const override {
    const Matrix3 R_vi = Rvi.matrix();
    const Matrix3 R_wi = pose.rotation().matrix();
    const gtsam::Point3 t = pose.translation();
    const Vector3 normal = terrainNormal(t.x(), t.y());
    const Vector3 c = R_vi.transpose() * Vector3(0.0, 0.0, 1.0);
    const Vector3 error = R_wi * c - normal;

    if (H_pose || H_rvi) {
      const Matrix3 J_rot = R_wi * gtsam::skewSymmetric(c);
      if (H_pose) {
        // translation block deliberately zero (ignores position), as in python
        H_pose->setZero(3, 6);
        H_pose->block<3, 3>(0, 0) = -J_rot;
      }
      if (H_rvi) *H_rvi = J_rot;
    }
    return error;
  }
};

// one-pole tracking state: error = w - beta*w_prev - (1-beta)*v_prev
// models the receiver's velocity lowpass; doppler then measures w, not v
class LowpassStateFactor : public gtsam::NoiseModelFactorN<Vector3, Vector3, Vector3> {
  using Base = gtsam::NoiseModelFactorN<Vector3, Vector3, Vector3>;
  double beta_;

 public:
  LowpassStateFactor(Key wKey, Key wPrevKey, Key vPrevKey, double beta,
                     const SharedNoiseModel& noise)
      : Base(noise, wKey, wPrevKey, vPrevKey), beta_(beta) {}

  Vector evaluateError(const Vector3& w, const Vector3& wp, const Vector3& vp,
                       gtsam::OptionalMatrixType Hw, gtsam::OptionalMatrixType Hwp,
                       gtsam::OptionalMatrixType Hvp) const override {
    if (Hw) *Hw = gtsam::Matrix3::Identity();
    if (Hwp) *Hwp = -beta_ * gtsam::Matrix3::Identity();
    if (Hvp) *Hvp = -(1.0 - beta_) * gtsam::Matrix3::Identity();
    return w - beta_ * wp - (1.0 - beta_) * vp;
  }
};

// error = v_w + bias - z, bias is a slowly-varying doppler velocity offset
class BiasedVelocityFactor : public gtsam::NoiseModelFactorN<Vector3, Vector3> {
  using Base = gtsam::NoiseModelFactorN<Vector3, Vector3>;
  Vector3 z_;

 public:
  BiasedVelocityFactor(Key velKey, Key biasKey, const Vector3& z,
                       const SharedNoiseModel& noise)
      : Base(noise, velKey, biasKey), z_(z) {}

  Vector evaluateError(const Vector3& v, const Vector3& b,
                       gtsam::OptionalMatrixType H_v,
                       gtsam::OptionalMatrixType H_b) const override {
    if (H_v) *H_v = gtsam::Matrix3::Identity();
    if (H_b) *H_b = gtsam::Matrix3::Identity();
    return v + b - z_;
  }
};

// error = t_wb + bias - z, bias is a slowly-varying world-frame gps offset
class BiasedGPSFactor : public gtsam::NoiseModelFactorN<Pose3, Vector3> {
  using Base = gtsam::NoiseModelFactorN<Pose3, Vector3>;
  Vector3 z_;

 public:
  BiasedGPSFactor(Key poseKey, Key biasKey, const Vector3& z,
                  const SharedNoiseModel& noise)
      : Base(noise, poseKey, biasKey), z_(z) {}

  Vector evaluateError(const Pose3& pose, const Vector3& b,
                       gtsam::OptionalMatrixType H_pose,
                       gtsam::OptionalMatrixType H_b) const override {
    if (H_pose) {
      H_pose->setZero(3, 6);
      H_pose->block<3, 3>(0, 3) = pose.rotation().matrix();
    }
    if (H_b) *H_b = gtsam::Matrix3::Identity();
    return pose.translation() + b - z_;
  }
};

}  // namespace srs
