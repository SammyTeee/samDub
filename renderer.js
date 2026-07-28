let audioCtx;
let source;
let buffer;
let inputBus;
let filterNode;
let crushNode;
let dryGain;
let trueBypassGain;
let delayNode;
let delayToneNode;
let delayWet;
let delayFeedback;
let reverbNode;
let reverbWet;
let masterGain;
let limiterNode;
let deckAGain;
let deckBGain;
let recordDestination;
let meterSplitter;
let meterLeft;
let meterRight;
let meterLeftData;
let meterRightData;
let meterLeftFrequencyData;
let meterRightFrequencyData;
let reverbTimer;
let mediaRecorder;
let recordingStartedAt = 0;
let recordingState = 'idle';
let pendingRecordingBlob = null;

let playing = false;
let startedAt = 0;
let pauseAt = 0;
let activePlaybackRate = 1;
let loopEnabled = true;
let sirenOsc;
let sirenGain;
let sirenLfo;
let sirenLfoGain;
let midiAccess;
const xinputState = {
  index: null,
  id: '',
  connected: false,
  buttons: Array(16).fill(false),
  lastTimestamp: 0,
  buildActive: false,
  frames: 0
};
let midiLearn = false;
let learningControl = null;
let allBypassed = false;
let echoPreset = 'dub';
let currentBpm = 86;
let deckALoadToken = 0;
let deckBLoadToken = 0;
let lastRemovedTrack = null;
const spectrumBarCount = 72;
const spectrumLevels = new Float32Array(spectrumBarCount);
const spectrumTargets = new Float32Array(spectrumBarCount);
const spectrumPeakLevels = new Float32Array(spectrumBarCount);
const spectrumPeakHoldUntil = new Float64Array(spectrumBarCount);
const cannabisLeafBlades = Object.freeze([
  { angle: -1.02, length: .28, width: .06 },
  { angle: -.68, length: .43, width: .075 },
  { angle: -.34, length: .59, width: .085 },
  { angle: 0, length: .7, width: .09 },
  { angle: .34, length: .59, width: .085 },
  { angle: .68, length: .43, width: .075 },
  { angle: 1.02, length: .28, width: .06 }
]);
let spectrumFrameCount = 0;
let spectrumRafFrameCount = 0;
let spectrumPeak = 0;
let spectrumLastAnimationTimestamp = 0;
let spectrumFpsWindowStart = 0;
let spectrumFpsWindowFrames = 0;
let spectrumFps = 0;
let spectrumRenderAverageMs = 0;
let spectrumRenderMaxMs = 0;
let spectrumBandBins = [];
let spectrumBandSampleRate = 0;
let spectrumBandBinCount = 0;
let spectrumCanvas = null;
let spectrumContext = null;
let spectrumPanel = null;
let spectrumStateLabel = null;
let spectrumWatermarkCanvas = null;
let spectrumBarGradient = null;
let spectrumWidth = 0;
let spectrumHeight = 0;
let spectrumPixelRatio = 1;
let spectrumVisible = true;
let spectrumCurrentState = '';
let spectrumResizeObserver = null;
let spectrumIntersectionObserver = null;
const spectrumReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let currentAnalysis = { bpm: 86, confidence: 1, beats: [] };
let currentTrack = {
  id: 'builtin',
  title: 'Midnight Pressure',
  artist: '',
  name: 'Midnight Pressure',
  path: '',
  source: 'Built-in groove',
  bpm: 86,
  duration: 8
};
const deckB = {
  buffer: null,
  source: null,
  playing: false,
  startedAt: 0,
  pauseAt: 0,
  track: null,
  analysis: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bridge = window.dubstation;
const audioExtensions = /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff)$/i;
const values = {
  filter: 100,
  delay: 0,
  reverb: 0,
  crush: 0,
  build: 0,
  sirenFreq: 42,
  sirenRate: 18,
  sirenLevel: 55,
  delayTime: 345,
  delayFeedback: 56,
  delayTone: 52,
  filterResonance: 12,
  reverbDecay: 48
};
const defaults = { ...values };
const fxEnabled = { filter: true, delay: true, reverb: true, crush: true };

function readStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The workstation remains usable if a locked-down profile blocks storage.
  }
}

