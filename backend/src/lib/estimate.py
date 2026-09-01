"""The adopted trajectory estimator: a robust batch WNOA smoother over one roll's localization
trace, its Student-t posterior by Gibbs, and the quantities of interest.  Acceleration alone comes
from a second, WNOJ fit of the same record (`accel_roll`), which feeds nothing else.

All times here are trace seconds (video frame 0 = 0); convert with `load_record`'s
`event_offset_ms` before writing anything back to `RollEvent`."""
import re
from functools import lru_cache

import numpy as np
import pandas as pd
import shapely
from scipy.linalg import cholesky_banded, cho_solve_banded, solve_banded
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, filtfilt
from scipy.special import ndtr
from scipy.stats import t as student_t

from lib.paths import DATA_PATH
from lib.traces import CALIB_PATH, G, NU, load_record

Q_ALONG, ANISO = 0.0999539, 0.9400661  # 'mid' dynamics level: q_c (m^2/s^3) and q_perp / q_along
Q_JERK, ANISO_JERK = 4.259478, 0.3884259    # 'M2' level of the acceleration-only WNOJ fit
ACCEL_FC = 1.0                              # Hz, the declared acceleration bandwidth
AMAX = 50.0        # m/s^2, sanity bound on the acceleration trace (~5 g): a flag, not a filter
JITTER = (0.0, 1e-12, 1e-10, 1e-8, 1e-6, 1e-4)
S_GRID = 10 ** np.linspace(np.log10(0.5), np.log10(8.0), 7)
K_FOLDS, CV_MAXIT = 5, 40
VMAX = 25.0        # m/s, physical speed bound
Q_FREE = 1e4       # m^2/s^3, prior link freed across a localization track jump

LAT0, LON0, ALT0 = 40.44163016, -79.94165829, 288.42151354   # RTK base: the map frame's ENU origin
LANDMARK_NAMES = ('hill_1', 'hill_2', 'freeroll_start', 'chute_start',
                  'hill_3', 'hill_4', 'hill_5', 'finish_line')   # hills.kml document order
PAIRS = [('hill_1', 'hill_2'), ('hill_2', 'freeroll_start'), ('freeroll_start', 'hill_3'),
         ('hill_3', 'hill_4'), ('hill_4', 'hill_5'), ('hill_5', 'finish_line')]
REL_HI = ('chute_start', 'hill_start:3', 'roll_end')
CON_LO = ('chute_start', 'freeroll_start', 'hill_start:2')
CON_HI = ('hill_start:4', 'roll_end')
GUARD_S, GUARD_EDGE = 15.0, 0.3                 # release bracket around the freeroll marking

STORED_QUANTITIES = ['max_energy', 'speed.chute_start',
                     'time.hill_1-hill_2', 'time.hill_2-freeroll_start',
                     'time.freeroll_start-hill_3', 'time.hill_3-hill_4',
                     'time.hill_4-hill_5', 'time.hill_5-finish_line']


# --- sparse batch WNOA smoother: states [p, v] at every frame time, Student-t(3.5) per-axis
# observations, anisotropic constant-velocity GP prior, banded Cholesky + Takahashi marginals.

def phi_q1(dtau, order=2):
    """Transition and process-noise blocks over each interval (scaled time): white noise on
    acceleration (order 2, state [p, v]) or on jerk (order 3, state [p, v, a])."""
    n = len(dtau)
    if order == 2:
        Phi = np.zeros((n, 2, 2)); Phi[:, 0, 0] = Phi[:, 1, 1] = 1; Phi[:, 0, 1] = dtau
        Q = np.empty((n, 2, 2))
        Q[:, 0, 0] = dtau ** 3 / 3; Q[:, 0, 1] = Q[:, 1, 0] = dtau ** 2 / 2; Q[:, 1, 1] = dtau
        return Phi, Q
    Phi = np.zeros((n, 3, 3)); Phi[:, [0, 1, 2], [0, 1, 2]] = 1
    Phi[:, 0, 1] = Phi[:, 1, 2] = dtau; Phi[:, 0, 2] = dtau ** 2 / 2
    Q = np.empty((n, 3, 3))
    Q[:, 0, 0] = dtau ** 5 / 20; Q[:, 0, 1] = Q[:, 1, 0] = dtau ** 4 / 8
    Q[:, 0, 2] = Q[:, 2, 0] = dtau ** 3 / 6; Q[:, 1, 1] = dtau ** 3 / 3
    Q[:, 1, 2] = Q[:, 2, 1] = dtau ** 2 / 2; Q[:, 2, 2] = dtau
    return Phi, Q


def kron3(A, B):
    """(n,d,d) x (n,3,3) -> (n,3d,3d) of per-interval Kronecker products."""
    n, d, _ = A.shape
    return np.einsum('kab,kij->kaibj', A, B).reshape(n, 3 * d, 3 * d)


class Banded:
    """Index bookkeeping for a symmetric block-tridiagonal matrix (N blocks of size D) in scipy's
    lower banded layout ab[i - j, j] = a[i, j]."""

    def __init__(self, N, D):
        self.N, self.D, self.u, self.n = N, D, 2 * D - 1, N * D
        a, b = np.tril_indices(D)
        k = np.arange(N)[:, None]
        i, j = k * D + a[None], k * D + b[None]
        self.diag_rows, self.diag_cols = (i - j).ravel(), j.ravel()
        self.diag_a, self.diag_b = a, b
        a2, b2 = (x.ravel() for x in np.meshgrid(np.arange(D), np.arange(D), indexing='ij'))
        k = np.arange(N - 1)[:, None]
        i, j = (k + 1) * D + a2[None], k * D + b2[None]
        self.off_rows, self.off_cols = (i - j).ravel(), j.ravel()
        self.off_a, self.off_b = a2, b2

    def assemble(self, Jd, Jo):
        ab = np.zeros((self.u + 1, self.n), order='F')
        ab[self.diag_rows, self.diag_cols] = Jd[:, self.diag_a, self.diag_b].ravel()
        ab[self.off_rows, self.off_cols] = Jo[:, self.off_b, self.off_a].ravel()
        return ab

    def upper_T(self, c):
        """Upper banded layout of L^T, for the back-substitution that draws a sample."""
        ab = np.zeros((self.u + 1, self.n))
        for k in range(self.u + 1):
            ab[self.u - k, k:] = c[k, :self.n - k]
        return ab

    def factor_blocks(self, c):
        """Diagonal L_kk and sub-diagonal L_{k+1,k} blocks of the banded Cholesky factor."""
        L = np.zeros((self.N, self.D, self.D))
        L[:, self.diag_a, self.diag_b] = c[self.diag_rows, self.diag_cols].reshape(self.N, -1)
        M = np.zeros((self.N - 1, self.D, self.D))
        M[:, self.off_a, self.off_b] = c[self.off_rows, self.off_cols].reshape(self.N - 1, -1)
        return L, M


