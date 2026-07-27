let audioCtx, source, buffer, inputBus, filter, crush, dryGain, delay, delayWet, delayFeedback, reverb, reverbWet, masterGain;
let playing = false, startedAt = 0, pauseAt = 0;
let sirenOsc, sirenGain, sirenLfo, sirenLfoGain, sirenWave = 'sawtooth';
let midiAccess, midiLearn = false, learningControl = null, allBypassed = false;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const values = { filter: 100, delay: 0, reverb: 0, crush: 0, sirenFreq: 42, sirenRate: 18, sirenLevel: 55 };
const defaults = { ...values };
const fxEnabled = { filter: true, delay: true, reverb: true, crush: true };
const midiMappings = JSON.parse(localStorage.getItem('dubstation:midi') || '{}');

const clamp = value => Math.max(0, Math.min(100, Number(value)));
const status = message => $('#status').textContent = message;
const formatTime = time => `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}.${String(Math.floor((time % 1) * 100)).padStart(2, '0')}`;

function impulse(seconds = 1.8) {
  const length = Math.floor(audioCtx.sampleRate * seconds);
  const result = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = result.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.5);
  }
  return result;
}

function driveCurve(amount) {
  const result = new Float32Array(2048), drive = 1 + amount * 15;
  for (let i = 0; i < result.length; i++) {
    const x = i * 2 / result.length - 1;
    result[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return result;
}

function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext({ latencyHint: 'interactive' });
  inputBus = audioCtx.createGain();
  filter = audioCtx.createBiquadFilter();
  crush = audioCtx.createWaveShaper();
  dryGain = audioCtx.createGain();
  delay = audioCtx.createDelay(2);
  delayWet = audioCtx.createGain();
  delayFeedback = audioCtx.createGain();
  reverb = audioCtx.createConvolver();
  reverbWet = audioCtx.createGain();
  masterGain = audioCtx.createGain();

  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  crush.oversample = '2x';
  delay.delayTime.value = (60 / 86) * 0.75;
  reverb.buffer = impulse();
  dryGain.gain.value = 1;
  delayWet.gain.value = 0;
  delayFeedback.gain.value = 0;
  reverbWet.gain.value = 0;
  masterGain.gain.value = Number($('#master').value);

  inputBus.connect(filter);
  filter.connect(crush);
  crush.connect(dryGain).connect(masterGain);
  crush.connect(delay);
  delay.connect(delayWet).connect(masterGain);
  delay.connect(delayFeedback).connect(delay);
  crush.connect(reverb);
  reverb.connect(reverbWet).connect(masterGain);
  masterGain.connect(audioCtx.destination);
  Object.keys(values).forEach(applyAudioValue);
}

function makeDefaultLoop() {
  const sampleRate = audioCtx.sampleRate, duration = 8;
  const result = audioCtx.createBuffer(2, sampleRate * duration, sampleRate);
  const left = result.getChannelData(0), right = result.getChannelData(1), beat = 60 / 86;
  for (let i = 0; i < left.length; i++) {
    const time = i / sampleRate, step = Math.floor(time / beat), phase = time % beat;
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

function ensureBuffer() {
  initAudio();
  if (buffer) return;
  buffer = makeDefaultLoop();
  $('#duration').textContent = formatTime(buffer.duration);
  $('.wave-empty').textContent = 'BUILT-IN GROOVE · DRY BY DEFAULT';
}

function loadFile(file) {
  initAudio();
  stopPlayback(true);
  const reader = new FileReader();
  reader.onerror = () => status('Could not read that file.');
  reader.onload = () => audioCtx.decodeAudioData(reader.result).then(decoded => {
    buffer = decoded;
    $('#track-title').textContent = file.name.replace(/\.[^.]+$/, '');
    $('#track-artist').textContent = 'Local audio · ready to dub';
    $('#duration').textContent = formatTime(buffer.duration);
    $('.wave-empty').textContent = 'AUDIO LOADED · PRESS PLAY';
    status(`Loaded ${file.name}`);
  }).catch(() => status('That audio format could not be decoded.'));
  reader.readAsArrayBuffer(file);
}

function startPlayback() {
  ensureBuffer();
  if (playing) return;
  audioCtx.resume();
  source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.playbackRate.value = 1 + Number($('#tempo').value) / 100;
  source.connect(inputBus);
  pauseAt %= buffer.duration;
  startedAt = audioCtx.currentTime - pauseAt;
  source.start(0, pauseAt);
  playing = true;
  $('#play').textContent = 'Ⅱ';
  status(allBypassed ? 'Playing dry · FX bypassed' : 'Playing');
}

function stopPlayback(reset = false) {
  if (playing && source) {
    pauseAt = (audioCtx.currentTime - startedAt) % buffer.duration;
    source.stop();
  }
  source = null;
  playing = false;
  $('#play').textContent = '▶';
  if (reset) {
    pauseAt = 0;
    $('#elapsed').textContent = '00:00.00';
    $('#playhead').style.left = '0%';
  }
}

function cue() {
  const resume = playing;
  stopPlayback(true);
  if (resume) startPlayback();
  status('Returned to cue');
}

function applyAudioValue(name) {
  if (!audioCtx) return;
  const normal = values[name] / 100, active = effect => fxEnabled[effect] && !allBypassed;
  if (name === 'filter') filter.frequency.setTargetAtTime(active('filter') ? 80 * Math.pow(240, normal) : 20000, audioCtx.currentTime, .012);
  if (name === 'delay') {
    const wet = active('delay') ? normal : 0;
    delayWet.gain.setTargetAtTime(wet * .58, audioCtx.currentTime, .012);
    delayFeedback.gain.setTargetAtTime(wet > 0 ? Math.min(.8, .32 + wet * .48) : 0, audioCtx.currentTime, .012);
  }
  if (name === 'reverb') reverbWet.gain.setTargetAtTime(active('reverb') ? normal * .55 : 0, audioCtx.currentTime, .012);
  if (name === 'crush') crush.curve = driveCurve(active('crush') ? normal : 0);
  if (name === 'sirenFreq' && sirenOsc) sirenOsc.frequency.setTargetAtTime(120 * Math.pow(16, normal), audioCtx.currentTime, .012);
  if (name === 'sirenRate' && sirenLfo) {
    sirenLfo.frequency.setTargetAtTime(.2 + normal * 11.8, audioCtx.currentTime, .012);
    sirenLfoGain.gain.setTargetAtTime(8 + normal * 110, audioCtx.currentTime, .012);
  }
  if (name === 'sirenLevel' && sirenGain) sirenGain.gain.setTargetAtTime(normal * .42, audioCtx.currentTime, .012);
}

function readout(name) {
  if (name === 'filter') {
    if (values.filter >= 99) return 'OPEN';
    const hz = 80 * Math.pow(240, values.filter / 100);
    return hz > 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
  }
  if (name === 'sirenFreq') return `${Math.round(120 * Math.pow(16, values.sirenFreq / 100))} Hz`;
  return `${Math.round(values[name])}%`;
}

function setControl(name, value, announce = false) {
  values[name] = clamp(value);
  $$(`[data-control="${name}"]`).forEach(element => {
    if (element.matches('input')) element.value = values[name];
    if (element.classList.contains('knob')) {
      element.dataset.value = values[name];
      element.style.setProperty('--fill', `${values[name]}%`);
      element.style.setProperty('--angle', `${-135 + values[name] * 2.7}deg`);
      element.setAttribute('aria-valuenow', Math.round(values[name]));
    }
  });
  const article = $(`.fx[data-fx="${name}"]`);
  if (article) article.querySelector('.readout').textContent = readout(name);
  if (name === 'sirenFreq') $('#siren-hz').textContent = readout(name);
  applyAudioValue(name);
  refreshFxOverview();
  if (announce) status(`${name.toUpperCase()} ${readout(name)}`);
}

function armLearn(name) {
  if (!midiLearn) return;
  learningControl = name;
  $$('.midi-armed').forEach(element => element.classList.remove('midi-armed'));
  $$(`[data-control="${name}"]`).forEach(element => element.classList.add('midi-armed'));
  status(`Move a MIDI control for ${name.toUpperCase()}`);
}

function bindKnob(knob) {
  let dragging = false, startY = 0, startX = 0, startValue = 0;
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

function refreshFxButtons() {
  Object.keys(fxEnabled).forEach(name => {
    $(`.fx[data-fx="${name}"] .power`).classList.toggle('on', fxEnabled[name] && !allBypassed);
    applyAudioValue(name);
  });
  refreshFxOverview();
}

function isFxActive(name) {
  if (allBypassed || !fxEnabled[name]) return false;
  return name === 'filter' ? values.filter < 99 : values[name] > .5;
}

function refreshFxOverview() {
  const active = Object.keys(fxEnabled).filter(isFxActive);
  const summary = $('#fx-summary');
  if (allBypassed) summary.textContent = 'DRY · ALL FX BYPASSED';
  else if (active.length) summary.textContent = `${active.length} FX ACTIVE · ${active.map(name => name.toUpperCase()).join(' + ')}`;
  else summary.textContent = 'DRY · FX READY';

  $$('.overview-fx').forEach(chip => {
    const name = chip.dataset.overviewFx;
    chip.classList.toggle('enabled', fxEnabled[name] && !allBypassed);
    chip.classList.toggle('active', isFxActive(name));
    chip.classList.toggle('disabled', !fxEnabled[name] || allBypassed);
    chip.querySelector('small').textContent = !fxEnabled[name] ? 'OFF' : allBypassed ? 'BYPASSED' : readout(name);
  });
  $('#top-bypass').textContent = allBypassed ? 'RESTORE PREVIOUS FX' : 'BYPASS ALL FX';
  $('#top-bypass').classList.toggle('restore', allBypassed);
}

function toggleFx(name) {
  fxEnabled[name] = !fxEnabled[name];
  refreshFxButtons();
  status(`${name.toUpperCase()} ${fxEnabled[name] ? 'ready' : 'off'}`);
}

function toggleBypass() {
  allBypassed = !allBypassed;
  refreshFxButtons();
  $('#bypass').textContent = allBypassed ? 'RESTORE FX' : 'BYPASS ALL';
  $('#bypass').classList.toggle('active-bypass', allBypassed);
  status(allBypassed ? 'All effects bypassed · dry signal only' : 'Previous effects restored');
}

function noiseBurst(duration = .25, level = .3, frequency = 1800) {
  initAudio();
  const result = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate), data = result.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const player = audioCtx.createBufferSource(), band = audioCtx.createBiquadFilter(), gain = audioCtx.createGain(), now = audioCtx.currentTime;
  player.buffer = result; band.type = 'bandpass'; band.frequency.value = frequency;
  gain.gain.setValueAtTime(level, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  player.connect(band).connect(gain).connect(inputBus); player.start(); player.stop(now + duration);
}

function tone(frequency, duration, level, type = 'sawtooth', detune = 0) {
  initAudio();
  const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain(), now = audioCtx.currentTime;
  oscillator.type = type; oscillator.frequency.value = frequency; oscillator.detune.value = detune;
  gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(level, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  oscillator.connect(gain).connect(inputBus); oscillator.start(); oscillator.stop(now + duration);
}

function triggerSound(type) {
  initAudio(); audioCtx.resume();
  if (type === 'kick') { tone(110, .3, .68, 'sine'); tone(46, .45, .4, 'sine'); }
  if (type === 'snare') { noiseBurst(.22, .56, 1900); tone(180, .16, .16, 'triangle'); }
  if (type === 'dub') { tone(58, .65, .68, 'sine'); tone(116, .45, .3); noiseBurst(.18, .2, 700); }
  if (type === 'vox') { [420, 530, 660].forEach((f, i) => tone(f, .42, .14, 'triangle', i * 7)); }
  if (type === 'horn') [220, 277, 330].forEach((f, i) => tone(f, .58, .2, 'sawtooth', i * 4));
  if (type === 'riser') {
    const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain(), now = audioCtx.currentTime;
    oscillator.frequency.setValueAtTime(100, now); oscillator.frequency.exponentialRampToValueAtTime(1800, now + 1.2);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.3, now + .8); gain.gain.exponentialRampToValueAtTime(.0001, now + 1.2);
    oscillator.connect(gain).connect(inputBus); oscillator.start(); oscillator.stop(now + 1.25);
  }
  if (type === 'laser') {
    const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain(), now = audioCtx.currentTime;
    oscillator.type = 'square'; oscillator.frequency.setValueAtTime(1500, now); oscillator.frequency.exponentialRampToValueAtTime(90, now + .42);
    gain.gain.setValueAtTime(.35, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .42);
    oscillator.connect(gain).connect(inputBus); oscillator.start(); oscillator.stop(now + .45);
  }
  if (type === 'scratch') { noiseBurst(.38, .32, 900); tone(70, .3, .1, 'square'); }
}

function fireSiren() {
  initAudio(); audioCtx.resume();
  if (sirenOsc) return;
  sirenOsc = audioCtx.createOscillator(); sirenGain = audioCtx.createGain(); sirenLfo = audioCtx.createOscillator(); sirenLfoGain = audioCtx.createGain();
  sirenOsc.type = sirenWave; sirenOsc.frequency.value = 120 * Math.pow(16, values.sirenFreq / 100);
  sirenGain.gain.value = values.sirenLevel / 100 * .42;
  sirenLfo.frequency.value = .2 + values.sirenRate / 100 * 11.8; sirenLfoGain.gain.value = 8 + values.sirenRate / 100 * 110;
  sirenLfo.connect(sirenLfoGain).connect(sirenOsc.frequency); sirenOsc.connect(sirenGain).connect(inputBus);
  sirenLfo.start(); sirenOsc.start(); status('Siren live');
}

function stopSiren() {
  if (!sirenOsc) return;
  sirenOsc.stop(); sirenLfo.stop();
  sirenOsc = sirenGain = sirenLfo = sirenLfoGain = null;
  status('Siren released');
}

function refreshMidiRows() {
  const names = ['filter', 'delay', 'pads'];
  $$('#mapping-list > div').forEach((row, index) => {
    const mapping = Object.entries(midiMappings).find(([, target]) => target === names[index]);
    row.querySelector('code').textContent = mapping ? mapping[0].toUpperCase() : 'UNASSIGNED';
  });
}

async function toggleMidiLearn() {
  midiLearn = !midiLearn;
  $('#learn').textContent = midiLearn ? '⌁ MIDI LEARN ARMED' : '⌁ ENABLE MIDI LEARN';
  if (!navigator.requestMIDIAccess) return status('MIDI is unavailable on this system.');
  try {
    if (!midiAccess) midiAccess = await navigator.requestMIDIAccess();
    midiAccess.inputs.forEach(input => input.onmidimessage = onMidi);
    $('#midi-state').textContent = midiAccess.inputs.size ? 'CONNECTED' : 'NO DEVICE';
    status(midiLearn ? 'Click a control, then move a MIDI knob' : 'Saved mappings remain active');
  } catch { status('MIDI permission unavailable.'); }
}

function onMidi(event) {
  const [statusByte, number, amount] = event.data, kind = statusByte & 0xf0;
  const key = kind === 0xb0 ? `cc${number}` : kind === 0x90 && amount > 0 ? `note${number}` : null;
  if (!key) return;
  if (midiLearn && learningControl) {
    midiMappings[key] = learningControl;
    localStorage.setItem('dubstation:midi', JSON.stringify(midiMappings));
    learningControl = null;
    $$('.midi-armed').forEach(element => element.classList.remove('midi-armed'));
    refreshMidiRows(); status(`Saved ${key.toUpperCase()} mapping`); return;
  }
  const target = midiMappings[key];
  if (target && target !== 'pads') setControl(target, kind === 0xb0 ? amount / 127 * 100 : 100, true);
}

const dropZone = $('#waveform');
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
  event.preventDefault(); event.stopPropagation(); dropZone.classList.add('dragging'); $('.wave-empty').textContent = 'DROP AUDIO HERE';
}));
['dragleave', 'dragend'].forEach(type => dropZone.addEventListener(type, event => {
  event.preventDefault(); event.stopPropagation(); dropZone.classList.remove('dragging');
  $('.wave-empty').textContent = buffer ? 'AUDIO LOADED · PRESS PLAY' : 'DROP AUDIO OR PLAY THE BUILT-IN GROOVE';
}));
dropZone.addEventListener('drop', event => {
  event.preventDefault(); event.stopPropagation(); dropZone.classList.remove('dragging');
  const file = [...event.dataTransfer.files].find(candidate => candidate.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aif|aiff)$/i.test(candidate.name));
  if (file) loadFile(file); else status('Drop a WAV, MP3, OGG, FLAC, M4A or AIFF file.');
});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());