// These legacy storage keys intentionally survive the samDub rename.
let library = readStore('dubstation:library:v2', []);
if (!Array.isArray(library)) library = [];
const settingsState = { advancedFx: false, ...readStore('dubstation:settings:v2', {}) };
const midiMappings = readStore('dubstation:midi', {});

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value)));
const formatTime = time => {
  const safe = Number.isFinite(time) ? Math.max(0, time) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(Math.floor(safe % 60)).padStart(2, '0')}.${String(Math.floor((safe % 1) * 100)).padStart(2, '0')}`;
};
const formatShortTime = time => {
  const safe = Number.isFinite(time) ? Math.max(0, Math.round(time)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};
const status = message => {
  $('#status').textContent = message;
};
const titleFromName = name => String(name || 'Untitled').replace(/\.[^.]+$/, '');
const titleFromMeta = (meta, existing) => String(meta?.title || existing?.title || titleFromName(meta?.name)).trim();
const artistFromMeta = (meta, existing) => String(meta?.artist || existing?.artist || '').trim();
let marqueeResizeFrame = 0;

function refreshMarquee(element) {
  const content = element?.querySelector('span');
  if (!content || !element.isConnected) return;
  const overflow = Math.max(0, content.scrollWidth - element.clientWidth);
  element.classList.toggle('scrolling', overflow > 4);
  element.style.setProperty('--scroll-distance', `${-(overflow + 10)}px`);
  element.style.setProperty('--scroll-duration', `${Math.max(7, 5 + overflow / 24).toFixed(1)}s`);
}

function setMarqueeText(element, text) {
  if (!element) return;
  const safeText = String(text || 'Untitled');
  if (element.dataset.marqueeText === safeText && element.firstElementChild) return;
  const content = document.createElement('span');
  content.textContent = safeText;
  element.classList.add('marquee-text');
  element.dataset.marqueeText = safeText;
  element.title = safeText;
  element.replaceChildren(content);
  requestAnimationFrame(() => refreshMarquee(element));
}

function setTrackDetails(parts) {
  const target = $('#track-artist');
  const fragment = document.createDocumentFragment();
  parts.filter(Boolean).forEach((part, index) => {
    if (index) {
      const divider = document.createElement('i');
      divider.textContent = '·';
      fragment.appendChild(divider);
    }
    fragment.appendChild(document.createTextNode(String(part)));
  });
  target.replaceChildren(fragment);
}

window.addEventListener('resize', () => {
  cancelAnimationFrame(marqueeResizeFrame);
  marqueeResizeFrame = requestAnimationFrame(() => $$('.marquee-text').forEach(refreshMarquee));
});

const locationFromPath = filePath => {
  const value = String(filePath || '');
  const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  return index >= 0 ? value.slice(0, index) : value || 'This session';
};
const makeTrackId = filePath => {
  let hash = 2166136261;
  for (const character of String(filePath).toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `track-${(hash >>> 0).toString(36)}`;
};

function impulse(seconds = 1.8, decay = 3.5) {
  const length = Math.floor(audioCtx.sampleRate * seconds);
  const result = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = result.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return result;
}

function driveCurve(amount) {
  if (amount < .005) return null;
  const result = new Float32Array(2048);
  const drive = 1 + amount * 24;
  for (let i = 0; i < result.length; i++) {
    const x = i * 2 / result.length - 1;
    result[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return result;
}

function refreshAudioEngineState() {
  const state = audioCtx?.state || 'standby';
  const label = state === 'running' ? 'AUDIO LIVE' : state === 'suspended' ? 'AUDIO PAUSED' : 'ENGINE STANDBY';
  $('#engine-label').textContent = label;
  $('#engine-dot').classList.toggle('standby', state !== 'running');
}

function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext({ latencyHint: 'interactive' });
  inputBus = audioCtx.createGain();
  filterNode = audioCtx.createBiquadFilter();
  crushNode = audioCtx.createWaveShaper();
  dryGain = audioCtx.createGain();
  trueBypassGain = audioCtx.createGain();
  delayNode = audioCtx.createDelay(2);
  delayToneNode = audioCtx.createBiquadFilter();
  delayWet = audioCtx.createGain();
  delayFeedback = audioCtx.createGain();
  reverbNode = audioCtx.createConvolver();
  reverbWet = audioCtx.createGain();
  masterGain = audioCtx.createGain();
  limiterNode = audioCtx.createDynamicsCompressor();
  deckAGain = audioCtx.createGain();
  deckBGain = audioCtx.createGain();
  recordDestination = audioCtx.createMediaStreamDestination();
  meterSplitter = audioCtx.createChannelSplitter(2);
  meterLeft = audioCtx.createAnalyser();
  meterRight = audioCtx.createAnalyser();
  meterLeft.fftSize = meterRight.fftSize = 1024;
  meterLeft.minDecibels = meterRight.minDecibels = -90;
  meterLeft.maxDecibels = meterRight.maxDecibels = -12;
  meterLeft.smoothingTimeConstant = meterRight.smoothingTimeConstant = .7;
  meterLeftData = new Float32Array(meterLeft.fftSize);
  meterRightData = new Float32Array(meterRight.fftSize);
  meterLeftFrequencyData = new Uint8Array(meterLeft.frequencyBinCount);
  meterRightFrequencyData = new Uint8Array(meterRight.frequencyBinCount);

  filterNode.type = 'lowpass';
  delayToneNode.type = 'lowpass';
  crushNode.oversample = '2x';
  dryGain.gain.value = 1;
  trueBypassGain.gain.value = 0;
  delayWet.gain.value = 0;
  delayFeedback.gain.value = 0;
  reverbWet.gain.value = 0;
  masterGain.gain.value = Number($('#master').value);
  const reverbSeconds = 1.05 + values.reverbDecay / 100 * 3.2;
  const reverbShape = 4.8 - values.reverbDecay / 100 * 2.2;
  reverbNode.buffer = impulse(reverbSeconds, reverbShape);
  limiterNode.threshold.value = -3;
  limiterNode.knee.value = 6;
  limiterNode.ratio.value = 20;
  limiterNode.attack.value = .003;
  limiterNode.release.value = .12;

  deckAGain.connect(inputBus);
  deckBGain.connect(inputBus);
  inputBus.connect(trueBypassGain).connect(masterGain);
  inputBus.connect(filterNode);
  filterNode.connect(crushNode);
  crushNode.connect(dryGain).connect(masterGain);
  crushNode.connect(delayNode);
  delayNode.connect(delayToneNode);
  delayToneNode.connect(delayWet).connect(masterGain);
  delayToneNode.connect(delayFeedback).connect(delayNode);
  crushNode.connect(reverbNode);
  reverbNode.connect(reverbWet).connect(masterGain);
  masterGain.connect(limiterNode);
  limiterNode.connect(audioCtx.destination);
  limiterNode.connect(recordDestination);
  limiterNode.connect(meterSplitter);
  meterSplitter.connect(meterLeft, 0);
  meterSplitter.connect(meterRight, 1);
  audioCtx.addEventListener('statechange', refreshAudioEngineState);
  refreshAudioEngineState();
  setCrossfader(Number($('#crossfader').value) / 100);
  applyAudioState();
}

function meterPercent(analyser, data) {
  if (!analyser || !data || audioCtx?.state !== 'running') return 0;
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const sample of data) sum += sample * sample;
  const rms = Math.sqrt(sum / data.length);
  if (rms < .00001) return 0;
  const decibels = 20 * Math.log10(rms);
  return clamp((decibels + 48) / 48 * 100, 0, 100);
}

function refreshMeters() {
  $('#meter-left').style.setProperty('--level', `${meterPercent(meterLeft, meterLeftData)}%`);
  $('#meter-right').style.setProperty('--level', `${meterPercent(meterRight, meterRightData)}%`);
}

function configureSpectrumBands() {
  const binCount = meterLeftFrequencyData?.length || 0;
  if (!audioCtx || !binCount) {
    spectrumBandBins = [];
    spectrumBandSampleRate = 0;
    spectrumBandBinCount = 0;
    return;
  }
  const nyquist = audioCtx.sampleRate / 2;
  const lowFrequency = 50;
  const highFrequency = Math.min(16000, nyquist * .92);
  spectrumBandBins = Array.from({ length: spectrumBarCount }, (_, index) => {
    const lowRatio = index / spectrumBarCount;
    const highRatio = (index + 1) / spectrumBarCount;
    const bandLow = lowFrequency * Math.pow(highFrequency / lowFrequency, lowRatio);
    const bandHigh = lowFrequency * Math.pow(highFrequency / lowFrequency, highRatio);
    const firstBin = clamp(Math.floor(bandLow / nyquist * binCount), 1, binCount - 1);
    const lastBin = clamp(Math.ceil(bandHigh / nyquist * binCount), firstBin, binCount - 1);
    return [firstBin, lastBin];
  });
  spectrumBandSampleRate = audioCtx.sampleRate;
  spectrumBandBinCount = binCount;
}

function sampleSpectrum(deltaSeconds = 1 / 60, timestamp = performance.now()) {
  const canRead = meterLeft && meterRight && meterLeftFrequencyData && meterRightFrequencyData
    && audioCtx?.state === 'running';
  if (canRead) {
    meterLeft.getByteFrequencyData(meterLeftFrequencyData);
    meterRight.getByteFrequencyData(meterRightFrequencyData);
  }

  const binCount = meterLeftFrequencyData?.length || 0;
  if (canRead && (
    spectrumBandBins.length !== spectrumBarCount
    || spectrumBandSampleRate !== audioCtx.sampleRate
    || spectrumBandBinCount !== binCount
  )) configureSpectrumBands();

  const dt = clamp(deltaSeconds, 1 / 500, .05);
  let peak = 0;
  let bass = 0;
  let mid = 0;
  let high = 0;
  let bassCount = 0;
  let midCount = 0;
  let highCount = 0;

  for (let index = 0; index < spectrumBarCount; index++) {
    let target = 0;
    if (canRead && binCount && spectrumBandBins[index]) {
      const [firstBin, lastBin] = spectrumBandBins[index];
      let total = 0;
      for (let bin = firstBin; bin <= lastBin; bin++) {
        total += (meterLeftFrequencyData[bin] + meterRightFrequencyData[bin]) / 510;
      }
      const average = total / Math.max(1, lastBin - firstBin + 1);
      target = Math.pow(clamp((average - .025) / .82, 0, 1), .72);
    }
    spectrumTargets[index] = target;
    const current = spectrumLevels[index];
    const timeConstant = target > current ? .018 : .14;
    const response = 1 - Math.exp(-dt / timeConstant);
    spectrumLevels[index] = current + (target - current) * response;
    if (spectrumLevels[index] < .001) spectrumLevels[index] = 0;

    const level = spectrumLevels[index];
    if (level >= spectrumPeakLevels[index]) {
      spectrumPeakLevels[index] = level;
      spectrumPeakHoldUntil[index] = timestamp + 90;
    } else if (timestamp > spectrumPeakHoldUntil[index]) {
      spectrumPeakLevels[index] = Math.max(level, spectrumPeakLevels[index] - dt * .58);
    }
    peak = Math.max(peak, level);
    if (index < spectrumBarCount * .3) {
      bass += level;
      bassCount++;
    } else if (index < spectrumBarCount * .7) {
      mid += level;
      midCount++;
    } else {
      high += level;
      highCount++;
    }
  }

  spectrumPeak = peak;
  return {
    peak,
    bass: bass / Math.max(1, bassCount),
    mid: mid / Math.max(1, midCount),
    high: high / Math.max(1, highCount)
  };
}

function drawLeafBlade(context, x, baseY, halfWidth, height, lean, alpha) {
  const tipX = x + lean;
  const tipY = baseY - height;
  context.save();
  context.globalAlpha = alpha;
  context.beginPath();
  context.moveTo(x, baseY);
  context.bezierCurveTo(
    x - halfWidth,
    baseY - height * .28,
    tipX - halfWidth * .72,
    tipY + height * .18,
    tipX,
    tipY
  );
  context.bezierCurveTo(
    tipX + halfWidth * .72,
    tipY + height * .18,
    x + halfWidth,
    baseY - height * .28,
    x,
    baseY
  );
  context.fill();
  context.globalAlpha = alpha * .72;
  context.beginPath();
  context.moveTo(x, baseY);
  context.lineTo(tipX, tipY);
  context.stroke();
  context.restore();
}

function drawCannabisLeaf(context, width, height) {
  const centreX = width * .8;
  const centreY = height * .96;
  const scale = clamp(width / 1350, .9, 1.35);
  const alpha = .09;
  context.save();
  context.translate(centreX, centreY);
  context.fillStyle = '#71a76a';
  context.strokeStyle = '#9ccf78';
  context.lineWidth = .8;
  cannabisLeafBlades.forEach(blade => {
    context.save();
    context.rotate(blade.angle);
    drawLeafBlade(context, 0, 0, height * blade.width * scale, height * blade.length * scale, 0, alpha);
    context.restore();
  });
  context.globalAlpha = alpha * .78;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, height * .13);
  context.stroke();
  context.restore();
}

function resizeSpectrumSurface() {
  if (!spectrumCanvas || !spectrumContext) return false;
  const width = Math.floor(spectrumCanvas.clientWidth);
  const height = Math.floor(spectrumCanvas.clientHeight);
  if (!width || !height) return false;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const renderWidth = Math.round(width * pixelRatio);
  const renderHeight = Math.round(height * pixelRatio);
  if (spectrumCanvas.width !== renderWidth || spectrumCanvas.height !== renderHeight) {
    spectrumCanvas.width = renderWidth;
    spectrumCanvas.height = renderHeight;
  }
  spectrumWidth = width;
  spectrumHeight = height;
  spectrumPixelRatio = pixelRatio;
  spectrumContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  spectrumWatermarkCanvas ||= document.createElement('canvas');
  spectrumWatermarkCanvas.width = renderWidth;
  spectrumWatermarkCanvas.height = renderHeight;
  const watermarkContext = spectrumWatermarkCanvas.getContext('2d');
  watermarkContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  watermarkContext.clearRect(0, 0, width, height);
  drawCannabisLeaf(watermarkContext, width, height);

  const top = 5;
  const baseline = height - 9;
  spectrumBarGradient = spectrumContext.createLinearGradient(0, baseline, 0, top);
  spectrumBarGradient.addColorStop(0, '#c9fb57');
  spectrumBarGradient.addColorStop(.72, '#5ee3d4');
  spectrumBarGradient.addColorStop(.92, '#5ee3d4');
  spectrumBarGradient.addColorStop(1, '#ff7657');
  return true;
}

function initSpectrumSurface() {
  if (spectrumCanvas) return true;
  spectrumCanvas = $('#dub-spectrum-canvas');
  spectrumPanel = spectrumCanvas?.closest('.dub-spectrum') || null;
  spectrumStateLabel = $('#spectrum-state span');
  spectrumContext = spectrumCanvas?.getContext('2d') || null;
  if (!spectrumCanvas || !spectrumPanel || !spectrumContext) return false;
  resizeSpectrumSurface();
  if (window.ResizeObserver) {
    spectrumResizeObserver = new ResizeObserver(resizeSpectrumSurface);
    spectrumResizeObserver.observe(spectrumCanvas);
  }
  if (window.IntersectionObserver) {
    spectrumIntersectionObserver = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible === spectrumVisible) return;
      spectrumVisible = visible;
      spectrumLastAnimationTimestamp = 0;
      spectrumFpsWindowStart = 0;
      spectrumFpsWindowFrames = 0;
    }, { threshold: .01 });
    spectrumIntersectionObserver.observe(spectrumPanel);
  }
  return true;
}

function updateSpectrumFrameRate(timestamp) {
  if (!spectrumFpsWindowStart) spectrumFpsWindowStart = timestamp;
  spectrumFpsWindowFrames++;
  const elapsed = timestamp - spectrumFpsWindowStart;
  if (elapsed < 500) return;
  spectrumFps = spectrumFpsWindowFrames * 1000 / elapsed;
  spectrumFpsWindowStart = timestamp;
  spectrumFpsWindowFrames = 0;
  if (spectrumStateLabel) {
    spectrumStateLabel.title = `${Math.round(spectrumFps)} measured frames per second`;
  }
}

function updateSpectrumState(state) {
  const label = `${state} · DISPLAY SYNC`;
  if (label !== spectrumCurrentState && spectrumStateLabel) {
    spectrumStateLabel.textContent = label;
    spectrumCurrentState = label;
  }
  const isLive = state === 'LIVE';
  if (spectrumPanel && spectrumPanel.classList.contains('live') !== isLive) {
    spectrumPanel.classList.toggle('live', isLive);
  }
}

function renderSpectrumNow(timestamp = performance.now(), deltaSeconds = 1 / 60) {
  if (!initSpectrumSurface()) return false;
  if (!spectrumWidth || !spectrumHeight) resizeSpectrumSurface();
  if (!spectrumWidth || !spectrumHeight) return false;
  const renderStarted = performance.now();
  const context = spectrumContext;
  const width = spectrumWidth;
  const height = spectrumHeight;
  const top = 5;
  const baseline = height - 9;
  const usableHeight = baseline - top;
  context.setTransform(spectrumPixelRatio, 0, 0, spectrumPixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const sample = sampleSpectrum(deltaSeconds, timestamp);
  context.lineWidth = 1;
  context.strokeStyle = '#24403766';
  for (let row = 1; row < 4; row++) {
    const y = height * row / 4;
    context.beginPath();
    context.moveTo(0, y + .5);
    context.lineTo(width, y + .5);
    context.stroke();
  }
  for (let column = 1; column < 6; column++) {
    const x = width * column / 6;
    context.beginPath();
    context.moveTo(x + .5, 0);
    context.lineTo(x + .5, height);
    context.stroke();
  }

  if (spectrumWatermarkCanvas) {
    context.drawImage(
      spectrumWatermarkCanvas,
      0,
      0,
      spectrumWatermarkCanvas.width,
      spectrumWatermarkCanvas.height,
      0,
      0,
      width,
      height
    );
  }

  const step = (width - 10) / spectrumBarCount;
  const barWidth = Math.max(2, step * .62);
  context.fillStyle = spectrumBarGradient || '#c9fb57';
  context.beginPath();
  for (let index = 0; index < spectrumBarCount; index++) {
    const level = spectrumLevels[index];
    if (level < .003) continue;
    const x = 5 + step * index + (step - barWidth) / 2;
    const barHeight = Math.max(1, level * usableHeight);
    context.rect(x, baseline - barHeight, barWidth, barHeight);
  }
  context.fill();

  context.fillStyle = '#07100bcc';
  for (let y = baseline - 5; y > top; y -= 6) context.fillRect(0, y, width, 1);

  context.fillStyle = '#8df4e8';
  context.beginPath();
  for (let index = 0; index < spectrumBarCount; index++) {
    const peakLevel = spectrumPeakLevels[index];
    if (peakLevel < .01) continue;
    const x = 5 + step * index + (step - barWidth) / 2;
    const peakY = baseline - peakLevel * usableHeight;
    context.rect(x, peakY, barWidth, 1.5);
  }
  context.fill();

  context.fillStyle = '#ff7657';
  for (let index = 0; index < spectrumBarCount; index++) {
    if (spectrumPeakLevels[index] < .93) continue;
    const x = 5 + step * index + (step - barWidth) / 2;
    const peakY = baseline - spectrumPeakLevels[index] * usableHeight;
    context.fillRect(x, peakY, barWidth, 2);
  }

  context.strokeStyle = '#79a89488';
  context.beginPath();
  context.moveTo(0, baseline + .5);
  context.lineTo(width, baseline + .5);
  context.stroke();

  const state = !audioCtx
    ? 'STANDBY'
    : audioCtx.state !== 'running'
      ? 'PAUSED'
      : sample.peak > .025 ? 'LIVE' : 'QUIET';
  updateSpectrumFrameRate(timestamp);
  updateSpectrumState(state);
  spectrumFrameCount++;
  const renderDuration = performance.now() - renderStarted;
  spectrumRenderAverageMs = spectrumRenderAverageMs
    ? spectrumRenderAverageMs * .94 + renderDuration * .06
    : renderDuration;
  spectrumRenderMaxMs = Math.max(renderDuration, spectrumRenderMaxMs * .997);
  return true;
}

function animateSpectrum(timestamp) {
  requestAnimationFrame(animateSpectrum);
  pollXInput(timestamp);
  spectrumRafFrameCount++;
  if (document.hidden || !spectrumVisible) {
    spectrumLastAnimationTimestamp = 0;
    return;
  }
  const deltaSeconds = spectrumLastAnimationTimestamp
    ? clamp((timestamp - spectrumLastAnimationTimestamp) / 1000, 1 / 500, .05)
    : 1 / 60;
  spectrumLastAnimationTimestamp = timestamp;
  renderSpectrumNow(timestamp, deltaSeconds);
}

function gamepadButton(button) {
  return {
    pressed: Boolean(button?.pressed || Number(button?.value) > .5),
    value: clamp(Number(button?.value) || (button?.pressed ? 1 : 0), 0, 1)
  };
}

function gamepadAxis(value) {
  const input = clamp(Number(value) || 0, -1, 1);
  const magnitude = Math.abs(input);
  if (magnitude < .18) return 0;
  return Math.sign(input) * (magnitude - .18) / .82;
}

function setXInputUi(gamepad) {
  const state = $('#gamepad-state');
  if (!state) return;
  state.classList.toggle('online', Boolean(gamepad));
  state.querySelector('span').textContent = gamepad ? 'READY' : navigator.getGamepads ? 'OFFLINE' : 'UNAVAILABLE';
  $('#gamepad-name').textContent = gamepad
    ? String(gamepad.id || 'XInput controller').replace(/\s+/g, ' ').trim().slice(0, 100)
    : navigator.getGamepads
      ? 'Connect an Xbox-compatible controller, then press any button.'
      : 'Gamepad support is unavailable in this runtime.';
}

function releaseXInputHolds() {
  if (xinputState.buildActive) dropBuild();
  if (xinputState.buttons[4]) stopSiren();
  if (xinputState.buttons[5]) releaseThrow();
  xinputState.buildActive = false;
  xinputState.buttons.fill(false);
}

function disconnectXInput() {
  if (!xinputState.connected) return;
  releaseXInputHolds();
  xinputState.index = null;
  xinputState.id = '';
  xinputState.connected = false;
  xinputState.lastTimestamp = 0;
  setXInputUi(null);
}

function triggerGamepadPad(index) {
  const pad = $$('.pad')[index];
  if (pad) pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 50 + index }));
}

function applyXInputSnapshot(gamepad, timestamp = performance.now()) {
  if (!gamepad) {
    disconnectXInput();
    return false;
  }
  if (!xinputState.connected || xinputState.index !== gamepad.index || xinputState.id !== gamepad.id) {
    xinputState.index = gamepad.index;
    xinputState.id = gamepad.id || 'XInput controller';
    xinputState.connected = true;
    xinputState.buttons.fill(false);
    xinputState.lastTimestamp = timestamp;
    setXInputUi(gamepad);
  }

  const delta = clamp((timestamp - xinputState.lastTimestamp) / 1000, 0, .05);
  const buttons = Array.from({ length: 16 }, (_, index) => gamepadButton(gamepad.buttons?.[index]));
  const pressedNow = index => buttons[index].pressed;
  const pressedBefore = index => Boolean(xinputState.buttons[index]);
  const pressedEdge = index => pressedNow(index) && !pressedBefore(index);

  if (pressedNow(4) && !pressedBefore(4)) fireSiren();
  if (!pressedNow(4) && pressedBefore(4)) stopSiren();
  if (pressedNow(5) && !pressedBefore(5)) {
    $('#throw').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 45 }));
  }
  if (!pressedNow(5) && pressedBefore(5)) {
    $('#throw').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 45 }));
  }

  const buildAmount = buttons[7].value;
  if (buildAmount > .025) {
    setControl('build', buildAmount * 100, false, true);
    xinputState.buildActive = true;
  } else if (xinputState.buildActive) {
    dropBuild();
    xinputState.buildActive = false;
  }

  if (delta > 0) {
    const filterMotion = -gamepadAxis(gamepad.axes?.[1]);
    const echoMotion = -gamepadAxis(gamepad.axes?.[3]);
    if (filterMotion) setControl('filter', values.filter + filterMotion * delta * 68, false, true);
    if (echoMotion) setControl('delay', values.delay + echoMotion * delta * 68, false, true);
  }

  [0, 1, 2, 3].forEach((buttonIndex, padIndex) => {
    if (pressedEdge(buttonIndex)) triggerGamepadPad(padIndex);
  });
  [[12, 4], [15, 5], [13, 6], [14, 7]].forEach(([buttonIndex, padIndex]) => {
    if (pressedEdge(buttonIndex)) triggerGamepadPad(padIndex);
  });

  if (pressedEdge(9)) playing ? stopPlayback() : startPlayback();
  if (pressedEdge(8)) {
    stopPlayback(true);
    stopDeckB(true);
    status('Stopped from XInput');
  }

  xinputState.buttons = buttons.map(button => button.pressed);
  xinputState.lastTimestamp = timestamp;
  xinputState.frames++;
  return true;
}

function pollXInput(timestamp) {
  if (!navigator.getGamepads) return;
  const gamepads = navigator.getGamepads();
  let gamepad = xinputState.index !== null ? gamepads[xinputState.index] : null;
  if (!gamepad) {
    gamepad = [...gamepads].find(candidate => candidate && (candidate.mapping === 'standard' || /xbox|xinput/i.test(candidate.id)));
  }
  if (gamepad) applyXInputSnapshot(gamepad, timestamp);
  else disconnectXInput();
}

window.addEventListener('gamepadconnected', event => {
  applyXInputSnapshot(event.gamepad);
  status('XInput controller ready · mapping is listed in Settings');
});
window.addEventListener('gamepaddisconnected', event => {
  if (xinputState.index === event.gamepad.index) {
    disconnectXInput();
    status('XInput controller disconnected');
  }
});

function setCrossfader(position) {
  const value = clamp(position, -1, 1);
  if (!deckAGain || !deckBGain || !audioCtx) return;
  const angle = (value + 1) * Math.PI / 4;
  deckAGain.gain.setTargetAtTime(Math.cos(angle), audioCtx.currentTime, .012);
  deckBGain.gain.setTargetAtTime(Math.sin(angle), audioCtx.currentTime, .012);
}

function applyAudioState(fast = false) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const smoothing = fast ? .004 : .014;
  const build = values.build / 100;
  const filterNormal = values.filter / 100;
  const baseFilter = fxEnabled.filter ? 80 * Math.pow(250, filterNormal) : 20000;
  const buildFilter = fxEnabled.filter ? 20000 * Math.pow(340 / 20000, Math.pow(build, .9)) : 20000;
  const effectiveFilter = allBypassed ? 20000 : Math.min(baseFilter, buildFilter);
  const baseReverb = fxEnabled.reverb ? values.reverb / 100 * .55 : 0;
  const buildReverb = fxEnabled.reverb ? Math.pow(build, 1.15) * .72 : 0;
  const effectiveReverb = allBypassed ? 0 : Math.max(baseReverb, buildReverb);
  const echoAmount = fxEnabled.delay && !allBypassed ? values.delay / 100 : 0;

  filterNode.frequency.setTargetAtTime(effectiveFilter, now, smoothing);
  filterNode.Q.setTargetAtTime(fxEnabled.filter && !allBypassed ? .7 + values.filterResonance / 100 * 10 : .0001, now, smoothing);
  crushNode.curve = driveCurve(fxEnabled.crush && !allBypassed ? values.crush / 100 : 0);
  dryGain.gain.setTargetAtTime(allBypassed ? 0 : 1, now, smoothing);
  trueBypassGain.gain.setTargetAtTime(allBypassed ? 1 : 0, now, smoothing);
  delayNode.delayTime.setTargetAtTime(values.delayTime / 1000, now, smoothing);
  delayToneNode.frequency.setTargetAtTime(700 * Math.pow(16, values.delayTone / 100), now, smoothing);
  delayWet.gain.setTargetAtTime(echoAmount * .6, now, smoothing);
  delayFeedback.gain.setTargetAtTime(echoAmount > .001 ? values.delayFeedback / 100 * .86 : 0, now, smoothing);
  reverbWet.gain.setTargetAtTime(effectiveReverb, now, smoothing);
}

function scheduleReverbRefresh() {
  if (!audioCtx) return;
  clearTimeout(reverbTimer);
  reverbTimer = setTimeout(() => {
    const seconds = 1.05 + values.reverbDecay / 100 * 3.2;
    const decay = 4.8 - values.reverbDecay / 100 * 2.2;
    reverbNode.buffer = impulse(seconds, decay);
  }, 120);
}

function makeDefaultLoop() {
  const sampleRate = audioCtx.sampleRate;
  const duration = 8;
  const result = audioCtx.createBuffer(2, sampleRate * duration, sampleRate);
  const left = result.getChannelData(0);
  const right = result.getChannelData(1);
  const beat = 60 / 86;
  for (let i = 0; i < left.length; i++) {
    const time = i / sampleRate;
    const step = Math.floor(time / beat);
    const phase = time % beat;
    let sample = 0;
    if (step % 4 === 0) sample += Math.sin(2 * Math.PI * (105 - 65 * Math.min(phase / .18, 1)) * time) * Math.exp(-phase * 24) * .68;
    if (step % 4 === 2) sample += (Math.random() * 2 - 1) * Math.exp(-phase * 42) * .25;
    if (step % 8 === 4) sample += Math.sin(2 * Math.PI * 58 * time) * Math.exp(-phase * 8) * .32;
    if (step % 4 === 1 || step % 4 === 3) sample += (Math.random() * 2 - 1) * Math.exp(-phase * 80) * .035;
    const chord = [0, 0, 3, 7, 0, 0, 5, 7][step % 8];
    sample += Math.sin(2 * Math.PI * (110 * Math.pow(2, chord / 12)) * time) * Math.exp(-phase * 3.2) * .075;
    left[i] = sample;
    right[i] = sample * .96;
  }
  return result;
}

function builtInBeats() {
  const beat = 60 / 86;
  return Array.from({ length: Math.ceil(8 / beat) }, (_, index) => index * beat);
}

function ensureBuffer() {
  initAudio();
  if (buffer) return;
  buffer = makeDefaultLoop();
  currentAnalysis = { bpm: 86, confidence: 1, beats: builtInBeats() };
  currentBpm = 86;
  renderWaveform(buffer);
  renderBeatGrid(currentAnalysis.beats, buffer.duration);
  $('#duration').textContent = formatTime(buffer.duration);
  $('#wave-label').textContent = 'BUILT-IN GROOVE · DRY BY DEFAULT';
}

function renderIdleWaveform() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 150; index++) {
    const bar = document.createElement('span');
    const pulse = index % 26 < 4 ? .76 : .24;
    const texture = (Math.sin(index * 1.91) + 1) * .11;
    bar.style.setProperty('--peak', String(Math.min(1, pulse + texture)));
    fragment.appendChild(bar);
  }
  $('#wave-bars').replaceChildren(fragment);
  renderBeatGrid(builtInBeats(), 8);
}

function renderWaveform(decoded) {
  const bars = 170;
  const channel = decoded.getChannelData(0);
  const samplesPerBar = channel.length / bars;
  const fragment = document.createDocumentFragment();
  let globalPeak = .001;
  const peaks = [];
  for (let index = 0; index < bars; index++) {
    const start = Math.floor(index * samplesPerBar);
    const end = Math.min(channel.length, Math.floor((index + 1) * samplesPerBar));
    const stride = Math.max(1, Math.floor((end - start) / 80));
    let peak = 0;
    for (let sample = start; sample < end; sample += stride) peak = Math.max(peak, Math.abs(channel[sample]));
    peaks.push(peak);
    globalPeak = Math.max(globalPeak, peak);
  }
  peaks.forEach(peak => {
    const bar = document.createElement('span');
    bar.style.setProperty('--peak', String(Math.max(.05, Math.pow(peak / globalPeak, .72))));
    fragment.appendChild(bar);
  });
  $('#wave-bars').replaceChildren(fragment);
  $('#waveform').classList.add('has-audio');
}

function renderBeatGrid(beats, duration) {
  const grid = $('#beat-grid');
  const fragment = document.createDocumentFragment();
  const safeBeats = Array.isArray(beats) ? beats : [];
  const stride = Math.max(1, Math.ceil(safeBeats.length / 400));
  safeBeats.forEach((beat, index) => {
    if (index % stride !== 0 || beat < 0 || beat > duration) return;
    const marker = document.createElement('i');
    marker.style.left = `${beat / duration * 100}%`;
    if (index % 4 === 0) marker.className = 'downbeat';
    fragment.appendChild(marker);
  });
  grid.replaceChildren(fragment);
}

function analyzeBeats(decoded) {
  const sampleRate = decoded.sampleRate;
  const hop = Math.max(512, Math.round(sampleRate / 48));
  const frameRate = sampleRate / hop;
  const length = Math.min(decoded.length, Math.floor(sampleRate * 240));
  const channels = Math.min(2, decoded.numberOfChannels);
  const channelData = Array.from({ length: channels }, (_, index) => decoded.getChannelData(index));
  const frameCount = Math.floor(length / hop);
  const energy = new Float32Array(frameCount);
  const onset = new Float32Array(frameCount);
  let peakEnergy = 0;

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    const end = Math.min(length, start + hop);
    const stride = Math.max(1, Math.floor(hop / 96));
    let sum = 0;
    let count = 0;
    for (let sample = start; sample < end; sample += stride) {
      let mixed = 0;
      for (let channel = 0; channel < channels; channel++) mixed += channelData[channel][sample] || 0;
      mixed /= channels;
      sum += mixed * mixed;
      count++;
    }
    energy[frame] = Math.sqrt(sum / Math.max(1, count));
    peakEnergy = Math.max(peakEnergy, energy[frame]);
  }

  if (peakEnergy < .0005) return { bpm: null, confidence: 0, beats: [] };

  let peakOnset = .00001;
  let onsetTotal = 0;
  for (let frame = 1; frame < frameCount; frame++) {
    let history = 0;
    const historyStart = Math.max(0, frame - 12);
    for (let previous = historyStart; previous < frame; previous++) history += energy[previous];
    const average = history / Math.max(1, frame - historyStart);
    onset[frame] = Math.max(0, energy[frame] - average * 1.04);
    peakOnset = Math.max(peakOnset, onset[frame]);
    onsetTotal += onset[frame];
  }
  if (peakOnset < .00005 || onsetTotal < peakOnset * 2.2) return { bpm: null, confidence: 0, beats: [] };
  for (let frame = 0; frame < frameCount; frame++) onset[frame] /= peakOnset;

  const candidates = [];
  const minLag = Math.floor(frameRate * 60 / 180);
  const maxLag = Math.ceil(frameRate * 60 / 65);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let frame = lag; frame < frameCount; frame++) score += onset[frame] * onset[frame - lag];
    candidates.push({ lag, score: score / Math.max(1, frameCount - lag) });
  }
  candidates.sort((a, b) => b.score - a.score);
  let best = candidates[0] || { lag: Math.round(frameRate * 60 / 100), score: 0 };
  let bpm = frameRate * 60 / best.lag;

  if (bpm < 92) {
    const doubleLag = best.lag / 2;
    const doubleCandidate = candidates.find(candidate => Math.abs(candidate.lag - doubleLag) < 1.1);
    if (doubleCandidate && doubleCandidate.score > best.score * .78) {
      best = doubleCandidate;
      bpm = frameRate * 60 / best.lag;
    }
  }

  const averageScore = candidates.reduce((sum, candidate) => sum + candidate.score, 0) / Math.max(1, candidates.length);
  const confidence = clamp((best.score / Math.max(.00001, averageScore) - 1) / 1.6, 0, 1);
  const period = frameRate * 60 / bpm;
  const phaseSteps = Math.max(1, Math.round(period));
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let phase = 0; phase < phaseSteps; phase++) {
    let score = 0;
    for (let frame = phase; frame < frameCount; frame += period) {
      const centre = Math.round(frame);
      score += Math.max(onset[centre - 1] || 0, onset[centre] || 0, onset[centre + 1] || 0);
    }
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = phase;
    }
  }

  const beatSeconds = 60 / bpm;
  const firstBeat = bestPhase / frameRate;
  const beats = [];
  for (let time = firstBeat; time < decoded.duration; time += beatSeconds) beats.push(time);
  return { bpm: Math.round(bpm * 10) / 10, confidence, beats };
}

function updateAnalysis(result, trackId) {
  if (trackId !== currentTrack.id) return;
  currentAnalysis = result;
  const hasBeat = Number.isFinite(result.bpm) && result.bpm > 0;
  currentBpm = hasBeat ? result.bpm : null;
  currentTrack.bpm = currentBpm;
  currentTrack.confidence = result.confidence;
  renderBeatGrid(result.beats, buffer.duration);
  const confident = hasBeat && result.confidence >= .28;
  $('#analysis-badge').textContent = !hasBeat ? 'NO CLEAR BEAT' : confident ? `${Math.round(result.bpm)} BPM · GRID` : `~${Math.round(result.bpm)} BPM · CHECK`;
  $('#analysis-badge').classList.toggle('uncertain', !confident);
  setTrackDetails(!hasBeat
    ? [currentTrack.artist, currentTrack.source, 'no clear beat', 'waveform ready']
    : [currentTrack.artist, currentTrack.source, `${confident ? Math.round(result.bpm) : `~${Math.round(result.bpm)}`} BPM`, confident ? 'beat grid ready' : 'analysis uncertain']);
  if (confident && echoPreset !== 'custom') applyEchoPreset(echoPreset, false);

  const entry = library.find(track => track.id === trackId);
  if (entry) {
    entry.bpm = currentBpm;
    entry.confidence = result.confidence;
    entry.duration = buffer.duration;
    writeStore('dubstation:library:v2', library);
    renderLibrary();
  }
  status(!hasBeat ? 'Waveform ready · no reliable beat detected' : confident ? `Beat analysis ready · ${Math.round(result.bpm)} BPM` : `Approximate beat found · ${Math.round(result.bpm)} BPM`);
}

function arrayBufferFromIpc(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (bytes && Array.isArray(bytes.data)) return Uint8Array.from(bytes.data).buffer;
  throw new Error('No audio data returned');
}

async function decodeAudio(arrayBuffer) {
  initAudio();
  return audioCtx.decodeAudioData(arrayBuffer.slice(0));
}

function rememberTrack(meta, duration) {
  if (!meta.path) return;
  const id = makeTrackId(meta.path);
  const now = Date.now();
  const existing = library.find(track => track.id === id);
  const next = {
    id,
    name: meta.name,
    title: titleFromMeta(meta, existing),
    artist: artistFromMeta(meta, existing),
    path: meta.path,
    location: locationFromPath(meta.path),
    size: meta.size || existing?.size || 0,
    modified: meta.modified || existing?.modified || 0,
    duration,
    bpm: existing?.bpm || null,
    confidence: existing?.confidence || 0,
    addedAt: existing?.addedAt || now,
    lastOpened: now,
    missing: false
  };
  library = [next, ...library.filter(track => track.id !== id)].slice(0, 500);
  writeStore('dubstation:library:v2', library);
  renderLibrary();
  return next;
}

function registerAudioBatch(metas) {
  const now = Date.now();
  const unique = [];
  const seen = new Set();
  metas.forEach(meta => {
    if (!meta?.path) return;
    const id = makeTrackId(meta.path);
    if (seen.has(id)) return;
    seen.add(id);
    const existing = library.find(track => track.id === id);
    unique.push({
      id,
      name: meta.name,
      title: titleFromMeta(meta, existing),
      artist: artistFromMeta(meta, existing),
      path: meta.path,
      location: locationFromPath(meta.path),
      size: meta.size || existing?.size || 0,
      modified: meta.modified || existing?.modified || 0,
      duration: existing?.duration || 0,
      bpm: existing?.bpm || null,
      confidence: existing?.confidence || 0,
      addedAt: existing?.addedAt || now - unique.length,
      lastOpened: existing?.lastOpened || 0,
      missing: false
    });
  });
  if (!unique.length) return [];
  const ids = new Set(unique.map(track => track.id));
  library = [...unique, ...library.filter(track => !ids.has(track.id))].slice(0, 500);
  writeStore('dubstation:library:v2', library);
  renderLibrary();
  return unique;
}

async function importAudioBatch(metas, target = 'auto') {
  const tracks = registerAudioBatch(metas);
  if (!tracks.length) {
    status('No supported audio files were found.');
    return;
  }

  const first = tracks[0];
  let destination = 'library';
  if (target === 'b') {
    const loaded = await loadPathToDeckB(first.path, { replaceLoaded: true });
    if (loaded) destination = 'Deck B';
  } else if (playing) {
    if (!deckB.buffer && !deckB.playing) {
      const loaded = await loadPathToDeckB(first.path);
      if (loaded) destination = 'Deck B';
    }
  } else {
    const loaded = await loadPath(first.path);
    if (loaded) destination = 'Deck A';
  }

  const queued = destination === 'library' ? tracks.length : tracks.length - 1;
  if (tracks.length === 1 && destination === 'library') status(`Added ${first.title} to the library · loaded decks were left untouched`);
  else if (tracks.length > 1) status(`Added ${tracks.length} tracks · first to ${destination}${queued ? ` · ${queued} in library` : ''}`);
}

function activateBuffer(decoded, meta, remember = true) {
  stopPlayback(true);
  buffer = decoded;
  const entry = remember ? rememberTrack(meta, decoded.duration) : null;
  currentTrack = {
    id: entry?.id || meta.id || `session-${Date.now()}`,
    title: titleFromMeta(meta, entry),
    artist: artistFromMeta(meta, entry),
    name: meta.name,
    path: meta.path || '',
    source: meta.path ? 'Local audio' : 'Session audio',
    duration: decoded.duration,
    bpm: entry?.bpm || null
  };
  currentBpm = entry?.bpm || 100;
  currentAnalysis = { bpm: currentBpm, confidence: 0, beats: [] };

  setMarqueeText($('#track-title'), currentTrack.title);
  setTrackDetails([currentTrack.artist, currentTrack.source, 'analysing beat', 'loop ready']);
  $('#duration').textContent = formatTime(decoded.duration);
  $('#source-kind').textContent = meta.path ? 'LOCAL FILE' : 'THIS SESSION';
  $('#reveal-track').hidden = !meta.path;
  $('#analysis-badge').textContent = 'ANALYSING…';
  $('#analysis-badge').classList.add('uncertain');
  $('#wave-label').textContent = 'AUDIO LOADED · PRESS PLAY';
  renderWaveform(decoded);
  renderBeatGrid([], decoded.duration);
  renderLibrary();
  refreshTransport();
  status(`Loaded ${currentTrack.title} · analysing waveform and beat`);

  const trackId = currentTrack.id;
  setTimeout(() => {
    try {
      updateAnalysis(analyzeBeats(decoded), trackId);
    } catch {
      if (trackId !== currentTrack.id) return;
      $('#analysis-badge').textContent = 'NO BEAT GRID';
      status('Audio loaded · beat analysis was inconclusive');
    }
  }, 30);
}

async function loadPath(filePath, options = {}) {
  const loadToken = ++deckALoadToken;
  if (playing && options.replacePlaying !== true) {
    if (deckB.buffer || deckB.playing) {
      status('Deck A is live and Deck B is already prepared · the track remains safely in the library');
      return false;
    }
    status('Deck A stays live · loading the new track on Deck B');
    return loadPathToDeckB(filePath);
  }
  if (!bridge?.readAudio) {
    status('This saved location can only be reopened in the desktop app.');
    return false;
  }
  status('Opening local audio…');
  try {
    const result = await bridge.readAudio(filePath);
    const decoded = await decodeAudio(arrayBufferFromIpc(result.bytes));
    if (loadToken !== deckALoadToken) return false;
    if (playing && options.replacePlaying !== true) {
      registerAudioBatch([result]);
      status('Deck A started while the file was loading · added it to the library without replacing audio');
      return false;
    }
    activateBuffer(decoded, result, options.remember !== false);
    return true;
  } catch (error) {
    const entry = library.find(track => track.path === filePath);
    if (entry) {
      entry.missing = true;
      writeStore('dubstation:library:v2', library);
      renderLibrary();
    }
    status(`Could not open ${titleFromName(filePath)} · file may have moved`);
    return false;
  }
}

function renderDeckB() {
  const title = deckB.track?.title || 'No track loaded';
  const bpm = deckB.analysis?.bpm || deckB.track?.bpm;
  const crossfade = Number($('#crossfader').value);
  $('#deck-b-state').textContent = deckB.playing ? (crossfade >= 0 ? 'ON AIR' : 'PLAYING') : deckB.buffer ? 'LOADED' : 'NEXT TUNE';
  setMarqueeText($('#deck-b-title'), title);
  $('#deck-b-meta').textContent = deckB.track
    ? `${deckB.track.artist ? `${deckB.track.artist} · ` : ''}${bpm ? `${Math.round(bpm)} BPM · ` : 'ANALYSING · '}${locationFromPath(deckB.track.path)}`
    : 'Choose B beside a library track';
  $('#deck-b-play').disabled = !deckB.buffer;
  $('#deck-b-take').disabled = !deckB.buffer;
  $('#crossfader').disabled = !deckB.buffer;
  $('#deck-b-play').textContent = deckB.playing ? 'Ⅱ' : '▶';
  $('#deck-b-time').textContent = deckB.buffer
    ? `${formatShortTime(deckBPosition())} / ${formatShortTime(deckB.buffer.duration)}`
    : '— / —';
}

function deckBPosition() {
  if (!deckB.playing || !audioCtx || !deckB.buffer) return deckB.pauseAt;
  const position = deckB.pauseAt + (audioCtx.currentTime - deckB.startedAt);
  return loopEnabled ? position % deckB.buffer.duration : Math.min(deckB.buffer.duration, position);
}

function stopDeckB(reset = false) {
  if (deckB.playing && deckB.source) {
    deckB.pauseAt = deckBPosition();
    deckB.source.onended = null;
    try {
      deckB.source.stop();
    } catch {
      // Already stopped.
    }
  }
  deckB.source = null;
  deckB.playing = false;
  if (reset) deckB.pauseAt = 0;
  renderDeckB();
}

function startDeckB() {
  if (!deckB.buffer || deckB.playing) return;
  initAudio();
  audioCtx.resume();
  deckB.source = audioCtx.createBufferSource();
  deckB.source.buffer = deckB.buffer;
  deckB.source.loop = loopEnabled;
  deckB.source.connect(deckBGain);
  deckB.pauseAt = Math.min(deckB.pauseAt % deckB.buffer.duration, Math.max(0, deckB.buffer.duration - .001));
  deckB.startedAt = audioCtx.currentTime;
  deckB.source.start(0, deckB.pauseAt);
  deckB.source.onended = () => {
    if (!deckB.playing || loopEnabled) return;
    deckB.source = null;
    deckB.playing = false;
    deckB.pauseAt = 0;
    renderDeckB();
  };
  deckB.playing = true;
  renderDeckB();
  status(`Deck B playing · move the crossfader toward B`);
}

function clearDeckB() {
  deckBLoadToken++;
  stopDeckB(true);
  deckB.buffer = null;
  deckB.track = null;
  deckB.analysis = null;
  $('#crossfader').value = '-100';
  setCrossfader(-1);
  renderDeckB();
}

function promoteDeckB() {
  if (!deckB.buffer || !deckB.track) return;
  const promotedBuffer = deckB.buffer;
  const promotedTrack = { ...deckB.track };
  const promotedAnalysis = deckB.analysis?.bpm
    ? { ...deckB.analysis, beats: deckB.analysis.beats || [] }
    : { bpm: promotedTrack.bpm || null, confidence: 0, beats: [] };
  const promotedWasPlaying = deckB.playing;
  const promotedPosition = deckBPosition();
  const oldDeckBSource = deckB.source;

  deckALoadToken++;
  stopPlayback(true);
  buffer = promotedBuffer;
  currentTrack = {
    ...promotedTrack,
    source: promotedTrack.path ? 'Local audio' : 'Session audio'
  };
  currentAnalysis = promotedAnalysis;
  currentBpm = promotedAnalysis.bpm || promotedTrack.bpm || null;
  pauseAt = promotedPosition;
  $('#tempo').value = '0';
  $('#tempo-val').textContent = '+0.0%';

  setMarqueeText($('#track-title'), currentTrack.title);
  const hasReliableBeat = currentBpm && promotedAnalysis.confidence >= .2;
  setTrackDetails([
    currentTrack.artist,
    currentTrack.source,
    currentBpm ? `${hasReliableBeat ? '' : '~'}${Math.round(currentBpm)} BPM` : 'no clear beat',
    hasReliableBeat ? 'beat grid ready' : 'analysis available'
  ]);
  $('#duration').textContent = formatTime(buffer.duration);
  $('#source-kind').textContent = currentTrack.path ? 'LOCAL FILE' : 'THIS SESSION';
  $('#reveal-track').hidden = !currentTrack.path;
  $('#analysis-badge').textContent = currentBpm ? `${hasReliableBeat ? '' : '~'}${Math.round(currentBpm)} BPM · ${hasReliableBeat ? 'GRID' : 'CHECK'}` : 'NO CLEAR BEAT';
  $('#analysis-badge').classList.toggle('uncertain', !hasReliableBeat);
  $('#wave-label').textContent = 'AUDIO LOADED · PRESS PLAY';
  renderWaveform(buffer);
  renderBeatGrid(promotedAnalysis.beats, buffer.duration);
  renderLibrary();
  if (echoPreset !== 'custom' && currentBpm) applyEchoPreset(echoPreset, false);

  if (promotedWasPlaying) {
    startPlayback();
    $('#crossfader').value = '-100';
    setCrossfader(-1);
    setTimeout(() => {
      if (oldDeckBSource && deckB.source === oldDeckBSource) clearDeckB();
    }, 90);
  } else {
    clearDeckB();
    refreshTransport();
  }

  if (!promotedAnalysis.beats.length) {
    const trackId = currentTrack.id;
    setTimeout(() => {
      try {
        updateAnalysis(analyzeBeats(promotedBuffer), trackId);
      } catch {
        // The promoted track remains playable without a grid.
      }
    }, 30);
  }
  status(`${currentTrack.title} is now on Deck A · Deck B is ready for the next tune`);
}

async function loadPathToDeckB(filePath, options = {}) {
  const loadToken = ++deckBLoadToken;
  if (deckB.playing) {
    status('Deck B is live · pause it before replacing the queued track');
    return false;
  }
  if (deckB.buffer && !options.replaceLoaded) {
    status('Deck B is already prepared · the new track remains safely in the library');
    return false;
  }
  if (!bridge?.readAudio) {
    status('Deck B saved locations require the desktop app.');
    return false;
  }
  status('Loading Deck B…');
  try {
    const result = await bridge.readAudio(filePath);
    const decoded = await decodeAudio(arrayBufferFromIpc(result.bytes));
    if (loadToken !== deckBLoadToken) return false;
    if (deckB.playing || (deckB.buffer && !options.replaceLoaded)) {
      registerAudioBatch([result]);
      status('Deck B changed while the file was loading · added it to the library instead');
      return false;
    }
    stopDeckB(true);
    const entry = rememberTrack(result, decoded.duration);
    deckB.buffer = decoded;
    deckB.track = {
      id: entry?.id || makeTrackId(result.path),
      title: titleFromMeta(result, entry),
      artist: artistFromMeta(result, entry),
      name: result.name,
      path: result.path,
      duration: decoded.duration,
      bpm: entry?.bpm || null
    };
    deckB.analysis = entry?.bpm ? { bpm: entry.bpm, confidence: entry.confidence || 0 } : null;
    renderDeckB();
    status(`${deckB.track.title} ready on Deck B`);
    const trackId = deckB.track.id;
    setTimeout(() => {
      try {
        const resultAnalysis = analyzeBeats(decoded);
        if (deckB.track?.id !== trackId) return;
        deckB.analysis = resultAnalysis;
        deckB.track.bpm = resultAnalysis.bpm;
        const saved = library.find(track => track.id === trackId);
        if (saved) {
          saved.bpm = resultAnalysis.bpm;
          saved.confidence = resultAnalysis.confidence;
          writeStore('dubstation:library:v2', library);
          renderLibrary();
        }
        renderDeckB();
        if (Number($('#crossfader').value) >= 0 && resultAnalysis.confidence >= .28 && echoPreset !== 'custom') {
          applyEchoPreset(echoPreset, false);
        }
      } catch {
        // Deck B remains playable without a grid.
      }
    }, 30);
    return true;
  } catch {
    const entry = library.find(track => track.path === filePath);
    if (entry) {
      entry.missing = true;
      writeStore('dubstation:library:v2', library);
      renderLibrary();
    }
    status('Could not load that track on Deck B.');
    return false;
  }
}

async function pickAudioForDeckB() {
  if (!bridge?.pickAudio) {
    status('Use a saved library track for Deck B in this preview.');
    return;
  }
  const selection = await bridge.pickAudio();
  const metas = Array.isArray(selection) ? selection : selection?.path ? [selection] : [];
  if (metas.length) await importAudioBatch(metas, 'b');
}

async function loadBrowserFile(file) {
  if (!file) return;
  const possiblePath = bridge?.getPathForFile ? bridge.getPathForFile(file) : '';
  if (possiblePath) {
    await loadPath(possiblePath);
    return;
  }
  try {
    const decoded = await decodeAudio(await file.arrayBuffer());
    if (playing) {
      if (deckB.playing) {
        status('Both decks are live · pause a deck before loading another track');
        return;
      }
      stopDeckB(true);
      deckB.buffer = decoded;
      deckB.track = {
        id: `session-b-${Date.now()}`,
        title: titleFromName(file.name),
        artist: '',
        name: file.name,
        path: '',
        duration: decoded.duration,
        bpm: null
      };
      deckB.analysis = null;
      renderDeckB();
      status(`${deckB.track.title} queued on Deck B · Deck A kept playing`);
    } else {
      activateBuffer(decoded, { name: file.name, path: '', size: file.size, modified: file.lastModified }, false);
    }
  } catch {
    status('That audio format could not be decoded.');
  }
}

async function pickAudio() {
  if (bridge?.pickAudio) {
    const selection = await bridge.pickAudio();
    const metas = Array.isArray(selection) ? selection : selection?.path ? [selection] : [];
    if (metas.length) await importAudioBatch(metas);
    return;
  }
  $('#file-input').click();
}

function renderLibrary() {
  const list = $('#library-list');
  const query = $('#library-search').value.trim().toLowerCase();
  const ordered = [...library].sort((a, b) => (b.lastOpened || b.addedAt || 0) - (a.lastOpened || a.addedAt || 0));
  const filtered = ordered.filter(track => !query || `${track.title} ${track.artist || ''} ${track.path}`.toLowerCase().includes(query));
  const fragment = document.createDocumentFragment();

  filtered.forEach(track => {
    const row = document.createElement('div');
    row.className = 'library-row';
    const button = document.createElement('button');
    button.className = `library-item${currentTrack.id === track.id ? ' active' : ''}${track.missing ? ' missing' : ''}`;
    button.dataset.trackId = track.id;
    button.title = [track.title, track.artist, track.path].filter(Boolean).join('\n');

    const glyph = document.createElement('span');
    glyph.className = 'track-glyph';
    glyph.textContent = track.missing ? '!' : '▶';
    const copy = document.createElement('span');
    copy.className = 'library-copy';
    const title = document.createElement('b');
    setMarqueeText(title, track.title);
    const location = document.createElement('small');
    location.textContent = track.missing
      ? 'FILE MOVED OR MISSING'
      : [track.artist, track.bpm ? `${Math.round(track.bpm)} BPM` : '', track.location].filter(Boolean).join(' · ');
    copy.append(title, location);
    const duration = document.createElement('span');
    duration.className = 'track-time';
    duration.textContent = track.duration ? formatShortTime(track.duration) : '—';
    button.append(glyph, copy, duration);

    const actions = document.createElement('div');
    actions.className = 'library-actions';
    const queue = document.createElement('button');
    queue.className = 'load-deck-b';
    queue.dataset.trackId = track.id;
    queue.title = 'Load on Deck B';
    queue.textContent = 'B';
    const reveal = document.createElement('button');
    reveal.className = 'reveal-library-track';
    reveal.dataset.trackId = track.id;
    reveal.title = 'Show file';
    reveal.textContent = '↗';
    const remove = document.createElement('button');
    remove.className = 'remove-track';
    remove.dataset.trackId = track.id;
    remove.title = 'Remove from library';
    remove.textContent = '×';
    actions.append(queue, reveal, remove);
    row.append(button, actions);
    fragment.appendChild(row);
  });

  list.replaceChildren(fragment);
  $('#library-count').textContent = String(library.length);
  $('#library-empty').classList.toggle('visible', filtered.length === 0);
  $('#library-empty p').textContent = query ? 'No tracks match that search.' : 'Tracks you add stay here with their original location.';
  $('#builtin-track').classList.toggle('active', currentTrack.id === 'builtin');
}

function loadLibraryTrack(id) {
  const entry = library.find(track => track.id === id);
  if (!entry) return;
  if (entry.id === currentTrack.id) {
    status(`${entry.title} is already loaded on Deck A`);
    return;
  }
  loadPath(entry.path);
}

function removeLibraryTrack(id) {
  const removed = library.find(track => track.id === id);
  if (!removed) return;
  lastRemovedTrack = removed;
  library = library.filter(track => track.id !== id);
  writeStore('dubstation:library:v2', library);
  renderLibrary();
  $('#undo-library').hidden = false;
  status('Removed from library · the audio file was not deleted · undo available');
}

function undoLibraryRemoval() {
  if (!lastRemovedTrack) return;
  library = [lastRemovedTrack, ...library.filter(track => track.id !== lastRemovedTrack.id)];
  writeStore('dubstation:library:v2', library);
  const title = lastRemovedTrack.title;
  lastRemovedTrack = null;
  $('#undo-library').hidden = true;
  renderLibrary();
  status(`Restored ${title} to the library`);
}

function revealPath(filePath) {
  if (bridge?.revealFile && filePath) bridge.revealFile(filePath);
}

function loadBuiltIn() {
  if (playing) {
    status('Deck A is live · stop it before replacing it with the built-in groove');
    return;
  }
  stopPlayback(true);
  buffer = null;
  currentTrack = {
    id: 'builtin',
    title: 'Midnight Pressure',
    artist: '',
    name: 'Midnight Pressure',
    path: '',
    source: 'Built-in groove',
    bpm: 86,
    duration: 8
  };
  currentBpm = 86;
  currentAnalysis = { bpm: 86, confidence: 1, beats: builtInBeats() };
  setMarqueeText($('#track-title'), currentTrack.title);
  setTrackDetails(['Built-in groove', '86 BPM', 'loop ready']);
  $('#duration').textContent = '00:08.00';
  $('#source-kind').textContent = 'BUILT IN';
  $('#reveal-track').hidden = true;
  $('#analysis-badge').textContent = '86 BPM · GRID';
  $('#analysis-badge').classList.remove('uncertain');
  $('#waveform').classList.remove('has-audio');
  $('#wave-label').textContent = 'BUILT-IN GROOVE · PRESS PLAY';
  renderIdleWaveform();
  renderLibrary();
  if (echoPreset !== 'custom') applyEchoPreset(echoPreset, false);
  status('Built-in groove ready');
}

function playbackRate() {
  return 1 + Number($('#tempo').value) / 100;
}

function playbackPosition() {
  if (!playing || !audioCtx || !buffer) return pauseAt;
  const position = pauseAt + (audioCtx.currentTime - startedAt) * activePlaybackRate;
  return loopEnabled ? position % buffer.duration : Math.min(buffer.duration, position);
}

function startPlayback() {
  ensureBuffer();
  if (playing) return;
  audioCtx.resume();
  source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.loop = loopEnabled;
  activePlaybackRate = playbackRate();
  source.playbackRate.value = activePlaybackRate;
  source.connect(deckAGain);
  pauseAt = Math.min(pauseAt % buffer.duration, Math.max(0, buffer.duration - .001));
  startedAt = audioCtx.currentTime;
  source.start(0, pauseAt);
  source.onended = () => {
    if (!playing || loopEnabled) return;
    source = null;
    playing = false;
    pauseAt = 0;
    refreshTransport();
    status('Track finished');
  };
  playing = true;
  refreshTransport();
  status(allBypassed ? 'Playing dry · effects bypassed' : 'Playing');
}

function stopPlayback(reset = false) {
  if (playing && source) {
    pauseAt = playbackPosition();
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }
  source = null;
  playing = false;
  if (reset) pauseAt = 0;
  refreshTransport();
}

function refreshTransport() {
  $('#play').textContent = playing ? 'Ⅱ' : '▶';
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const position = playing ? playbackPosition() : pauseAt;
  $('#elapsed').textContent = formatTime(position);
  const percent = buffer?.duration ? position / buffer.duration * 100 : 0;
  $('#playhead').style.left = `${percent}%`;
  $('#wave-progress').style.width = `${percent}%`;
  $('#load-btn').innerHTML = playing ? '<span>＋</span> QUEUE NEXT' : '<span>＋</span> ADD AUDIO';
  const crossfade = Number($('#crossfader').value);
  $('#deck-a-state').textContent = playing ? (crossfade <= 0 ? 'DECK A · ON AIR' : 'DECK A · PLAYING') : buffer ? 'DECK A · LOADED' : 'DECK A · READY';
}

function cue() {
  const resume = playing;
  stopPlayback(true);
  if (resume) startPlayback();
  status('Returned to cue');
}

function seekTo(ratio) {
  if (!buffer) ensureBuffer();
  const resume = playing;
  stopPlayback();
  pauseAt = clamp(ratio, 0, 1) * buffer.duration;
  if (resume) startPlayback();
  else refreshTransport();
  status(`Cue position · ${formatTime(pauseAt)}`);
}

function readout(name) {
  if (name === 'filter') {
    if (values.filter >= 99) return 'OPEN';
    const hz = 80 * Math.pow(250, values.filter / 100);
    return hz > 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
  }
  if (name === 'sirenFreq') return `${Math.round(120 * Math.pow(16, values.sirenFreq / 100))} Hz`;
  if (name === 'build') return values.build < .5 ? 'READY' : `${Math.round(values.build)}%`;
  return `${Math.round(values[name])}%`;
}

function detailReadout(name) {
  if (name === 'delayTime') return `${Math.round(values[name])} ms`;
  return `${Math.round(values[name])}%`;
}

function setControl(name, nextValue, announce = false, fast = false) {
  values[name] = clamp(nextValue);
  $$(`[data-control="${name}"]`).forEach(element => {
    if (element.matches('input')) element.value = String(values[name]);
    if (element.classList.contains('knob')) {
      element.dataset.value = String(values[name]);
      element.style.setProperty('--fill', `${values[name] * .75}%`);
      element.style.setProperty('--angle', `${-135 + values[name] * 2.7}deg`);
      element.setAttribute('aria-valuenow', String(Math.round(values[name])));
    }
  });
  $$(`[data-readout="${name}"]`).forEach(element => {
    element.textContent = readout(name);
  });
  if (name === 'sirenFreq') $('#siren-hz').textContent = readout(name);
  if (audioCtx && name === 'sirenFreq' && sirenOsc) {
    sirenOsc.frequency.setTargetAtTime(120 * Math.pow(16, values.sirenFreq / 100), audioCtx.currentTime, .01);
  }
  if (audioCtx && name === 'sirenRate' && sirenLfo && sirenLfoGain) {
    sirenLfo.frequency.setTargetAtTime(.2 + values.sirenRate / 100 * 11.8, audioCtx.currentTime, .01);
    sirenLfoGain.gain.setTargetAtTime(8 + values.sirenRate / 100 * 110, audioCtx.currentTime, .01);
  }
  if (audioCtx && name === 'sirenLevel' && sirenGain) {
    sirenGain.gain.setTargetAtTime(values.sirenLevel / 100 * .42, audioCtx.currentTime, .01);
  }
  applyAudioState(fast);
  refreshFxVisuals();
  if (announce) status(`${name === 'build' ? 'BUILD' : name.toUpperCase()} · ${readout(name)}`);
}

function setDetailControl(name, nextValue, fromPreset = false) {
  const limits = {
    delayTime: [80, 900],
    delayFeedback: [0, 82],
    delayTone: [0, 100],
    filterResonance: [0, 100],
    reverbDecay: [0, 100]
  };
  values[name] = clamp(nextValue, ...limits[name]);
  const input = $(`[data-detail-control="${name}"]`);
  if (input) input.value = String(values[name]);
  const output = $(`[data-detail-readout="${name}"]`);
  if (output) output.textContent = detailReadout(name);
  if (!fromPreset && name.startsWith('delay')) {
    echoPreset = 'custom';
    refreshEchoPreset();
  }
  if (name === 'reverbDecay') scheduleReverbRefresh();
  applyAudioState();
}

function activeEffectBpm() {
  const crossfade = Number($('#crossfader').value);
  const deckBBpm = deckB.analysis?.confidence >= .28 ? deckB.analysis.bpm : null;
  if (crossfade >= 0 && deckBBpm) return deckBBpm;
  return (currentBpm || 100) * playbackRate();
}

function echoPresetValues(name) {
  const beatMs = 60000 / activeEffectBpm();
  if (name === 'slap') return { time: 110, feedback: 28, tone: 74 };
  if (name === 'deep') return { time: Math.round(beatMs * .75 / 5) * 5, feedback: 68, tone: 38 };
  return { time: Math.round(beatMs * .5 / 5) * 5, feedback: 56, tone: 52 };
}

function applyEchoPreset(name, announce = true) {
  echoPreset = name;
  const preset = echoPresetValues(name);
  setDetailControl('delayTime', preset.time, true);
  setDetailControl('delayFeedback', preset.feedback, true);
  setDetailControl('delayTone', preset.tone, true);
  refreshEchoPreset();
  if (announce) status(`${name.toUpperCase()} echo · ${preset.time} ms`);
}

function refreshEchoPreset() {
  $$('[data-echo-preset]').forEach(button => button.classList.toggle('active', button.dataset.echoPreset === echoPreset));
  const label = echoPreset === 'custom' ? 'CUSTOM' : echoPreset.toUpperCase();
  $('#echo-character').textContent = `${label} · ${Math.round(values.delayTime)} MS`;
  $('#advanced-preset-label').textContent = echoPreset === 'custom' ? 'CUSTOM SHAPE' : `${label} PRESET`;
}

function armLearn(name) {
  if (!midiLearn) return;
  learningControl = name;
  $$('.midi-armed').forEach(element => element.classList.remove('midi-armed'));
  if (name.startsWith('pad:')) {
    $(`.pad[data-pad="${name.slice(4)}"]`)?.classList.add('midi-armed');
  } else {
    $$(`[data-control="${name}"]`).forEach(element => element.classList.add('midi-armed'));
  }
  status(`Move a MIDI control for ${name.toUpperCase()}`);
}

function bindKnob(knob) {
  let dragging = false;
  let startY = 0;
  let startX = 0;
  let startValue = 0;
  const move = event => {
    if (!dragging) return;
    const vertical = startY - event.clientY;
    const horizontal = event.clientX - startX;
    setControl(knob.dataset.control, startValue + vertical * .55 + horizontal * .25, true);
  };
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    knob.classList.remove('dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  };
  knob.addEventListener('pointerdown', event => {
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startX = event.clientX;
    startValue = values[knob.dataset.control];
    knob.classList.add('dragging');
    armLearn(knob.dataset.control);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
  knob.addEventListener('wheel', event => {
    event.preventDefault();
    setControl(knob.dataset.control, values[knob.dataset.control] + (event.deltaY < 0 ? 2 : -2), true);
  }, { passive: false });
  knob.addEventListener('keydown', event => {
    const direction = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    setControl(knob.dataset.control, values[knob.dataset.control] + direction * (event.shiftKey ? 10 : 2), true);
  });
  knob.addEventListener('dblclick', () => setControl(knob.dataset.control, defaults[knob.dataset.control], true));
}

function isFxActive(name) {
  if (allBypassed || !fxEnabled[name]) return false;
  return name === 'filter' ? values.filter < 99 : values[name] > .5;
}

function refreshFxVisuals() {
  Object.keys(fxEnabled).forEach(name => {
    const article = $(`.fx[data-fx="${name}"]`);
    article.classList.toggle('off', !fxEnabled[name] || allBypassed);
    article.querySelector('.power').classList.toggle('on', fxEnabled[name] && !allBypassed);
  });
  const active = Object.keys(fxEnabled).filter(isFxActive);
  if (allBypassed) $('#fx-summary').textContent = 'ALL FX BYPASSED';
  else if (values.build > .5) $('#fx-summary').textContent = `BUILD ${Math.round(values.build)}%`;
  else if (active.length) $('#fx-summary').textContent = active.map(name => name === 'delay' ? 'ECHO' : name === 'crush' ? 'GRIT' : name.toUpperCase()).join(' + ');
  else $('#fx-summary').textContent = 'DRY SIGNAL';
  $('#bypass').textContent = allBypassed ? 'RESTORE FX' : 'BYPASS ALL';
  $('#bypass').classList.toggle('active-bypass', allBypassed);
}

function toggleFx(name) {
  fxEnabled[name] = !fxEnabled[name];
  applyAudioState();
  refreshFxVisuals();
  status(`${name === 'delay' ? 'ECHO' : name.toUpperCase()} ${fxEnabled[name] ? 'ready' : 'off'}`);
}

function toggleBypass() {
  allBypassed = !allBypassed;
  applyAudioState(true);
  refreshFxVisuals();
  status(allBypassed ? 'All effects bypassed · dry signal only' : 'Performance effects restored');
}

function dropBuild() {
  setControl('build', 0, false, true);
  $('#drop-build').classList.add('hit');
  setTimeout(() => $('#drop-build').classList.remove('hit'), 130);
  status('DROP · filter open, reverb released');
}

function noiseBurst(duration = .25, level = .3, frequency = 1800) {
  initAudio();
  const result = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
  const data = result.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  const player = audioCtx.createBufferSource();
  const band = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  player.buffer = result;
  band.type = 'bandpass';
  band.frequency.value = frequency;
  gain.gain.setValueAtTime(level, now);
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  player.connect(band).connect(gain).connect(inputBus);
  player.start();
  player.stop(now + duration);
}

function tone(frequency, duration, level, type = 'sawtooth', detune = 0) {
  initAudio();
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.detune.value = detune;
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  oscillator.connect(gain).connect(inputBus);
  oscillator.start();
  oscillator.stop(now + duration);
}

function triggerSound(type) {
  initAudio();
  audioCtx.resume();
  if (type === 'kick') { tone(110, .3, .68, 'sine'); tone(46, .45, .4, 'sine'); }
  if (type === 'snare') { noiseBurst(.22, .56, 1900); tone(180, .16, .16, 'triangle'); }
  if (type === 'dub') { tone(58, .65, .68, 'sine'); tone(116, .45, .3); noiseBurst(.18, .2, 700); }
  if (type === 'vox') [420, 530, 660].forEach((frequency, index) => tone(frequency, .42, .14, 'triangle', index * 7));
  if (type === 'horn') [220, 277, 330].forEach((frequency, index) => tone(frequency, .58, .2, 'sawtooth', index * 4));
  if (type === 'riser') {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    oscillator.frequency.setValueAtTime(100, now);
    oscillator.frequency.exponentialRampToValueAtTime(1800, now + 1.2);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.3, now + .8);
    gain.gain.exponentialRampToValueAtTime(.0001, now + 1.2);
    oscillator.connect(gain).connect(inputBus);
    oscillator.start();
    oscillator.stop(now + 1.25);
  }
  if (type === 'laser') {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(1500, now);
    oscillator.frequency.exponentialRampToValueAtTime(90, now + .42);
    gain.gain.setValueAtTime(.35, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .42);
    oscillator.connect(gain).connect(inputBus);
    oscillator.start();
    oscillator.stop(now + .45);
  }
  if (type === 'scratch') { noiseBurst(.38, .32, 900); tone(70, .3, .1, 'square'); }
}

function fireSiren() {
  initAudio();
  audioCtx.resume();
  if (sirenOsc) return;
  sirenOsc = audioCtx.createOscillator();
  sirenGain = audioCtx.createGain();
  sirenLfo = audioCtx.createOscillator();
  sirenLfoGain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  sirenOsc.type = 'sawtooth';
  sirenOsc.frequency.value = 120 * Math.pow(16, values.sirenFreq / 100);
  sirenGain.gain.setValueAtTime(.0001, now);
  sirenGain.gain.exponentialRampToValueAtTime(Math.max(.0001, values.sirenLevel / 100 * .42), now + .008);
  sirenLfo.frequency.value = .2 + values.sirenRate / 100 * 11.8;
  sirenLfoGain.gain.value = 8 + values.sirenRate / 100 * 110;
  sirenLfo.connect(sirenLfoGain).connect(sirenOsc.frequency);
  sirenOsc.connect(sirenGain).connect(inputBus);
  sirenLfo.start();
  sirenOsc.start();
  $('#siren-fire').classList.add('hit');
  status('Siren live');
}

function stopSiren() {
  if (!sirenOsc) return;
  const oscillator = sirenOsc;
  const lfo = sirenLfo;
  const gain = sirenGain;
  const now = audioCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), now);
  gain.gain.exponentialRampToValueAtTime(.0001, now + .014);
  oscillator.stop(now + .018);
  lfo.stop(now + .018);
  sirenOsc = sirenGain = sirenLfo = sirenLfoGain = null;
  $('#siren-fire').classList.remove('hit');
  status('Siren released');
}

function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];
  return options.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function saveRecording(blob) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bridge?.saveRecording) {
      const result = await bridge.saveRecording(bytes, blob.type);
      if (result?.path) {
        status(`Set saved · ${result.name}`);
        return true;
      }
      status('Save cancelled · the captured take is still ready');
      return false;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `samDub Set ${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status('Set recording downloaded');
    return true;
  } catch {
    status('Save failed · the captured take is still ready');
    return false;
  }
}