def chol(ab):
    """Banded Cholesky, retried with a relative diagonal jitter: the stiff prior over a long
    unobserved stretch is numerically indefinite on sparse rolls."""
    err = None
    for lam in JITTER:
        A = ab if lam == 0 else np.array(ab, copy=True)
        if lam:
            A[0] *= 1 + lam
        try:
            return cholesky_banded(A, lower=True, check_finite=False)
        except Exception as e:
            err = e
    raise err


def marginals_from_factor(L, M):
    """Block Takahashi recursion -> Sigma_kk (N,D,D) and Sigma_{k,k+1} (N-1,D,D)."""
    N, D, _ = L.shape
    Li = np.linalg.inv(L)
    C = np.einsum('kji,kjl->kil', Li, Li)
    S = np.empty((N, D, D)); X = np.empty((N - 1, D, D))
    S[N - 1] = C[N - 1]
    for k in range(N - 2, -1, -1):
        A = M[k].T @ S[k + 1]
        S[k] = C[k] + Li[k].T @ (A @ M[k]) @ Li[k]
        X[k] = -Li[k].T @ A
    return S, X


def running_median(t, z, window=1.0):
    """Per-axis running median of the observed positions over ~window seconds."""
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 0.1
    w = 2 * int(round(0.5 * window / max(dt, 1e-3))) + 1
    if len(t) < w:
        return z.copy()
    return np.column_stack([median_filter(z[:, a], size=w, mode='nearest') for a in range(3)])


class Smoother:
    """One roll's batch problem.  t: knot times (s, strictly increasing); obs_idx: knot index of each
    observation; z (n,3) world centres; U (n,3,3) body axes as columns; sig (n,3) per-axis scale."""

    def __init__(self, t, obs_idx, z, U, sig, T, aniso=ANISO, order=2):
        self.t = np.asarray(t, float); self.N = len(t); self.order = order; self.D = 3 * order
        self.T = float(T)
        self.dtau = np.diff(self.t / self.T)
        self.Phi1, Q1 = phi_q1(self.dtau, order)
        self.Q1inv = np.linalg.inv(Q1)
        self.A_kk = np.einsum('kba,kbc,kcd->kad', self.Phi1, self.Q1inv, self.Phi1)
        self.A_ko = -np.einsum('kba,kbc->kac', self.Phi1, self.Q1inv)
        self.Phi = kron3(self.Phi1, np.repeat(np.eye(3)[None], self.N - 1, 0))
        self.obs_idx = np.asarray(obs_idx, int)
        self.z = np.asarray(z, float); self.U = np.asarray(U, float); self.sig = np.asarray(sig, float)
        self.nobs = len(self.obs_idx)
        self.bd = Banded(self.N, self.D)
        self.scale = np.r_[np.ones(3), np.full(3, self.T), np.full(self.D - 6, self.T ** 2)]
        self.aniso = aniso
        self.v_dir = None          # set to freeze the prior's along-motion direction (Gibbs)
        self.z_med = running_median(self.t[self.obs_idx], self.z)

    def S_inv(self, q_int, v_dir):
        qt = np.asarray(q_int, float) * self.T ** (2 * self.order - 1)
        I3 = np.eye(3)[None]
        P = np.einsum('ki,kj->kij', v_dir, v_dir)
        ok = (np.linalg.norm(v_dir, axis=1) > 0.5)[:, None, None]
        return np.where(ok, P + (I3 - P) / self.aniso, I3) / qt[:, None, None]

    def _system(self, x, q_int, nu, w_fix):
        N, D = self.N, self.D
        xs = x.reshape(N, D)
        v = xs[:, 3:6] / self.T
        if self.v_dir is None:
            vm = 0.5 * (v[:-1] + v[1:])
            nrm = np.linalg.norm(vm, axis=1, keepdims=True)
            v_dir = np.where(nrm > 0.3, vm / np.maximum(nrm, 1e-12), 0.0)
        else:
            v_dir = self.v_dir
        Sinv = self.S_inv(q_int, v_dir)
        Jd = np.zeros((N, D, D))
        Jd[:-1] += kron3(self.A_kk, Sinv)
        Jd[1:] += kron3(self.Q1inv, Sinv)
        Jo = kron3(self.A_ko, Sinv)
        Qinv = kron3(self.Q1inv, Sinv)
        b = np.zeros((N, D))
        e = xs[1:] - np.einsum('kij,kj->ki', self.Phi, xs[:-1])
        Qe = np.einsum('kij,kj->ki', Qinv, e)
        b[1:] -= Qe
        b[:-1] += np.einsum('kji,kj->ki', self.Phi, Qe)
        p_obs = xs[self.obs_idx, :3]
        r = np.einsum('kji,kj->ki', self.U, self.z - p_obs) / self.sig
        w = w_fix if w_fix is not None else (nu + 1.0) / (nu + r ** 2)
        Winfo = np.einsum('kai,ki,kbi->kab', self.U, w / self.sig ** 2, self.U)
        Jd[self.obs_idx, :3, :3] += Winfo
        b[self.obs_idx, :3] += np.einsum('kab,kb->ka', Winfo, self.z - p_obs)
        wk = np.zeros(D); wk[3:6] = (1e-3 / self.T) ** 2      # keeps the system positive definite
        wk[6:9] = (1e-3 / self.T ** 2) ** 2
        Jd[:, np.arange(D), np.arange(D)] += wk
        b -= wk * xs
        self.Sinv = Sinv
        return Jd, Jo, b.ravel(), w, r

    def init_state(self):
        """Running-median initialisation: an IRLS started from the raw positions converges into a
        burst of blunder frames instead of rejecting it."""
        x = np.zeros((self.N, self.D))
        to = self.t[self.obs_idx]
        for a in range(3):
            x[:, a] = np.interp(self.t, to, self.z_med[:, a]) if len(to) >= 2 else 0.0
        x[:, 3:6] = np.gradient(x[:, :3], self.t, axis=0) * self.T
        return x.ravel()

    def solve(self, q_int, nu=NU, x0=None, maxit=200, tol=1e-4, wtol=1e-3, w_fix=None, marginals=True):
        """IRLS to convergence (knot step < tol AND weight change < wtol).  Half steps once the step
        stops decreasing: a blunder frame's weight can flip in a period-2 limit cycle."""
        N, D = self.N, self.D
        q_int = np.ascontiguousarray(np.broadcast_to(np.asarray(q_int, float), (N - 1,)))
        x = self.init_state() if x0 is None else (np.asarray(x0, float).reshape(N, D) * self.scale).ravel()
        converged = False; w_prev = None; steps = []; damped = 0
        for it in range(1, maxit + 1):
            Jd, Jo, b, w, r = self._system(x, q_int, nu, w_fix)
            dw = np.inf if w_prev is None else float(np.abs(w - w_prev).max())
            w_prev = w
            alpha = 0.5 if damped else 1.0
            dx = cho_solve_banded((chol(self.bd.assemble(Jd, Jo)), True), b, check_finite=False)
            x = x + alpha * dx
            step = alpha * float(np.abs(dx.reshape(N, D)[:, :3]).max())
            steps.append(step)
            if not damped and it >= 30 and step > tol and len(steps) > 4 and \
                    all(steps[-k] > 0.9 * steps[-k - 2] for k in (1, 2, 3)):
                damped = it
            if step < tol and dw < wtol:
                converged = True
                break
        Jd, Jo, b, w, r = self._system(x, q_int, nu, w_fix)
        out = dict(mean=x.reshape(N, D) / self.scale, weights=w, resid=r, niter=it, converged=converged,
                   q_int=q_int, Sinv=self.Sinv)
        if marginals:
            S, X = marginals_from_factor(*self.bd.factor_blocks(chol(self.bd.assemble(Jd, Jo))))
            sc = np.outer(self.scale, self.scale)
            out['marg'] = S / sc; out['cross'] = X / sc
        return out