$('#load-btn').onclick = () => $('#file-input').click();
$('#file-input').onchange = event => event.target.files[0] && loadFile(event.target.files[0]);
$('#play').onclick = () => playing ? stopPlayback() : startPlayback();
$('#stop').onclick = () => { stopPlayback(true); status('Stopped'); };
$('#cue').onclick = cue;
$('#tempo').oninput = event => {
  $('#tempo-val').textContent = `${event.target.value >= 0 ? '+' : ''}${Number(event.target.value).toFixed(1)}%`;
  if (source) source.playbackRate.value = 1 + Number(event.target.value) / 100;
};
$('#master').oninput = event => {
  initAudio();
  masterGain.gain.setTargetAtTime(Number(event.target.value), audioCtx.currentTime, .012);
};

$$('.fx-range').forEach(range => {
  range.oninput = event => setControl(event.target.dataset.control, event.target.value);
  range.onpointerdown = () => armLearn(range.dataset.control);
});
$$('.knob').forEach(bindKnob);
$$('.fx .power').forEach(button => button.onclick = () => {
  const name = button.closest('.fx').dataset.fx;
  toggleFx(name);
});
$$('.overview-fx').forEach(chip => chip.onclick = () => toggleFx(chip.dataset.overviewFx));
$('#bypass').onclick = toggleBypass;
$('#top-bypass').onclick = toggleBypass;
$('#randomise').onclick = () => {
  ['filter', 'delay', 'reverb', 'crush'].forEach(name => setControl(name, 8 + Math.random() * 84));
  status('Rack randomised');
};
$('#throw').onpointerdown = () => {
  initAudio();
  if (allBypassed || !fxEnabled.delay) return status('Delay is bypassed');
  delayWet.gain.setTargetAtTime(.8, audioCtx.currentTime, .006);
  delayFeedback.gain.setTargetAtTime(.78, audioCtx.currentTime, .006);
  status('Echo thrown');
};
const releaseThrow = () => applyAudioValue('delay');
$('#throw').onpointerup = releaseThrow;
$('#throw').onpointerleave = releaseThrow;