function updateRecordingUi() {
  const button = $('#record-set');
  const label = button.querySelector('b');
  const timer = $('#record-time');
  button.classList.toggle('recording', recordingState === 'recording');
  button.disabled = recordingState === 'stopping' || recordingState === 'saving';
  if (recordingState === 'recording') label.textContent = 'STOP REC';
  else if (recordingState === 'stopping') label.textContent = 'FINISHING';
  else if (recordingState === 'saving') label.textContent = 'SAVING';
  else if (recordingState === 'ready') label.textContent = 'SAVE TAKE';
  else label.textContent = 'REC SET';
  if (recordingState === 'idle') timer.textContent = '00:00';
  if (recordingState === 'ready') timer.textContent = 'READY';
  bridge?.setRecordingState?.(recordingState !== 'idle');
}

async function savePendingRecording() {
  if (!pendingRecordingBlob || recordingState === 'saving') return;
  recordingState = 'saving';
  updateRecordingUi();
  const saved = await saveRecording(pendingRecordingBlob);
  if (saved) {
    pendingRecordingBlob = null;
    recordingState = 'idle';
  } else {
    recordingState = 'ready';
  }
  updateRecordingUi();
}

function startSetRecording() {
  if (recordingState !== 'idle') return;
  initAudio();
  audioCtx.resume();
  const mimeType = recordingMimeType();
  if (!mimeType) {
    status('Set recording is unavailable in this runtime.');
    return;
  }
  try {
    const recorder = new MediaRecorder(recordDestination.stream, { mimeType, audioBitsPerSecond: 192000 });
    const takeChunks = [];
    mediaRecorder = recorder;
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) takeChunks.push(event.data);
    });
    recorder.addEventListener('error', () => {
      if (mediaRecorder !== recorder) return;
      mediaRecorder = null;
      recordingState = 'idle';
      updateRecordingUi();
      status('The set recorder stopped unexpectedly.');
    }, { once: true });
    recorder.addEventListener('stop', async () => {
      if (mediaRecorder === recorder) mediaRecorder = null;
      const blob = new Blob(takeChunks, { type: recorder.mimeType });
      if (!blob.size) {
        recordingState = 'idle';
        updateRecordingUi();
        status('The recording was empty.');
        return;
      }
      pendingRecordingBlob = blob;
      recordingState = 'ready';
      updateRecordingUi();
      await savePendingRecording();
    }, { once: true });
    recorder.start(1000);
    recordingStartedAt = Date.now();
    recordingState = 'recording';
    updateRecordingUi();
    status('Recording the limited master output');
  } catch {
    mediaRecorder = null;
    recordingState = 'idle';
    updateRecordingUi();
    status('Set recording could not start.');
  }
}