def interpolate(sm, res, tq):
    """Exact GP interpolation of the knot posterior at query times (Anderson & Barfoot); returns the
    mean (m,6) and its marginal variances."""
    tq = np.asarray(tq, float)
    k = np.clip(np.searchsorted(sm.t, tq, side='right') - 1, 0, sm.N - 2)
    tau = (tq - sm.t[k]) / sm.T
    dT = sm.dtau[k]
    S3 = np.linalg.inv(res['Sinv'][k])
    Phi_t, Q_t = phi_q1(tau, sm.order)
    Phi_r, _ = phi_q1(dT - tau, sm.order)
    Phi_D, Q_D = phi_q1(dT, sm.order)
    Psi1 = np.einsum('kab,kcb,kcd->kad', Q_t, Phi_r, np.linalg.inv(Q_D))
    Lam1 = Phi_t - np.einsum('kab,kbc->kac', Psi1, Phi_D)
    Qc1 = Q_t - np.einsum('kab,kbc,kcd->kad', Psi1, Phi_r, Q_t)
    I3 = np.repeat(np.eye(3)[None], len(k), 0)
    Lam, Psi, Qc = kron3(Lam1, I3), kron3(Psi1, I3), kron3(Qc1, S3)
    xs = res['mean'] * sm.scale
    mean = np.einsum('kij,kj->ki', Lam, xs[k]) + np.einsum('kij,kj->ki', Psi, xs[k + 1])
    sc = np.outer(sm.scale, sm.scale)
    Skk, Sk1, X = res['marg'][k] * sc, res['marg'][k + 1] * sc, res['cross'][k] * sc
    P = (np.einsum('kij,kjl,kml->kim', Lam, Skk, Lam) + np.einsum('kij,kjl,kml->kim', Psi, Sk1, Psi)
         + np.einsum('kij,kjl,kml->kim', Lam, X, Psi)
         + np.einsum('kij,kjl,kml->kim', Psi, np.transpose(X, (0, 2, 1)), Lam) + Qc)
    return mean / sm.scale, np.einsum('kii->ki', P) / sm.scale ** 2


# --- per-roll problem, the physically bounded solve, and the CV that picks the noise inflation.

class Problem:
    """Knots at every frame time, observations at the usable frames; `s` inflates every sigma."""

    def __init__(self, rec, order=2, aniso=ANISO):
        ok = rec['ok']
        self.t = rec['t']
        self.obs_idx = np.flatnonzero(ok)
        self.z, self.U, self.sig0 = rec['z'][ok], rec['U'][ok], rec['sig'][ok]
        self.T = float(np.median(np.diff(self.t[self.obs_idx])))
        self.nobs = int(ok.sum())
        self.s = 1.0
        self.order, self.aniso = order, aniso

    def smoother(self, keep=None):
        m = np.ones(self.nobs, bool) if keep is None else keep
        return Smoother(self.t, self.obs_idx[m], self.z[m], self.U[m], self.sig0[m] * self.s, self.T,
                        aniso=self.aniso, order=self.order)


def gap_mask(t, gaps):
    m = np.zeros(len(t), bool)
    for a, b in gaps:
        m |= (t > a) & (t < b)
    return m


def speed100(sm, res, gaps=()):
    """100 Hz posterior-mean speed; nan inside freed links."""
    tq = np.arange(np.ceil(sm.t[0] * 100) / 100, sm.t[-1], 0.01)
    s = np.linalg.norm(interpolate(sm, res, tq)[0][:, 3:6], axis=1)
    s[gap_mask(tq, gaps)] = np.nan
    return tq, s


def burst_windows(tq, s, vmax=VMAX, pad=0.5):
    """Merged, padded windows where the 100 Hz speed exceeds the bound."""
    idx = np.flatnonzero(s > vmax)
    if not len(idx):
        return []
    cuts = np.flatnonzero(np.diff(idx) > 1)
    out = []
    for a, b in zip(np.r_[idx[0], idx[cuts + 1]], np.r_[idx[cuts], idx[-1]]):
        w = [tq[a] - pad, tq[b] + pad]
        if out and w[0] <= out[-1][1]:
            out[-1][1] = max(out[-1][1], w[1])
        else:
            out.append(w)
    return out


