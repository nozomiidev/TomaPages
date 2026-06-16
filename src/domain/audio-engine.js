function createAudioContext() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Web Audio API is not available in this browser.');
  }
  return new AudioContextClass();
}

function rmsLevel(analyser, bufferRef) {
  if (!analyser) return 0;

  if (!bufferRef.current || bufferRef.current.length !== analyser.fftSize) {
    bufferRef.current = new Float32Array(analyser.fftSize);
  }

  analyser.getFloatTimeDomainData(bufferRef.current);

  let sum = 0;
  for (let index = 0; index < bufferRef.current.length; index += 1) {
    const sample = bufferRef.current[index];
    sum += sample * sample;
  }

  return Math.sqrt(sum / bufferRef.current.length);
}

const DEMO_SYLLABLES = [
  [0.06, 0.26, 0.06],
  [0.38, 0.64, 0.13],
  [0.78, 0.98, 0.08],
  [1.2, 1.46, 0.16],
  [1.62, 1.82, 0.07],
  [2.06, 2.4, 0.18],
  [2.68, 2.92, 0.11],
  [3.12, 3.5, 0.2],
  [3.76, 4.1, 0.09],
];

function demoEnvelope(elapsed) {
  let level = 0;

  for (const [start, end, peak] of DEMO_SYLLABLES) {
    const attack = 0.055;
    const release = 0.12;
    if (elapsed < start || elapsed > end + release) continue;

    if (elapsed < start + attack) {
      level = Math.max(level, peak * ((elapsed - start) / attack));
    } else if (elapsed <= end) {
      level = Math.max(level, peak);
    } else {
      level = Math.max(level, peak * (1 - (elapsed - end) / release));
    }
  }

  return level;
}

export class AudioLevelEngine {
  constructor() {
    this.context = null;
    this.micAnalyser = null;
    this.micStream = null;
    this.fileAnalyser = null;
    this.fileSource = null;
    this.demoStartedAt = 0;
    this.demoDuration = 0;
    this.demoTimerId = 0;
    this.bufferRef = { current: null };
  }

  getContext() {
    if (!this.context) {
      this.context = createAudioContext();
    }
    return this.context;
  }

  async resume() {
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  async startMic() {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not available in this browser.');
    }

    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const context = this.getContext();
    await context.resume();

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.28;
    source.connect(analyser);

    this.stopMic();
    this.micStream = stream;
    this.micAnalyser = analyser;
  }

  stopMic() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
    }
    this.micStream = null;
    this.micAnalyser = null;
  }

  attachAudioElement(element) {
    if (this.fileSource) return;

    const context = this.getContext();
    const source = context.createMediaElementSource(element);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.16;

    source.connect(analyser);
    analyser.connect(context.destination);

    this.fileSource = source;
    this.fileAnalyser = analyser;
  }

  async startDemoSignal({ duration = 4.8 } = {}) {
    this.stopDemoSignal();
    this.demoStartedAt = performance.now();
    this.demoDuration = duration;
    this.demoTimerId = window.setTimeout(() => this.stopDemoSignal(), duration * 1000 + 240);
  }

  stopDemoSignal() {
    if (this.demoTimerId) {
      window.clearTimeout(this.demoTimerId);
    }

    this.demoStartedAt = 0;
    this.demoDuration = 0;
    this.demoTimerId = 0;
  }

  demoLevel() {
    if (!this.demoStartedAt) return 0;

    const elapsed = (performance.now() - this.demoStartedAt) / 1000;
    if (elapsed > this.demoDuration) {
      this.stopDemoSignal();
      return 0;
    }

    return demoEnvelope(elapsed);
  }

  level() {
    return Math.max(
      rmsLevel(this.micAnalyser, this.bufferRef),
      rmsLevel(this.fileAnalyser, this.bufferRef),
      this.demoLevel(),
    );
  }

  isMicOn() {
    return Boolean(this.micAnalyser);
  }

  dispose() {
    this.stopMic();
    this.stopDemoSignal();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close();
    }
  }
}
