// Thin wrapper over the preload bridge (window.ft).
const bridge = window.ft;

export const call = (channel, ...args) => bridge.call(channel, ...args);
export const on = (channel, cb) => bridge.on(channel, cb);
export const pathForFile = (file) => bridge.pathForFile(file);