def solve_bounded(prob, q_int, vmax=VMAX, max_rounds=5):
    """Fit, then enforce the physical speed bound.  Inside an offending window either a small
    disconnected cluster of frames is dropped, or -- when the raw chord itself jumps (the
    localization moved 100-250 m in one frame) -- the prior link is freed and the interval reported
    as a gap, or the frames the IRLS already downweights are dropped; then re-solve."""
    q_int = np.array(np.broadcast_to(np.asarray(q_int, float), (len(prob.t) - 1,)))
    keep = np.ones(prob.nobs, bool)
    gaps, n_rejected = [], 0
    for rnd in range(max_rounds + 1):
        sm = prob.smoother(keep)
        res = sm.solve(q_int)
        tq, s = speed100(sm, res, gaps)
        vmax100 = float(np.nanmax(s)) if np.isfinite(s).any() else 0.0
        if vmax100 <= vmax or rnd == max_rounds:
            break
        wins = burst_windows(tq, np.nan_to_num(s), vmax)
        t_obs = sm.t[sm.obs_idx]
        inwin = np.zeros(len(t_obs), bool)
        for a, b in wins:
            inwin |= (t_obs >= a) & (t_obs <= b)
        chord = np.linalg.norm(np.diff(sm.z, axis=0), axis=1) / np.maximum(np.diff(t_obs), 1e-6)
        lab = np.r_[0, np.cumsum(chord > vmax)]
        bad = np.zeros(len(t_obs), bool)
        for a, b in wins:
            ctx = (t_obs >= a - 2.0) & (t_obs <= b + 2.0)
            if ctx.sum() < 3:
                continue
            labs, cnt = np.unique(lab[ctx], return_counts=True)
            for L in labs[labs != labs[np.argmax(cnt)]]:
                mem = lab == L
                if np.ptp(t_obs[mem]) <= 3.0 and mem.sum() < 0.5 * ctx.sum():
                    bad |= mem
        n_jump = 0
        for j in np.flatnonzero((chord > vmax) & (inwin[:-1] | inwin[1:])):
            ka, kb = sm.obs_idx[j], sm.obs_idx[j + 1]
            if bad[j] or bad[j + 1] or q_int[ka:kb].max() >= Q_FREE:
                continue
            q_int[ka:kb] = Q_FREE
            gaps.append((float(sm.t[ka]), float(sm.t[kb]))); n_jump += 1
        if not bad.any() and not n_jump:
            bad = inwin & (res['weights'].min(1) < 0.5)
            if not bad.any() and inwin.any():
                rn = np.where(inwin, np.linalg.norm(res['resid'], axis=1), -1)
                bad[np.argsort(rn)[-max(1, int(0.2 * inwin.sum())):]] = True
        if not bad.any():
            if not n_jump:
                break
            continue
        keep[np.flatnonzero(keep)[bad]] = False
        n_rejected += int(bad.sum())
    res['q_int'] = q_int
    return sm, res, dict(vmax100=vmax100, n_rejected=n_rejected, gaps=gaps, keep=keep,
                         bound_failed=bool(vmax100 > vmax), converged=bool(res['converged']))


def logscore(prob, res, idx):
    """Predictive t log-score of held-out observations (scale^2 = sigma^2 + posterior variance)."""
    k = prob.obs_idx[idx]
    U, sig = prob.U[idx], prob.sig0[idx] * prob.s
    d = np.einsum('kji,kj->ki', U, prob.z[idx] - res['mean'][k, :3])
    pv = np.einsum('kji,kjl,kli->ki', U, res['marg'][k, :3, :3], U)
    sc = np.sqrt(sig ** 2 + pv)
    return student_t.logpdf(d / sc, NU) - np.log(sc)


def cv_score(prob, q_int, fold, x0=None):
    """Mean held-out log-score per frame; the folds reuse the full fit's IRLS weights."""
    ll = np.zeros(prob.nobs)
    full = prob.smoother().solve(q_int, x0=x0, maxit=CV_MAXIT, marginals=False)
    for k in range(K_FOLDS):
        held = fold == k
        res = prob.smoother(~held).solve(q_int, x0=full['mean'], maxit=CV_MAXIT,
                                         w_fix=full['weights'][~held])
        ll[held] = logscore(prob, res, np.flatnonzero(held)).sum(1)
    return float(ll.mean()), full


def tune_s_roll(prob, q_int, seed):
    """Per-roll observation-noise inflation by leave-frames-out CV: the log grid plus one bisection
    around its best point.  With q fixed at the dynamics level this is the only tuned quantity."""
    fold = np.random.default_rng(seed).permutation(prob.nobs) % K_FOLDS
    curve, x0 = {}, None
    for s in S_GRID:
        prob.s = float(s)
        curve[float(s)], full = cv_score(prob, q_int, fold, x0=x0)
        x0 = full['mean']
    ss = np.array(sorted(curve)); i = int(np.nanargmax([curve[s] for s in ss]))
    for s in (np.sqrt(ss[max(i - 1, 0)] * ss[i]), np.sqrt(ss[i] * ss[min(i + 1, len(ss) - 1)])):
        if float(s) not in curve:
            prob.s = float(s)
            curve[float(s)], _ = cv_score(prob, q_int, fold, x0=x0)
    ss = np.array(sorted(curve))
    prob.s = float(ss[int(np.nanargmax([curve[s] for s in ss]))])
    return prob.s


# --- exact Student-t observation posterior by Gibbs: the IRLS-Hessian marginals are too narrow
# (position bands 1.33x too narrow); sampling the per-frame scales fixes their calibration.

def gibbs(sm, q_int, mean, nu=NU, sweeps=260, burn=60, n_keep=100, rng=None):
    """Scale mixture: lambda | x ~ Gamma((nu+1)/2, (nu+r^2)/2) per frame and axis, x | lambda from
    the same banded solve.  The prior's along-motion direction is frozen at the posterior mean, which
    makes the conditional exactly linear-Gaussian.  Returns n_keep draws (n_keep, N, 6)."""
    rng = np.random.default_rng(0) if rng is None else rng
    v = np.asarray(mean, float)[:, 3:6]
    vm = 0.5 * (v[:-1] + v[1:])
    nrm = np.linalg.norm(vm, axis=1, keepdims=True)
    sm.v_dir = np.where(nrm > 0.3, vm / np.maximum(nrm, 1e-12), 0.0)
    x = (np.asarray(mean, float) * sm.scale).ravel()
    want = np.zeros(sweeps, bool)
    want[np.linspace(burn, sweeps - 1, n_keep).round().astype(int)] = True
    draws = np.empty((int(want.sum()), sm.N, sm.D))
    k = 0
    for it in range(sweeps):
        r = np.einsum('kji,kj->ki', sm.U, sm.z - x.reshape(sm.N, sm.D)[sm.obs_idx, :3]) / sm.sig
        lam = rng.gamma((nu + 1) / 2, 2.0 / (nu + r ** 2))
        Jd, Jo, b, _, _ = sm._system(x, q_int, nu, lam)
        c = chol(sm.bd.assemble(Jd, Jo))
        mu = x + cho_solve_banded((c, True), b, check_finite=False)
        x = mu + solve_banded((0, sm.bd.u), sm.bd.upper_T(c), rng.standard_normal(sm.bd.n),
                              check_finite=False)
        if want[it]:
            draws[k] = x.reshape(sm.N, sm.D) / sm.scale; k += 1
    sm.v_dir = None
    return draws


