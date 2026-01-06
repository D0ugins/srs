from scipy import signal
import numpy as np
import pandas as pd

def lowpass_filter(data, cutoff_freq, fs, order=5):
    nyquist_freq = 0.5 * fs
    normalized_cutoff = cutoff_freq / nyquist_freq
    sos = signal.butter(order, normalized_cutoff, btype='low', output='sos')    
    return signal.sosfiltfilt(sos, data)

def unfiorm_sample(data: pd.DataFrame, fs_target: float | None = None):
    """
    Resample data to uniform sampling rate fs_target (in Hz) using linear interpolation.
    Assumes data is indexed by timestamp in milliseconds.
    """
    
    if fs_target is None:
        fs_target = float(1000 / np.median(np.diff(data.index)))

    start_time = data.index.min()
    end_time = data.index.max()
    target_index = pd.RangeIndex(start=start_time, stop=end_time + 1, step=int(1000 / fs_target))
    resampled_data = data.reindex(target_index).interpolate(method='linear')
    return resampled_data
