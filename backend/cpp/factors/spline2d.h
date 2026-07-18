// Tensor-product B-spline surface matching scipy.interpolate.RectBivariateSpline.
// Construct from the scipy spline's get_knots(), get_coeffs().reshape(nx, ny),
// and degrees. Like FITPACK, query points are clamped to the knot domain.
#pragma once

#include <Eigen/Dense>
#include <stdexcept>
#include <vector>

namespace srs {

class Spline2D {
 public:
  Spline2D(const Eigen::VectorXd& tx, const Eigen::VectorXd& ty,
           const Eigen::MatrixXd& coeffs, int kx, int ky)
      : kx_(kx), ky_(ky) {
    if (coeffs.rows() != tx.size() - kx - 1 || coeffs.cols() != ty.size() - ky - 1)
      throw std::invalid_argument("Spline2D: coeffs shape does not match knots/degrees");
    surf_[0][0] = {tx, ty, coeffs, kx, ky};
    surf_[1][0] = deriveX(surf_[0][0]);
    surf_[0][1] = deriveY(surf_[0][0]);
    surf_[1][1] = deriveY(surf_[1][0]);
    xlo_ = tx(kx); xhi_ = tx(tx.size() - kx - 1);
    ylo_ = ty(ky); yhi_ = ty(ty.size() - ky - 1);
  }

  double ev(double x, double y, int dx = 0, int dy = 0) const {
    if (dx < 0 || dx > 1 || dy < 0 || dy > 1)
      throw std::invalid_argument("Spline2D::ev supports derivative orders 0 and 1");
    const Surface& s = surf_[dx][dy];
    x = std::min(std::max(x, xlo_), xhi_);
    y = std::min(std::max(y, ylo_), yhi_);

    const int sx = findSpan(s.tx, s.kx, static_cast<int>(s.c.rows()), x);
    const int sy = findSpan(s.ty, s.ky, static_cast<int>(s.c.cols()), y);
    std::vector<double> bx(s.kx + 1), by(s.ky + 1);
    basis(s.tx, s.kx, sx, x, bx.data());
    basis(s.ty, s.ky, sy, y, by.data());

    double result = 0.0;
    for (int i = 0; i <= s.kx; ++i)
      for (int j = 0; j <= s.ky; ++j)
        result += s.c(sx - s.kx + i, sy - s.ky + j) * bx[i] * by[j];
    return result;
  }

 private:
  struct Surface {
    Eigen::VectorXd tx, ty;
    Eigen::MatrixXd c;
    int kx, ky;
  };

  // S'(x) = sum c'_i B_{i,k-1,t[1:-1]} with c'_i = k (c_{i+1}-c_i)/(t_{i+k+1}-t_{i+1})
  static Surface deriveX(const Surface& s) {
    const int n = static_cast<int>(s.c.rows());
    Eigen::MatrixXd c(n - 1, s.c.cols());
    for (int i = 0; i < n - 1; ++i) {
      const double denom = s.tx(i + s.kx + 1) - s.tx(i + 1);
      c.row(i) = denom > 0 ? (s.kx * (s.c.row(i + 1) - s.c.row(i)) / denom).eval()
                           : Eigen::RowVectorXd::Zero(s.c.cols()).eval();
    }
    return {s.tx.segment(1, s.tx.size() - 2), s.ty, c, s.kx - 1, s.ky};
  }

  static Surface deriveY(const Surface& s) {
    const int n = static_cast<int>(s.c.cols());
    Eigen::MatrixXd c(s.c.rows(), n - 1);
    for (int j = 0; j < n - 1; ++j) {
      const double denom = s.ty(j + s.ky + 1) - s.ty(j + 1);
      c.col(j) = denom > 0 ? (s.ky * (s.c.col(j + 1) - s.c.col(j)) / denom).eval()
                           : Eigen::VectorXd::Zero(s.c.rows()).eval();
    }
    return {s.tx, s.ty.segment(1, s.ty.size() - 2), c, s.kx, s.ky - 1};
  }

  // rightmost l in [k, nc-1] with t[l] <= x (x already clamped)
  static int findSpan(const Eigen::VectorXd& t, int k, int nc, double x) {
    if (x >= t(nc)) return nc - 1;
    int lo = k, hi = nc - 1;
    while (lo < hi) {
      const int mid = (lo + hi + 1) / 2;
      if (t(mid) <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Cox-de Boor: the k+1 nonzero basis functions at x in span
  static void basis(const Eigen::VectorXd& t, int k, int span, double x, double* N) {
    N[0] = 1.0;
    std::vector<double> left(k + 1), right(k + 1);
    for (int j = 1; j <= k; ++j) {
      left[j] = x - t(span + 1 - j);
      right[j] = t(span + j) - x;
      double saved = 0.0;
      for (int r = 0; r < j; ++r) {
        const double tmp = N[r] / (right[r + 1] + left[j - r]);
        N[r] = saved + right[r + 1] * tmp;
        saved = left[j - r] * tmp;
      }
      N[j] = saved;
    }
  }

  Surface surf_[2][2];
  int kx_, ky_;
  double xlo_, xhi_, ylo_, yhi_;
};

}  // namespace srs