# --- correlated draw inflation.  The posterior is calibrated per frame (mean IRLS weight 0.977
# against 1.000) yet 1.66x too narrow for a coasting energy excursion, so the deficit is correlated
# in time and no white term fixes it.  Two smooth along-track components go on the DRAWS only --
# the fit and the state mean are untouched.  Amplitudes measured in tmp/mapexc/{c,d,e}: `bad_loc`
# from the excursion ratio, `good` from racebox, which never touches the map.

INFLATE_TAU = 1.5                                                  # s
INFLATE_AMP = {'good': 0.158, 'bad_loc': 0.932, 'none': 0.0}       # m along-track; 0.0 == inert
INFLATE_TAU_HF = 0.30              # the 0.2-2 Hz deficit the 1.5 s term misses; nothing above 2 Hz,
INFLATE_AMP_HF = {'good': 0.020, 'bad_loc': 0.020, 'none': 0.0}    # where the draws are already wide


def inflate_class(rec):
    """The draw-inflation class of a record.  Calibrated on the localization traces only: a racebox
    record (`k_roll is None`) carries its own characterised noise and is left alone."""
    if rec.get('k_roll') is None:
        return 'none'
    return 'bad_loc' if rec['bad_loc'] else 'good'


def inflate_draws(t, mode, draws, amp, tau=INFLATE_TAU, rng=None):
    """Add a smooth along-track perturbation of sd `amp` m and correlation time `tau` to each draw,
    with its exact derivative added to the velocity so position, speed and energy stay mutually
    consistent.  Centred across draws, so the posterior mean is unchanged."""
    if not amp:
        return draws
    rng = np.random.default_rng(0) if rng is None else rng
    t = np.asarray(t, float)
    dt = float(np.median(np.diff(t)))
    n, half = len(t), int(np.ceil(4 * tau / dt))
    h = np.arange(-half, half + 1) * dt
    g = np.exp(-0.5 * (h / tau) ** 2)
    gd = -h / tau ** 2 * g
    c = np.sqrt((g ** 2).sum())                    # unit-variance response to unit white noise
    g, gd = g / c, gd / c
    u = np.asarray(mode, float)[:, 3:6]
    nrm = np.linalg.norm(u, axis=1, keepdims=True)
    u = np.nan_to_num(np.where(nrm > 0.3, u / np.maximum(nrm, 1e-12), 0.0))
    W = rng.standard_normal((len(draws), n + 2 * half))
    dp = amp * np.stack([np.convolve(w, g, 'valid') for w in W])
    dv = amp * np.stack([np.convolve(w, gd, 'valid') for w in W])
    dp -= dp.mean(0); dv -= dv.mean(0)
    out = draws.copy()
    out[:, :, :3] += dp[:, :, None] * u
    out[:, :, 3:6] += dv[:, :, None] * u
    return out


# --- acceleration: a SECOND fit.  The adopted WNOA state is [p, v], so acceleration has no
# posterior under it and differentiating its velocity has a 2.06 s half-amplitude bandwidth.  The
# WNOJ (order-3) state does carry acceleration, but its raw posterior is 2-3x too narrow, so the
# trace is only defined together with the declared ACCEL_FC low-pass (tmp/estim/out/P6, route A).
# WNOJ feeds NOTHING else: it produces impossible maxima on 10 rolls and its max-energy rms is
# 8.61 J/kg against WNOA's 3.00.

def accel_components(t, draws, fc=ACCEL_FC, tq=None):
    """Forward and lateral acceleration of a WNOJ draw stack, decomposed on the VELOCITY direction
    (`a_fwd = d|v|/dt`, `a_lat = (v x a)_z / |v|`, positive left) -- not the camera axes, which
    differ by 6-9 % of component rms at a median 3.0 deg of slip.  The draws go on a uniform grid at
    the median frame step, are low-passed at `fc` and reduced across draws, then returned at `tq`
    (the frame times by default).
    Known limits: `a_lat`'s 95 % coverage is 0.892 against a 0.90 target, and its SCALE above
    0.5 Hz is unverified -- the two available references disagree with each other there."""
    t = np.asarray(t, float)
    tq = t if tq is None else np.asarray(tq, float)
    dt = float(np.median(np.diff(t)))
    tu = np.arange(t[0], t[-1] + 0.5 * dt, dt)

    def block(j):
        return np.stack([np.column_stack([np.interp(tu, t, d[:, j + a]) for a in range(3)])
                         for d in draws])

    V, A = block(3), block(6)
    s = np.maximum(np.linalg.norm(V, axis=-1), 1e-9)
    b, a = butter(2, 2 * fc * dt, 'low')
    out = {}
    for name, c in (('a_fwd', np.sum(V * A, -1) / s),
                    ('a_lat', (V[..., 0] * A[..., 1] - V[..., 1] * A[..., 0]) / s)):
        f = filtfilt(b, a, c, axis=-1)
        out[name] = np.interp(tq, tu, f.mean(0))
        out[f'sd_{name}'] = np.interp(tq, tu, f.std(0, ddof=1))
    return out