function stopSetRecording() {
  if (recordingState !== 'recording' || !mediaRecorder || mediaRecorder.state === 'inactive') return;
  recordingState = 'stopping';
  updateRecordingUi();
  try {
    mediaRecorder.requestData();
  } catch {
    // Some Chromium builds flush automatically on stop.
  }
  mediaRecorder.stop();
  status('Set captured · choose where to save it');
}

function toggleSetRecording() {
  if (recordingState === 'recording') stopSetRecording();
  else if (recordingState === 'ready') savePendingRecording();
  else if (recordingState === 'idle') startSetRecording();
}

function refreshMidiRows() {
  const names = ['filter', 'delay', 'build', 'pads'];
  $$('#mapping-list > div').forEach((row, index) => {
    const targetName = names[index];
    const mapping = Object.entries(midiMappings).find(([, target]) => targetName === 'pads' ? target === 'pads' || target.startsWith('pad:') : target === targetName);
    if (!mapping) {
      row.querySelector('code').textContent = 'UNASSIGNED';
      return;
    }
    const padName = mapping[1].startsWith('pad:') ? ` → ${mapping[1].slice(4).toUpperCase()}` : '';
    row.querySelector('code').textContent = `${mapping[0].toUpperCase()}${padName}`;
  });
}

function refreshMidiLearnUi() {
  $('#learn').textContent = midiLearn ? 'MIDI LEARN ARMED' : 'ENABLE MIDI LEARN';
  $('#learn').classList.toggle('armed', midiLearn);
  if (!midiLearn) {
    learningControl = null;
    $$('.midi-armed').forEach(element => element.classList.remove('midi-armed'));
  }
}