$$('.pad').forEach(pad => pad.onpointerdown = () => {
  pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 100);
  triggerSound(pad.dataset.pad); status(`Triggered ${pad.querySelector('b').textContent}`);
});
$('#siren-fire').onpointerdown = fireSiren;
$('#siren-fire').onpointerup = stopSiren;
$('#siren-fire').onpointerleave = stopSiren;
$$('.wave-btn').forEach(button => button.onclick = () => {
  $$('.wave-btn').forEach(item => item.classList.remove('active')); button.classList.add('active');
  sirenWave = button.dataset.wave; if (sirenOsc) sirenOsc.type = sirenWave;
});
$('#learn').onclick = toggleMidiLearn;
$('#settings').onclick = () => {
  $('.mapping').scrollIntoView({ behavior: 'smooth', block: 'center' });
  status('Controller settings');
};

const padKeys = { q: 0, w: 1, e: 2, r: 3, a: 4, s: 5, d: 6, f: 7 };
document.onkeydown = event => {
  if (event.repeat) return;
  if (event.code === 'Space') { event.preventDefault(); fireSiren(); return; }
  const index = padKeys[event.key.toLowerCase()];
  if (index !== undefined) $$('.pad')[index].onpointerdown();
};
document.onkeyup = event => { if (event.code === 'Space') stopSiren(); };

Object.entries(values).forEach(([name, value]) => setControl(name, value));
refreshMidiRows();
refreshFxOverview();
window.__dubDebug = () => ({
  bypassed: allBypassed,
  fxEnabled: { ...fxEnabled },
  values: { ...values },
  dryGain: dryGain ? dryGain.gain.value : null,
  delayWet: delayWet ? delayWet.gain.value : null,
  delayFeedback: delayFeedback ? delayFeedback.gain.value : null,
  reverbWet: reverbWet ? reverbWet.gain.value : null
});
setInterval(() => {
  if (!playing || !buffer) return;
  const position = (audioCtx.currentTime - startedAt) % buffer.duration;
  $('#elapsed').textContent = formatTime(position);
  $('#playhead').style.left = `${position / buffer.duration * 100}%`;
}, 80);