def accel_roll(roll, rec, n_draws=100, fc=ACCEL_FC, s_corr=1.0):
    """The acceleration columns and the WNOJ fit that regenerates them.  Same record, CV, sampler and
    `s_corr` as the WNOA fit, at its own dynamics level and with its own per-roll noise inflation.
    `fc` is the source's declared bandwidth: 1 Hz on both sources, but that buys a 0.575 s
    half-amplitude event duration on the 10 Hz camera trace and 0.24 s on the 25 Hz racebox one,
    where the filter and not the estimator is the limit (tmp/rbaccel/FINDINGS.md)."""
    prob = Problem(rec, order=3, aniso=ANISO_JERK)
    q_int = np.full(len(prob.t) - 1, Q_JERK)
    prob.s = tune_s_roll(prob, q_int, seed=roll) * s_corr
    sm, res, info = solve_bounded(prob, q_int)
    draws = gibbs(sm, res['q_int'], res['mean'], n_keep=n_draws,
                  rng=np.random.default_rng([roll, 3]))
    cols = accel_components(prob.t, draws, fc)
    if info['gaps']:
        g = gap_mask(prob.t, info['gaps'])
        for v in cols.values():
            v[g] = np.nan
    a_max = max(np.nanmax(np.abs(cols[k])) for k in ('a_fwd', 'a_lat'))
    return cols, dict(mean=res['mean'], weights=res['weights'], q_int=res['q_int'],
                      s_roll=prob.s, keep=info['keep'], converged=info['converged'],
                      bound_failed=info['bound_failed'], n_rejected=info['n_rejected'],
                      a_max=float(a_max), implausible=bool(a_max > AMAX),
                      gaps=np.asarray(info['gaps'], float).reshape(-1, 2))


# --- course projection and the adopted quantities of interest.

@lru_cache(maxsize=1)
def course():
    """Centreline vertices, their cumulative chord length, and the LineString (arc == project())."""
    P = np.load(f'{CALIB_PATH}/cl_P.npy')
    return P, np.load(f'{CALIB_PATH}/cl_S.npy'), shapely.LineString(P)


