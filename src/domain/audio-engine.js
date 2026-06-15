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

export class AudioLevelEngine {
  constructor() {
    this.context = null;
    this.micAnalyser = null;
    this.micStream = null;
    this.fileAnalyser = null;
    this.fileSource = null;
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

  level() {
    return Math.max(
      rmsLevel(this.micAnalyser, this.bufferRef),
      rmsLevel(this.fileAnalyser, this.bufferRef),
    );
  }

  isMicOn() {
    return Boolean(this.micAnalyser);
  }

  dispose() {
    this.stopMic();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close();
    }
  }
}
