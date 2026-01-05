from scipy import signal

def lowpass_filter(data, cutoff_freq, fs, order=5):
    nyquist_freq = 0.5 * fs
    normalized_cutoff = cutoff_freq / nyquist_freq
    sos = signal.butter(order, normalized_cutoff, btype='low', output='sos')    
    return signal.sosfiltfilt(sos, data)