def _enu(lat, lon):
    """ENU metres about the RTK base, the map frame's origin, at the base altitude."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)

    def ecef(la, lo):
        la, lo = np.radians(la), np.radians(lo)
        N = a / np.sqrt(1 - e2 * np.sin(la) ** 2)
        return np.stack([(N + ALT0) * np.cos(la) * np.cos(lo), (N + ALT0) * np.cos(la) * np.sin(lo),
                         (N * (1 - e2) + ALT0) * np.sin(la)], -1)

    la, lo = np.radians(LAT0), np.radians(LON0)
    R = np.array([[-np.sin(lo), np.cos(lo), 0],
                  [-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)],
                  [np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]])
    return (ecef(np.asarray(lat, float), np.asarray(lon, float)) - ecef(LAT0, LON0)) @ R.T


@lru_cache(maxsize=1)
def landmarks():
    """name -> centreline arc (m) of each hills.kml crossing line, taken at its midpoint."""
    blocks = re.findall(r'<coordinates>(.*?)</coordinates>',
                        open(f'{DATA_PATH}/geo/hills.kml').read(), re.S)
    line = course()[2]
    out = {}
    for nm, c in zip(LANDMARK_NAMES, blocks):
        p = np.array([[float(v) for v in tok.split(',')] for tok in c.split()])
        mid = _enu(p[:, 1], p[:, 0]).mean(0)
        out[nm] = float(shapely.line_locate_point(line, shapely.Point(mid[:2])))
    return out


def project(xy):
    """Arc length, signed lateral offset (+left) and unit tangent on the course centreline."""
    CL_P, CL_S, CENTRELINE = course()
    xy = np.atleast_2d(np.asarray(xy, float))
    fin = np.isfinite(xy).all(1)
    q = np.where(fin[:, None], xy, CL_P[0])
    arc = shapely.line_locate_point(CENTRELINE, shapely.points(q))
    j = np.clip(np.searchsorted(CL_S, arc, 'left') - 1, 0, len(CL_P) - 2)   # a vertex hit takes the
    AB = CL_P[j + 1] - CL_P[j]                                             # segment that arrives
    tan = AB / np.sqrt((AB * AB).sum(1))[:, None]
    v = q - (CL_P[j] + (arc - CL_S[j])[:, None] * tan)
    lat = v[:, 0] * tan[:, 1] - v[:, 1] * tan[:, 0]
    return np.where(fin, arc, np.nan), np.where(fin, lat, np.nan), tan


def crossing_time(t, arc, L):
    """Time of the first upward crossing of arc(t) through L; nan if there is none."""
    m = np.isfinite(arc) & np.isfinite(t)
    t, arc = t[m], arc[m]
    k = np.flatnonzero((arc[:-1] < L) & (arc[1:] >= L))
    if len(t) < 2 or not len(k):
        return np.nan
    k = k[0]
    return float(t[k] + (L - arc[k]) / (arc[k + 1] - arc[k]) * (t[k + 1] - t[k]))


def at_time(t, y, tq):
    """Linear interpolation of y(t) at tq; nan outside the finite samples."""
    m = np.isfinite(y) & np.isfinite(t)
    if m.sum() < 2 or not np.isfinite(tq) or tq < t[m][0] or tq > t[m][-1]:
        return np.nan
    return float(np.interp(tq, t[m], y[m]))


def _mark(ev, keys, default):
    for k in keys:
        if np.isfinite(ev.get(k, np.nan)):
            return float(ev[k])
    return default


def search_regions(t, E, ev):
    """Roll window and the release / contact search regions.  The buggy coasts from the release to
    the hill-3 contact, so the energy maximum before the chute IS the release and the minimum after
    it IS the contact: neither needs hill_start:2, which more than half the corpus lacks.  The
    release is bracketed to +-15 s of the freeroll marking unless that pins it to a bracket edge."""
    win = (t >= ev.get('roll_start', -np.inf)) & (t <= ev.get('roll_end', np.inf))
    m6 = win & (t >= ev.get('roll_start', t[0])) & (t <= _mark(ev, REL_HI, t[-1]))
    fr = ev.get('freeroll_start')
    if fr is not None and m6.any():
        g = m6 & (t >= fr - GUARD_S) & (t <= fr + GUARD_S)
        if g.any() and np.isfinite(E[g]).any():
            i = int(np.argmax(np.where(g & np.isfinite(E), E, -np.inf)))
            tg, tm = t[g], t[m6]
            pinned = ((tg[0] > tm[0] and t[i] - tg[0] <= GUARD_EDGE)
                      or (tg[-1] < tm[-1] and tg[-1] - t[i] <= GUARD_EDGE))
            if not pinned:
                m6 = g
    lo = _mark(ev, CON_LO, np.nan)
    if not np.isfinite(lo) and m6.any():
        lo = t[int(np.argmax(np.where(m6 & np.isfinite(E), E, -np.inf)))]
    m7 = win & (t >= lo) & (t <= _mark(ev, CON_HI, t[-1])) if np.isfinite(lo) else np.zeros(len(t), bool)
    return win, m6, m7


def quantities(t, mean, draws, ev, w=1.0):
    """The adopted QoIs, each with an uncertainty.  Row 0 of the stack is the posterior mean and the
    rest are draws, so every value is the plug-in on the mean and every sd the draw spread.  Maxima
    and the energy extrema are taken on a w-second average and carry the spectral correction; the
    interval times are inflated x1.5, the factor by which their posterior is short."""
    X = np.concatenate([np.asarray(mean, float)[None], np.asarray(draws, float)])
    n = len(X); r = np.arange(n)
    spd = np.linalg.norm(X[:, :, 3:6], axis=2)
    E = 0.5 * spd ** 2 + G * X[:, :, 2]
    arc_m, _, tan = project(X[0, :, :2])
    arc = arc_m + np.einsum('sni,ni->sn', X[:, :, :2] - X[0, :, :2], tan)
    win, m6, m7 = search_regions(t, E[0], ev)
    dt = float(np.median(np.diff(t)))
    k = max(1, int(round(w / dt))); k += 1 - k % 2
    sw = uniform_filter1d(spd, k, axis=-1, mode='nearest')
    Ew = uniform_filter1d(E, k, axis=-1, mode='nearest')
    inwin = win & np.isfinite(spd).all(0) & np.isfinite(E).all(0)
    valid = inwin.copy()
    h = k // 2
    if h:                                        # the average must not reach outside the roll
        valid[:h] = False; valid[-h:] = False
        valid[h:] &= inwin[:-h]; valid[:-h] &= inwin[h:]
    rows = []

    def add(name, v, unit, sd_extra=0.0, offset=0.0, inflate=1.0):
        v = np.asarray(v, float)
        sd = np.nanstd(v[1:], ddof=1) if np.isfinite(v[1:]).sum() > 1 else np.nan
        rows.append(dict(quantity=name, value=v[0] + offset, unit=unit,
                         sd=float(np.hypot(inflate * sd, sd_extra))))

    def peak(y, mask, kind):
        yy = np.where(mask[None], y, -np.inf if kind == 'max' else np.inf)
        return np.argmax(yy, 1) if kind == 'max' else np.argmin(yy, 1)

    def span(mask):
        return float(t[mask][-1] - t[mask][0])

    i = peak(sw, valid, 'max')
    c = correction(t, sw[0], i[0], span(inwin), k)
    add('max_speed', sw[r, i], 'm/s', c['sd'], c['offset'])
    i = peak(Ew, valid, 'max')
    c = correction(t, Ew[0], i[0], span(inwin), k, var_scale=spd[0, i[0]] ** 2)
    add('max_energy', Ew[r, i], 'J/kg', c['sd'], c['offset'])

    # a line crossing belongs to the trajectory, so it is not capped at the marked roll_end: the
    # finish line sits a few tenths of a metre past it on 475 rolls.  The start bound stays, or
    # pre-roll motion in the pad steals the hill_1 and hill_2 crossings.
    lmwin = inwin | ((t >= ev.get('roll_start', -np.inf)) & np.isfinite(spd).all(0)
                     & np.isfinite(E).all(0))
    tw = t[lmwin]
    lm_t, lm_E = {}, {}
    for nm, L in landmarks().items():
        lm_t[nm] = np.array([crossing_time(tw, arc[j][lmwin], L) for j in r])
        lm_E[nm] = np.array([at_time(tw, E[j][lmwin], lm_t[nm][j]) for j in r])
        add(f'speed.{nm}', [at_time(tw, spd[j][lmwin], lm_t[nm][j]) for j in r], 'm/s')
    for a, b in PAIRS:
        add(f'time.{a}-{b}', lm_t[b] - lm_t[a], 's', inflate=1.5)
        add(f'eloss.{a}-{b}', lm_E[a] - lm_E[b], 'J/kg')

    for nm, mask, kind in (('release', m6, 'max'), ('contact', m7, 'min')):
        mm = valid & mask
        if not mm.any():
            continue
        i = peak(Ew, mm, kind)
        v_pk = spd[0, i[0]]
        c = correction(t, Ew[0], i[0], span(mm), k, kind, var_scale=v_pk ** 2)
        add(f'{nm}.arc', arc[r, i], 'm', c['sd_t'] * v_pk)
        add(f'{nm}.t', t[i], 's', c['sd_t'])
        add(f'{nm}.speed', sw[r, i], 'm/s')
    return pd.DataFrame(rows).set_index('quantity')


# --- spectral correction for extremum estimators (P5): the offset between the raw extremum of the
# motion and the extremum of the 1 s-windowed series, derived from the measured motion spectrum.

@lru_cache(maxsize=1)
def speed_psd():
    """Corpus along-track velocity PSD with the receiver-noise floor removed ('mid' level)."""
    z = np.load(f'{CALIB_PATH}/qdyn_ext_spectra.npz')
    f = z['f']; m = f >= 0.2
    return f[m], np.clip(z['raw'][m, 2] - z['noise'][m], 0, None) / (2 * np.pi * f[m]) ** 2


def resp_movavg(f, k, dt):
    """Real transfer of a centred k-tap moving average (Dirichlet kernel)."""
    x = np.pi * np.asarray(f, float) * dt
    num, den = np.sin(k * x), k * np.sin(x)
    out = np.where(np.abs(den) < 1e-12, 1.0, num / np.where(np.abs(den) < 1e-12, 1.0, den))
    return np.where(np.abs(x) < 1e-12, 1.0, out)


def peak_curvature(t, y, i, kind='max', h=1.0):
    """|second derivative| of a local quadratic fit to y within h seconds of its extremum."""
    m = np.isfinite(y) & (np.abs(t - t[i]) <= h)
    if m.sum() < 4:
        return np.nan
    c = np.polyfit(t[m] - t[i], y[m], 2)[0]
    return -2 * c if kind == 'max' else 2 * c


def _upcrossings(z, sigma, nu0, a, T, n_t=601):
    """Rice's expected upcrossing count of level z by u(t) - a t^2 / 2 over |t| <= T/2."""
    half = 0.5 * T
    if a > 0:
        half = min(half, float(np.sqrt(2 * max(np.max(z) + 6 * sigma, 6 * sigma) / a)))
    tt = np.linspace(-half, half, n_t)
    lev = np.atleast_1d(z)[:, None] + 0.5 * a * tt[None] ** 2
    return nu0 * np.trapezoid(np.exp(-0.5 * (lev / sigma) ** 2), tt, axis=1)