function attachMidiInputs() {
  if (!midiAccess) return;
  midiAccess.inputs.forEach(input => {
    input.onmidimessage = onMidi;
  });
  $('#midi-state').textContent = midiAccess.inputs.size ? 'CONNECTED' : 'NO DEVICE';
}

async function connectMidi(announce = true) {
  if (!navigator.requestMIDIAccess) {
    if (announce) status('MIDI is unavailable on this system.');
    return false;
  }
  try {
    if (!midiAccess) midiAccess = await navigator.requestMIDIAccess();
    attachMidiInputs();
    midiAccess.onstatechange = attachMidiInputs;
    if (announce) status(midiLearn ? 'Click a control, then move a MIDI knob or pad' : 'Saved MIDI mappings are active');
    return true;
  } catch {
    midiLearn = false;
    refreshMidiLearnUi();
    if (announce) status('MIDI permission unavailable.');
    return false;
  }
}

async function toggleMidiLearn() {
  midiLearn = !midiLearn;
  refreshMidiLearnUi();
  if (!midiLearn) {
    status('Saved MIDI mappings remain active');
    return;
  }
  await connectMidi(true);
}

function onMidi(event) {
  const [statusByte, number, amount] = event.data;
  const kind = statusByte & 0xf0;
  const key = kind === 0xb0 ? `cc${number}` : kind === 0x90 && amount > 0 ? `note${number}` : null;
  if (!key) return;
  if (midiLearn && learningControl) {
    if (learningControl.startsWith('pad:') && kind !== 0x90) {
      status('Trigger a MIDI note to map this pad');
      return;
    }
    Object.keys(midiMappings).forEach(existingKey => {
      if (midiMappings[existingKey] === learningControl) delete midiMappings[existingKey];
    });
    midiMappings[key] = learningControl;
    writeStore('dubstation:midi', midiMappings);
    learningControl = null;
    $$('.midi-armed').forEach(element => element.classList.remove('midi-armed'));
    refreshMidiRows();
    status(`Saved ${key.toUpperCase()} mapping`);
    return;
  }
  const target = midiMappings[key];
  if (target === 'pads' && kind === 0x90) {
    const pads = $$('.pad');
    pads[number % pads.length]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  } else if (target?.startsWith('pad:') && kind === 0x90) {
    const pad = $(`.pad[data-pad="${target.slice(4)}"]`);
    pad?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  } else if (target) {
    setControl(target, kind === 0xb0 ? amount / 127 * 100 : 100, true);
  }
}

