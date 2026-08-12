const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('diagAPI', {
  runFullDiagnostic: (opts) => ipcRenderer.invoke('run-full-diagnostic', opts),
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('diagnostic-progress');
    ipcRenderer.on('diagnostic-progress', (_e, stage) => callback(stage));
  },

  retrySmartElevated: (payload) => ipcRenderer.invoke('retry-smart-elevated', payload),

  getDisplayChecks: () => ipcRenderer.invoke('get-display-checks'),
  saveDisplayCheck: (payload) => ipcRenderer.invoke('save-display-check', payload),

  getVramCheck: () => ipcRenderer.invoke('get-vram-check'),
  saveVramCheck: (payload) => ipcRenderer.invoke('save-vram-check', payload),

  getGpuStressCheck: () => ipcRenderer.invoke('get-gpu-stress-check'),
  saveGpuStressCheck: (payload) => ipcRenderer.invoke('save-gpu-stress-check', payload),

  startLiveMonitor: () => ipcRenderer.send('start-live-monitor'),
  stopLiveMonitor: () => ipcRenderer.send('stop-live-monitor'),
  onLiveSample: (callback) => {
    ipcRenderer.removeAllListeners('live-sample');
    ipcRenderer.on('live-sample', (_e, sample) => callback(sample));
  },
  saveLiveRecording: (payload) => ipcRenderer.invoke('save-live-recording', payload),

  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  saveReport: (payload) => ipcRenderer.invoke('save-report', payload),

  getStressLimits: () => ipcRenderer.invoke('get-stress-limits'),
  runCpuStress: (opts) => ipcRenderer.invoke('run-cpu-stress', opts),
  abortCpuStress: () => ipcRenderer.send('abort-cpu-stress'),
  runStorageTest: (opts) => ipcRenderer.invoke('run-storage-test', opts),
  runRamTest: (opts) => ipcRenderer.invoke('run-ram-test', opts),
  onStressProgress: (callback) => {
    ipcRenderer.removeAllListeners('stress-progress');
    ipcRenderer.on('stress-progress', (_e, data) => callback(data));
  },

  runInspectionScan: (opts) => ipcRenderer.invoke('run-inspection-scan', opts),
  saveInspectionReport: (payload) => ipcRenderer.invoke('save-inspection-report', payload),
  retrySmartElevatedInspection: (payload) => ipcRenderer.invoke('retry-smart-elevated-inspection', payload),
});