def evt_excursion(sigma, nu0, a, T):
    """E[max_t (u(t) - a t^2/2)] for a stationary Gaussian residual u (sd sigma, upcrossing rate nu0)
    and the Gumbel scale at the N = 1 level, which is the correction's own uncertainty.  From the
    Poisson-clump CDF P(max < z) = Phi(z / sigma) exp(-N(z)); no fitted constant."""
    if not (sigma > 0 and nu0 > 0 and T > 0):
        return 0.0, float(sigma)
    zs = np.linspace(-5 * sigma, 9 * sigma, 600)
    N = _upcrossings(zs, sigma, nu0, a, T)
    F = np.clip(ndtr(zs / sigma) * np.exp(-N), 0, 1)
    pos = zs >= 0
    D = float(np.trapezoid(1 - F[pos], zs[pos]) - np.trapezoid(F[~pos], zs[~pos]))
    lg = np.log(np.maximum(N, 1e-300))
    k = np.flatnonzero((lg[:-1] > 0) & (lg[1:] <= 0))
    if not len(k):
        return D, float(sigma)
    i = int(k[0])
    return D, float(1.0 / max((lg[i] - lg[i + 1]) / (zs[1] - zs[0]), 1e-12))


def argmax_sd(sigma, nu0, a, T, n_z=300, n_t=601):
    """sd of the argmax of u(t) - a t^2/2 under the same clump description: the upcrossings of level z
    are Poisson with intensity lam_z(t), so the winning point has density proportional to
    -d lam_z / dz; integrating over the level distribution gives p(t)."""
    if not (sigma > 0 and nu0 > 0 and T > 0):
        return np.nan
    zs = np.linspace(-4 * sigma, 9 * sigma, n_z)
    half = 0.5 * T
    if a > 0:
        half = min(half, float(np.sqrt(2 * (zs[-1] + 6 * sigma) / a)))
    tt = np.linspace(-half, half, n_t)
    lev = zs[:, None] + 0.5 * a * tt[None] ** 2
    A = nu0 * np.exp(-0.5 * (lev / sigma) ** 2)
    F = np.clip(ndtr(zs / sigma) * np.exp(-np.trapezoid(A, tt, axis=1)), 0, 1)
    W = A * np.maximum(lev, 0.0) / sigma ** 2
    norm = np.trapezoid(W, tt, axis=1)
    if not (norm > 0).any():
        return np.nan
    q = np.where(norm[:, None] > 0, W / np.where(norm[:, None] > 0, norm[:, None], 1.0), 0.0)
    p = np.trapezoid(np.gradient(F, zs)[:, None] * q, zs, axis=0)
    s = float(np.trapezoid(p, tt))
    if s <= 0:
        return np.nan
    p = p / s
    return float(np.sqrt(max(np.trapezoid(p * tt ** 2, tt) - np.trapezoid(p * tt, tt) ** 2, 0.0)))


def correction(t, y, i, T, k, kind='max', var_scale=1.0):
    """Offset raw - windowed for the extremum of y (filtered with a k-tap average), its own sd, and
    the sd of the extremum's LOCATION.  var_scale carries the speed PSD to the quantity (v^2 for
    energy).  The location sd combines the peak-dominated and excursion-dominated limits, which are
    independent constraints on where the argmax can sit."""
    dt = float(np.median(np.diff(t)))
    f, S = speed_psd()
    R = (1 - resp_movavg(f, k, dt)) ** 2 * S * var_scale
    m0 = float(np.trapezoid(R, f))
    if m0 <= 0:
        return dict(offset=0.0, sd=0.0, sd_t=np.nan)
    sigma = np.sqrt(m0)
    nu0 = np.sqrt(float(np.trapezoid(R * f ** 2, f)) / m0)
    a = peak_curvature(t, y, i, kind)
    a = 1e-6 if not np.isfinite(a) or a <= 0 else a
    D, beta = evt_excursion(sigma, nu0, a, T)
    mu2 = dt ** 2 * (k ** 2 - 1) / 12.0                 # the average's second moment
    dens = argmax_sd(sigma, nu0, a, T)
    lin = 2 * np.pi * nu0 * sigma / a
    inv = sum(1 / x ** 2 for x in (lin, dens) if np.isfinite(x) and x > 0)
    return dict(offset=0.5 * a * mu2 + D, sd=beta, sd_t=float(1 / np.sqrt(inv)) if inv else np.nan)


def estimate_roll(roll, events, n_draws=100, rec=None, s_corr=1.0):
    """Record -> s_roll by CV -> bounded robust WNOA fit -> Student-t posterior by Gibbs.
    Returns the posterior mean and draws at the frame times and the 100 Hz interpolation.
    `rec` supplies a record from another source; `s_corr` scales the CV's noise level."""
    rec = load_record(roll, events) if rec is None else rec
    prob = Problem(rec)
    q_int = np.full(len(prob.t) - 1, Q_ALONG)
    s_roll = tune_s_roll(prob, q_int, seed=roll) * s_corr
    prob.s = s_roll
    sm, res, info = solve_bounded(prob, q_int)
    draws = gibbs(sm, res['q_int'], res['mean'], n_keep=n_draws, rng=np.random.default_rng(roll))
    cls = inflate_class(rec)
    draws = inflate_draws(prob.t, res['mean'], draws, INFLATE_AMP[cls],
                          rng=np.random.default_rng(roll + 1))
    draws = inflate_draws(prob.t, res['mean'], draws, INFLATE_AMP_HF[cls], tau=INFLATE_TAU_HF,
                          rng=np.random.default_rng(roll + 10007))   # seed must differ from the LF
    mean = draws.mean(0)
    t100 = np.arange(np.ceil(prob.t[0] * 100) / 100, prob.t[-1], 0.01)
    mean100, var100 = interpolate(sm, res, t100)
    if info['gaps']:                    # knots inside a freed link are not part of the estimate
        g = gap_mask(prob.t, info['gaps'])
        mean[g] = np.nan; draws[:, g] = np.nan; res['mean'][g] = np.nan
        g = gap_mask(t100, info['gaps'])
        mean100[g] = np.nan; var100[g] = np.nan
    return dict(roll=roll, t=prob.t, mean=mean, mode=res['mean'], draws=draws, t100=t100,
                mean100=mean100, var100=var100, s_roll=s_roll, weights=res['weights'],
                q_int=res['q_int'], events=rec['events'], bad_loc=rec['bad_loc'],
                event_anchor=rec['event_anchor'], event_offset_ms=rec['event_offset_ms'],
                meta=rec['meta'], **info)