function openSettings() {
  $('#settings-panel').classList.add('open');
  $('#settings-backdrop').classList.add('open');
  $('#settings-panel').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#close-settings').focus(), 230);
}

function closeSettings() {
  $('#settings-panel').classList.remove('open');
  $('#settings-backdrop').classList.remove('open');
  $('#settings-panel').setAttribute('aria-hidden', 'true');
  $('#settings').focus();
}

function applySettingsState() {
  $('#advanced-toggle').checked = settingsState.advancedFx;
  $('#advanced-controls').classList.toggle('open', settingsState.advancedFx);
}

const dropZone = $('#waveform');
let dragDepth = 0;

function setFileDragState(active) {
  document.body.dataset.dropMessage = playing
    ? 'DROP AUDIO · QUEUE ON DECK B'
    : 'DROP AUDIO · LOAD DECK A + ADD TO LIBRARY';
  document.body.classList.toggle('file-drag', active);
  dropZone.classList.toggle('dragging', active);
  $('#wave-label').textContent = active
    ? playing ? 'DROP TO QUEUE ON DECK B' : 'DROP TO LOAD DECK A + ADD TO LIBRARY'
    : buffer ? 'AUDIO LOADED · PRESS PLAY' : 'BUILT-IN GROOVE · PRESS PLAY';
}

async function handleSelectedFiles(files, target = 'auto') {
  const audioFiles = [...files].filter(candidate => candidate.type.startsWith('audio/') || audioExtensions.test(candidate.name));
  if (!audioFiles.length) {
    status('Choose WAV, MP3, OGG, FLAC, M4A, AAC or AIFF files.');
    return;
  }

  if (bridge?.getPathForFile && bridge?.inspectAudioPaths) {
    const paths = audioFiles.map(file => {
      try {
        return bridge.getPathForFile(file);
      } catch {
        return '';
      }
    }).filter(Boolean);
    if (paths.length) {
      const metas = await bridge.inspectAudioPaths(paths);
      await importAudioBatch(metas, target);
      return;
    }
  }

  await loadBrowserFile(audioFiles[0]);
  if (audioFiles.length > 1) status('Only the first track can be kept in this browser preview. Use the desktop app for batch import.');
}

['dragenter', 'dragover'].forEach(type => {
  document.addEventListener(type, event => {
    event.preventDefault();
    if (type === 'dragenter') dragDepth++;
    setFileDragState(true);
  });
});
document.addEventListener('dragleave', event => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setFileDragState(false);
});
document.addEventListener('dragend', event => {
  event.preventDefault();
  dragDepth = 0;
  setFileDragState(false);
});
document.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    setFileDragState(false);
    handleSelectedFiles(event.dataTransfer.files);
});

$('#load-btn').addEventListener('click', pickAudio);
$('#file-input').addEventListener('change', event => {
  if (event.target.files.length) handleSelectedFiles(event.target.files);
  event.target.value = '';
});
$('#library-search').addEventListener('input', renderLibrary);
$('#undo-library').addEventListener('click', undoLibraryRemoval);
$('#library-list').addEventListener('click', event => {
  const loadButton = event.target.closest('.library-item');
  const queueButton = event.target.closest('.load-deck-b');
  const revealButton = event.target.closest('.reveal-library-track');
  const removeButton = event.target.closest('.remove-track');
  if (loadButton) loadLibraryTrack(loadButton.dataset.trackId);
  if (queueButton) {
    const entry = library.find(track => track.id === queueButton.dataset.trackId);
    if (entry) loadPathToDeckB(entry.path, { replaceLoaded: true });
  }
  if (revealButton) {
    const entry = library.find(track => track.id === revealButton.dataset.trackId);
    if (entry) revealPath(entry.path);
  }
  if (removeButton) removeLibraryTrack(removeButton.dataset.trackId);
});
$('#builtin-track').addEventListener('click', loadBuiltIn);
$('#reveal-track').addEventListener('click', () => revealPath(currentTrack.path));
$('#deck-b-load').addEventListener('click', pickAudioForDeckB);
$('#deck-b-play').addEventListener('click', () => deckB.playing ? stopDeckB() : startDeckB());
$('#deck-b-take').addEventListener('click', promoteDeckB);
$('#deck-b-cue').addEventListener('click', () => {
  const resume = deckB.playing;
  stopDeckB(true);
  if (resume) startDeckB();
  status('Deck B returned to cue');
});
$('#crossfader').addEventListener('input', event => {
  initAudio();
  setCrossfader(Number(event.target.value) / 100);
  if (echoPreset !== 'custom') applyEchoPreset(echoPreset, false);
  refreshTransport();
  renderDeckB();
});
$('#record-set').addEventListener('click', toggleSetRecording);

$('#play').addEventListener('click', () => playing ? stopPlayback() : startPlayback());
$('#stop').addEventListener('click', () => {
  stopPlayback(true);
  status('Stopped');
});
$('#cue').addEventListener('click', cue);
$('#loop').addEventListener('click', () => {
  if (playing) {
    pauseAt = playbackPosition();
    startedAt = audioCtx.currentTime;
  }
  if (deckB.playing) {
    deckB.pauseAt = deckBPosition();
    deckB.startedAt = audioCtx.currentTime;
  }
  loopEnabled = !loopEnabled;
  $('#loop').classList.toggle('active', loopEnabled);
  if (source) source.loop = loopEnabled;
  if (deckB.source) deckB.source.loop = loopEnabled;
  status(loopEnabled ? 'Loop enabled' : 'Loop disabled');
});
$('#waveform').addEventListener('pointerdown', event => {
  if (event.target.closest('button')) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  seekTo((event.clientX - bounds.left) / bounds.width);
});
$('#tempo').addEventListener('input', event => {
  if (playing) {
    pauseAt = playbackPosition();
    startedAt = audioCtx.currentTime;
  }
  $('#tempo-val').textContent = `${event.target.value >= 0 ? '+' : ''}${Number(event.target.value).toFixed(1)}%`;
  activePlaybackRate = playbackRate();
  if (source) source.playbackRate.value = activePlaybackRate;
  if (echoPreset !== 'custom') applyEchoPreset(echoPreset, false);
});
$('#master').addEventListener('input', event => {
  initAudio();
  masterGain.gain.setTargetAtTime(Number(event.target.value), audioCtx.currentTime, .012);
});

$$('.fx-range, .build-range').forEach(range => {
  range.addEventListener('input', event => setControl(event.target.dataset.control, event.target.value));
  range.addEventListener('pointerdown', () => armLearn(range.dataset.control));
});
$$('.knob').forEach(bindKnob);
$$('.fx .power').forEach(button => {
  button.addEventListener('click', () => toggleFx(button.closest('.fx').dataset.fx));
});
$$('[data-echo-preset]').forEach(button => {
  button.addEventListener('click', () => applyEchoPreset(button.dataset.echoPreset));
});
$('#bypass').addEventListener('click', toggleBypass);
$('#drop-build').addEventListener('click', dropBuild);

$('#throw').addEventListener('pointerdown', () => {
  initAudio();
  if (allBypassed || !fxEnabled.delay) {
    status('Echo is bypassed');
    return;
  }
  delayWet.gain.setTargetAtTime(.86, audioCtx.currentTime, .006);
  delayFeedback.gain.setTargetAtTime(Math.min(.82, Math.max(.72, values.delayFeedback / 100 * .96)), audioCtx.currentTime, .006);
  $('#throw').classList.add('hit');
  status('Echo thrown');
});
const releaseThrow = () => {
  $('#throw').classList.remove('hit');
  applyAudioState(true);
};
$('#throw').addEventListener('pointerup', releaseThrow);
$('#throw').addEventListener('pointerleave', releaseThrow);
$('#throw').addEventListener('pointercancel', releaseThrow);
window.addEventListener('blur', () => {
  stopSiren();
  releaseThrow();
});

$$('.pad').forEach(pad => {
  pad.addEventListener('pointerdown', () => {
    if (midiLearn) {
      armLearn(`pad:${pad.dataset.pad}`);
      return;
    }
    pad.classList.add('hit');
    setTimeout(() => pad.classList.remove('hit'), 100);
    triggerSound(pad.dataset.pad);
    status(`Triggered ${pad.querySelector('b').textContent}`);
  });
});
$('#siren-fire').addEventListener('pointerdown', fireSiren);
$('#siren-fire').addEventListener('pointerup', stopSiren);
$('#siren-fire').addEventListener('pointerleave', stopSiren);
$('#siren-fire').addEventListener('pointercancel', stopSiren);

$('#settings').addEventListener('click', openSettings);
$('#close-settings').addEventListener('click', closeSettings);
$('#settings-backdrop').addEventListener('click', closeSettings);
$('#advanced-toggle').addEventListener('change', event => {
  settingsState.advancedFx = event.target.checked;
  writeStore('dubstation:settings:v2', settingsState);
  applySettingsState();
  status(settingsState.advancedFx ? 'Advanced effect controls enabled' : 'Advanced controls tucked away');
});
$$('[data-detail-control]').forEach(input => {
  input.addEventListener('input', event => {
    setDetailControl(event.target.dataset.detailControl, event.target.value);
    status(`${event.target.dataset.detailControl.replace(/([A-Z])/g, ' $1').toUpperCase()} · ${detailReadout(event.target.dataset.detailControl)}`);
  });
});
$('#learn').addEventListener('click', toggleMidiLearn);
$('#reset-fx').addEventListener('click', () => {
  ['filter', 'delay', 'reverb', 'crush', 'build'].forEach(name => setControl(name, defaults[name]));
  applyEchoPreset('dub', false);
  Object.keys(fxEnabled).forEach(name => {
    fxEnabled[name] = true;
  });
  allBypassed = false;
  applyAudioState(true);
  refreshFxVisuals();
  status('Performance effects reset');
});

const padKeys = { q: 0, w: 1, e: 2, r: 3, a: 4, s: 5, d: 6, f: 7 };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#settings-panel').classList.contains('open')) {
    closeSettings();
    return;
  }
  if (event.repeat || event.target.closest('input, textarea, select, button')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && lastRemovedTrack) {
    event.preventDefault();
    undoLibraryRemoval();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    fireSiren();
    return;
  }
  if (event.code === 'Enter' && values.build > .5) {
    dropBuild();
    return;
  }
  const index = padKeys[event.key.toLowerCase()];
  if (index !== undefined) $$('.pad')[index].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
document.addEventListener('keyup', event => {
  if (event.code === 'Space') stopSiren();
});

Object.entries(values).forEach(([name, value]) => {
  if (['delayTime', 'delayFeedback', 'delayTone', 'filterResonance', 'reverbDecay'].includes(name)) setDetailControl(name, value, true);
  else setControl(name, value);
});
applyEchoPreset('dub', false);
applySettingsState();
refreshMidiRows();
setXInputUi(null);
refreshFxVisuals();
refreshAudioEngineState();
updateRecordingUi();
setMarqueeText($('#track-title'), currentTrack.title);
setTrackDetails(['Built-in groove', '86 BPM', 'loop ready']);
renderIdleWaveform();
renderLibrary();
initSpectrumSurface();
renderSpectrumNow();
requestAnimationFrame(animateSpectrum);
if (Object.keys(midiMappings).length) {
  document.addEventListener('pointerdown', () => connectMidi(false), { once: true, capture: true });
  document.addEventListener('keydown', () => connectMidi(false), { once: true, capture: true });
}

window.__dubDebug = () => ({
  bypassed: allBypassed,
  playing,
  position: playbackPosition(),
  loopEnabled,
  fxEnabled: { ...fxEnabled },
  values: { ...values },
  echoPreset,
  advancedFx: settingsState.advancedFx,
  libraryCount: library.length,
  bpm: currentAnalysis.bpm,
  confidence: currentAnalysis.confidence,
  deckBPlaying: deckB.playing,
  deckBTitle: deckB.track?.title || null,
  deckAGain: deckAGain?.gain.value ?? null,
  deckBGain: deckBGain?.gain.value ?? null,
  recorderSupported: Boolean(recordingMimeType()),
  recordingState,
  hasPendingRecording: Boolean(pendingRecordingBlob),
  dryGain: dryGain?.gain.value ?? null,
  trueBypassGain: trueBypassGain?.gain.value ?? null,
  limiterReduction: limiterNode?.reduction ?? null,
  limiterReady: Boolean(limiterNode),
  spectrumReady: Boolean(meterLeftFrequencyData && meterRightFrequencyData),
  spectrumMode: 'rectangular-bars',
  spectrumBarCount,
  spectrumRefreshPolicy: 'display-sync',
  spectrumNormalFrameThrottleMs: 0,
  spectrumReducedMotion,
  spectrumFps,
  spectrumFrames: spectrumFrameCount,
  spectrumRafFrames: spectrumRafFrameCount,
  spectrumPeak,
  spectrumRenderAverageMs,
  spectrumRenderMaxMs,
  xinputSupported: Boolean(navigator.getGamepads),
  xinputConnected: xinputState.connected,
  xinputFrames: xinputState.frames,
  delayWet: delayWet?.gain.value ?? null,
  delayFeedback: delayFeedback?.gain.value ?? null,
  reverbWet: reverbWet?.gain.value ?? null,
  filterFrequency: filterNode?.frequency.value ?? null
});
window.__dubTest = {
  addLibraryEntry(entry) {
    const next = {
      id: entry.id || makeTrackId(entry.path),
      title: entry.title || titleFromName(entry.name),
      artist: entry.artist || '',
      name: entry.name,
      path: entry.path,
      location: locationFromPath(entry.path),
      duration: entry.duration || 0,
      addedAt: Date.now(),
      lastOpened: Date.now(),
      missing: false
    };
    library = [next, ...library.filter(track => track.id !== next.id)];
    renderLibrary();
    return next.id;
  },
  removeLibraryEntry(id) {
    library = library.filter(track => track.id !== id);
    renderLibrary();
  },
  loadBuiltInToDeckB() {
    initAudio();
    stopDeckB(true);
    deckB.buffer = makeDefaultLoop();
    deckB.track = {
      id: 'test-deck-b',
      title: 'Deck B Test Groove',
      artist: '',
      name: 'Deck B Test Groove',
      path: '',
      duration: deckB.buffer.duration,
      bpm: 86
    };
    deckB.analysis = { bpm: 86, confidence: 1 };
    renderDeckB();
  },
  analyzeBuiltIn() {
    initAudio();
    return analyzeBeats(makeDefaultLoop());
  },
  renderSpectrum() {
    return renderSpectrumNow();
  },
  refreshMarquees() {
    $$('.marquee-text').forEach(refreshMarquee);
    return $$('.marquee-text.scrolling').length;
  },
  applyXInputSnapshot(gamepad, timestamp) {
    return applyXInputSnapshot(gamepad, timestamp);
  },
  disconnectXInput,
  setDeckAClock(pause, elapsed, rate = 1) {
    initAudio();
    pauseAt = pause;
    startedAt = audioCtx.currentTime - elapsed;
    activePlaybackRate = rate;
  },
  analyzeBeats
};

setInterval(() => {
  if (playing && buffer) refreshTransport();
  if (deckB.playing) renderDeckB();
  refreshMeters();
  if (recordingState === 'recording') {
    $('#record-time').textContent = formatShortTime((Date.now() - recordingStartedAt) / 1000);
  }
}, 60);
