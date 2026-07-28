const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

app.setName('samDub');
const isolatedRun = process.env.DUBSTATION_SMOKE_TEST === '1' || process.env.DUBSTATION_CAPTURE === '1';
// Keep development data beside the source tree, but use the normal writable per-user
// profile once packaged. An installed app lives inside a read-only asar archive.
if (isolatedRun) app.setPath('userData', path.join(os.tmpdir(), `dubstation-${process.pid}`));
else if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.electron-data'));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let recordingProtected = false;

const audioPattern = /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff)$/i;
const maxAudioBytes = 512 * 1024 * 1024;
const audioTagCache = new Map();
let musicMetadataPromise;

function makeSmokeWav(index = 1) {
  const sampleRate = 44100;
  const seconds = 2;
  const samples = sampleRate * seconds;
  const tags = index === 2
    ? [['INAM', 'Tagged Smoke Groove'], ['IART', 'Codex Sound System']]
    : [];
  const tagPayloadBytes = tags.reduce((total, [, value]) => {
    const size = Buffer.byteLength(value, 'utf8') + 1;
    return total + 8 + size + (size % 2);
  }, 0);
  const audioEnd = 44 + samples * 2;
  const listBytes = tags.length ? 12 + tagPayloadBytes : 0;
  const bytes = Buffer.alloc(audioEnd + listBytes);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRate;
    const pulse = Math.exp(-(time % (60 / 86)) * 22);
    const value = Math.sin(2 * Math.PI * 90 * time) * pulse * .45;
    bytes.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  if (tags.length) {
    let offset = audioEnd;
    bytes.write('LIST', offset);
    bytes.writeUInt32LE(4 + tagPayloadBytes, offset + 4);
    bytes.write('INFO', offset + 8);
    offset += 12;
    tags.forEach(([id, value]) => {
      const size = Buffer.byteLength(value, 'utf8') + 1;
      bytes.write(id, offset);
      bytes.writeUInt32LE(size, offset + 4);
      bytes.write(value, offset + 8, 'utf8');
      offset += 8 + size + (size % 2);
    });
  }
  const filePath = path.join(os.tmpdir(), `dubstation-smoke-${process.pid}-${index}.wav`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function safeAudioPath(filePath) {
  if (typeof filePath !== 'string' || !audioPattern.test(filePath)) throw new Error('Unsupported audio path');
  return path.resolve(filePath);
}

function cleanTag(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function readEmbeddedTags(filePath, details) {
  const cacheKey = `${filePath}|${details.size}|${details.mtimeMs}`;
  if (audioTagCache.has(cacheKey)) return audioTagCache.get(cacheKey);
  let tags = { title: '', artist: '' };
  try {
    musicMetadataPromise ||= import('music-metadata');
    const { parseFile } = await musicMetadataPromise;
    const metadata = await parseFile(filePath, { skipCovers: true, duration: false });
    const artists = Array.isArray(metadata.common.artists) ? metadata.common.artists.join(', ') : '';
    tags = {
      title: cleanTag(metadata.common.title),
      artist: cleanTag(metadata.common.artist || artists)
    };
  } catch {
    // Broken or unsupported tags never make an otherwise playable file fail.
  }
  if (audioTagCache.size >= 1000) audioTagCache.delete(audioTagCache.keys().next().value);
  audioTagCache.set(cacheKey, tags);
  return tags;
}

async function inspectAudioFile(requestedPath) {
  try {
    const filePath = safeAudioPath(requestedPath);
    const details = await fs.promises.stat(filePath);
    if (!details.isFile() || details.size > maxAudioBytes) return null;
    const tags = await readEmbeddedTags(filePath, details);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: details.size,
      modified: details.mtimeMs,
      ...tags
    };
  } catch {
    return null;
  }
}

async function inspectAudioFiles(requestedPaths) {
  const paths = requestedPaths.slice(0, 500);
  const inspected = new Array(paths.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      inspected[index] = await inspectAudioFile(paths[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, paths.length) }, worker));
  return inspected.filter(Boolean);
}

ipcMain.handle('audio:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add audio to samDub',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'aif', 'aiff'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return [];
  return inspectAudioFiles(result.filePaths);
});

ipcMain.handle('audio:inspect', async (_event, requestedPaths) => {
  if (!Array.isArray(requestedPaths)) throw new Error('Audio paths must be an array');
  return inspectAudioFiles(requestedPaths);
});

ipcMain.handle('audio:read', async (_event, requestedPath) => {
  const filePath = safeAudioPath(requestedPath);
  const details = await fs.promises.stat(filePath);
  if (!details.isFile()) throw new Error('Audio location is not a file');
  if (details.size > maxAudioBytes) throw new Error('Audio file is too large to decode safely');
  const tags = await readEmbeddedTags(filePath, details);
  const bytes = await fs.promises.readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: details.size,
    modified: details.mtimeMs,
    ...tags,
    bytes
  };
});

ipcMain.handle('audio:reveal', async (_event, requestedPath) => {
  const filePath = safeAudioPath(requestedPath);
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('recording:save', async (_event, payload) => {
  const mimeType = String(payload?.mimeType || '');
  const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
  const bytes = payload.bytes instanceof Uint8Array ? payload.bytes : Uint8Array.from(payload.bytes?.data || []);
  if (process.env.DUBSTATION_SMOKE_TEST === '1') {
    const smokePath = path.join(os.tmpdir(), `dubstation-recording-${process.pid}.${extension}`);
    await fs.promises.writeFile(smokePath, Buffer.from(bytes));
    return { path: smokePath, name: path.basename(smokePath) };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const result = await dialog.showSaveDialog({
    title: 'Save samDub set',
    defaultPath: path.join(app.getPath('music'), `samDub Set ${stamp}.${extension}`),
    filters: [{ name: extension === 'ogg' ? 'Ogg Opus audio' : 'WebM Opus audio', extensions: [extension] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, Buffer.from(bytes));
  return { path: result.filePath, name: path.basename(result.filePath) };
});

ipcMain.on('recording:state', (_event, active) => {
  recordingProtected = Boolean(active);
});

function createWindow() {
  const smokePath = process.env.DUBSTATION_SMOKE_RESULT
    ? path.resolve(process.env.DUBSTATION_SMOKE_RESULT)
    : path.join(__dirname, '.smoke-result.json');
  const writeSmoke = value => {
    if (process.env.DUBSTATION_SMOKE_TEST === '1') fs.writeFileSync(smokePath, JSON.stringify(value, null, 2));
  };
  writeSmoke({ stage: 'window-starting' });

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#080b0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const appUrl = pathToFileURL(path.join(__dirname, 'index.html')).toString();
  let allowRecordingClose = false;

  win.webContents.on('did-fail-load', (_event, code, description) => console.error('LOAD_FAILED', code, description));
  win.webContents.on('render-process-gone', (_event, details) => {
    recordingProtected = false;
    console.error('RENDER_GONE', details.reason);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });
  win.on('close', event => {
    if (!recordingProtected || allowRecordingClose || isolatedRun) return;
    event.preventDefault();
    dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Unsaved set recording',
      message: 'A set recording is active or waiting to be saved.',
      detail: 'Keep samDub open to stop or save the take. Closing now discards it.',
      buttons: ['Keep samDub open', 'Discard take and close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(result => {
      if (result.response !== 1) return;
      allowRecordingClose = true;
      recordingProtected = false;
      win.close();
    });
  });
  win.once('ready-to-show', () => {
    if (process.env.DUBSTATION_SMOKE_TEST !== '1' && process.env.DUBSTATION_CAPTURE !== '1') {
      win.maximize();
      win.show();
    }
  });

  win.webContents.on('did-finish-load', async () => {
    if (process.env.DUBSTATION_CAPTURE === '1') {
      win.setSize(1920, 1080);
      setTimeout(async () => {
        const siteDirectory = path.join(__dirname, 'site', 'samDub');
        fs.mkdirSync(siteDirectory, { recursive: true });
        await win.webContents.executeJavaScript(`
          document.querySelector('#play')?.click();
          document.querySelector('.stage').scrollTop = 0;
        `);
        await new Promise(resolve => setTimeout(resolve, 650));
        const heroImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'samdub-preview.png'), heroImage.toPNG());
        fs.writeFileSync(path.join(__dirname, 'dubstation-preview.png'), heroImage.toPNG());
        fs.writeFileSync(path.join(siteDirectory, 'samdub-preview.png'), heroImage.toPNG());

        await win.webContents.executeJavaScript(`
          document.querySelector('.stage').scrollTop = document.querySelector('.stage').scrollHeight;
        `);
        await new Promise(resolve => setTimeout(resolve, 650));
        const lowerImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'samdub-spectrum-preview.png'), lowerImage.toPNG());
        const spectrumImage = await win.webContents.capturePage({ x: 318, y: 610, width: 1548, height: 374 });
        fs.writeFileSync(path.join(siteDirectory, 'samdub-spectrum.png'), spectrumImage.toPNG());
        app.quit();
      }, 800);
      return;
    }
    if (process.env.DUBSTATION_SMOKE_TEST !== '1') return;
    writeSmoke({ stage: 'renderer-loaded' });
    const smokeAudioPaths = [makeSmokeWav(1), makeSmokeWav(2), makeSmokeWav(3)];
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const result = { controls: {} };
          document.querySelector('#play').click();
          await new Promise(resolve => setTimeout(resolve, 180));
          result.controls.play = document.querySelector('#play').textContent === 'Ⅱ';
          result.controls.engine = document.querySelector('#engine-label').textContent === 'AUDIO LIVE'
            && window.__dubDebug().limiterReady;
          window.__dubTest.renderSpectrum();
          const spectrumDebug = window.__dubDebug();
          const spectrumCanvas = document.querySelector('#dub-spectrum-canvas');
          result.spectrumDebug = {
            ready: spectrumDebug.spectrumReady,
            mode: spectrumDebug.spectrumMode,
            bars: spectrumDebug.spectrumBarCount,
            refresh: spectrumDebug.spectrumRefreshPolicy,
            normalThrottleMs: spectrumDebug.spectrumNormalFrameThrottleMs,
            frames: spectrumDebug.spectrumFrames,
            peak: spectrumDebug.spectrumPeak,
            width: spectrumCanvas.width,
            height: spectrumCanvas.height
          };
          result.controls.spectrum = spectrumDebug.spectrumReady
            && spectrumDebug.spectrumMode === 'rectangular-bars'
            && spectrumDebug.spectrumBarCount === 72
            && spectrumDebug.spectrumNormalFrameThrottleMs === 0
            && spectrumDebug.spectrumFrames > 0
            && spectrumDebug.spectrumPeak > 0
            && spectrumCanvas.width > 0
            && spectrumCanvas.height > 0;
          const waveform = document.querySelector('#waveform');
          const waveformBounds = waveform.getBoundingClientRect();
          waveform.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: waveformBounds.left + waveformBounds.width * .625,
            clientY: waveformBounds.top + waveformBounds.height / 2
          }));
          await new Promise(resolve => setTimeout(resolve, 80));
          const afterWaveSeek = window.__dubDebug();
          await new Promise(resolve => setTimeout(resolve, 80));
          const afterWaveResume = window.__dubDebug();
          result.controls.liveWaveSeek = afterWaveSeek.playing
            && Math.abs(afterWaveSeek.position - 5) < .3
            && afterWaveResume.position > afterWaveSeek.position
            && document.querySelector('#play').textContent === 'Ⅱ'
            && !document.querySelector('#status').textContent.includes('protected');
          const tempo = document.querySelector('#tempo');
          const positionBeforeTempo = window.__dubDebug().position;
          tempo.value = 10;
          tempo.dispatchEvent(new Event('input', { bubbles: true }));
          const positionAfterTempo = window.__dubDebug().position;
          result.controls.tempoContinuity = Math.abs(positionAfterTempo - positionBeforeTempo) < .06;
          tempo.value = 0;
          tempo.dispatchEvent(new Event('input', { bubbles: true }));
          window.__dubTest.setDeckAClock(0, 10, 1);
          document.querySelector('#loop').click();
          const unloopedPosition = window.__dubDebug().position;
          result.controls.loopContinuity = unloopedPosition > 1.8 && unloopedPosition < 2.2;
          document.querySelector('#loop').click();
          window.__dubTest.setDeckAClock(0, 0, 1);

          const delayRange = document.querySelector('.fx-range[data-control="delay"]');
          delayRange.value = 62;
          delayRange.dispatchEvent(new Event('input', { bubbles: true }));
          result.controls.echo = document.querySelector('[data-readout="delay"]').textContent === '62%';

          document.querySelector('[data-echo-preset="deep"]').click();
          result.controls.echoPreset = window.__dubDebug().echoPreset === 'deep'
            && window.__dubDebug().values.delayTime > 400;

          setControl('build', 72);
          await new Promise(resolve => setTimeout(resolve, 70));
          const built = window.__dubDebug();
          document.querySelector('#drop-build').click();
          await new Promise(resolve => setTimeout(resolve, 70));
          const dropped = window.__dubDebug();
          result.controls.buildDrop = built.values.build === 72 && dropped.values.build === 0
            && dropped.filterFrequency > built.filterFrequency && dropped.reverbWet < built.reverbWet;
          const filterPowerForBuild = document.querySelector('.fx[data-fx="filter"] .power');
          const spacePowerForBuild = document.querySelector('.fx[data-fx="reverb"] .power');
          filterPowerForBuild.click();
          spacePowerForBuild.click();
          setControl('build', 72);
          await new Promise(resolve => setTimeout(resolve, 80));
          const gatedBuild = window.__dubDebug();
          result.controls.buildPowerGating = gatedBuild.filterFrequency > 18000 && gatedBuild.reverbWet < .001;
          filterPowerForBuild.click();
          spacePowerForBuild.click();
          document.querySelector('#drop-build').click();

          document.querySelector('#settings').click();
          const advanced = document.querySelector('#advanced-toggle');
          advanced.checked = true;
          advanced.dispatchEvent(new Event('change', { bubbles: true }));
          result.controls.settings = document.querySelector('#settings-panel').classList.contains('open')
            && document.querySelector('#advanced-controls').classList.contains('open');
          document.querySelector('#close-settings').click();

          document.querySelector('#bypass').click();
          await new Promise(resolve => setTimeout(resolve, 70));
          const bypassed = window.__dubDebug();
          document.querySelector('#bypass').click();
          await new Promise(resolve => setTimeout(resolve, 70));
          const restored = window.__dubDebug();
          result.controls.bypass = bypassed.bypassed && bypassed.delayWet < .001
            && bypassed.trueBypassGain > .95 && bypassed.dryGain < .05
            && !restored.bypassed && restored.delayWet > .1
            && restored.trueBypassGain < .05 && restored.dryGain > .95;

          const echoPower = document.querySelector('.fx[data-fx="delay"] .power');
          echoPower.click();
          result.controls.fxPower = !window.__dubDebug().fxEnabled.delay;
          echoPower.click();

          document.querySelector('.pad[data-pad="kick"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          result.controls.pad = document.querySelector('#status').textContent.includes('KICK');

          const makeGamepadButtons = () => Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
          const neutralGamepad = {
            id: 'Dubstation Smoke XInput',
            index: 99,
            mapping: 'standard',
            axes: [0, 0, 0, 0],
            buttons: makeGamepadButtons()
          };
          window.__dubTest.applyXInputSnapshot(neutralGamepad, 1000);
          const activeGamepad = { ...neutralGamepad, buttons: makeGamepadButtons() };
          activeGamepad.buttons[0] = { pressed: true, value: 1 };
          activeGamepad.buttons[7] = { pressed: true, value: .74 };
          window.__dubTest.applyXInputSnapshot(activeGamepad, 1016);
          const xinputBuilt = window.__dubDebug();
          const xinputPadTriggered = document.querySelector('#status').textContent.includes('KICK');
          window.__dubTest.applyXInputSnapshot(neutralGamepad, 1032);
          const xinputDropped = window.__dubDebug();
          result.controls.xinput = xinputBuilt.xinputSupported
            && xinputBuilt.xinputConnected
            && xinputBuilt.values.build > 73
            && xinputBuilt.values.build < 75
            && xinputPadTriggered
            && xinputDropped.values.build === 0;
          window.__dubTest.disconnectXInput();

          const fakeId = window.__dubTest.addLibraryEntry({
            name: 'Smoke Test.wav',
            title: 'Smoke Test Dubplate With A Deliberately Long Embedded Track Name For The Library',
            artist: 'The Very Long Sound System Artist Credit',
            path: 'C:\\\\Music\\\\Smoke Test.wav',
            duration: 123
          });
          const scrollingTitles = window.__dubTest.refreshMarquees();
          result.controls.library = document.querySelectorAll('#library-list .library-item').length >= 1
            && document.querySelector('#library-list').textContent.includes('Smoke Test Dubplate')
            && document.querySelector('#library-list').textContent.includes('The Very Long Sound System Artist Credit')
            && scrollingTitles >= 1;
          window.__dubTest.removeLibraryEntry(fakeId);

          result.controls.deckB = document.querySelector('#deck-b-play').disabled
            && document.querySelector('#crossfader').value === '-100';
          const batchMetas = await window.dubstation.inspectAudioPaths(${JSON.stringify(smokeAudioPaths)});
          await importAudioBatch(batchMetas);
          await new Promise(resolve => setTimeout(resolve, 180));
          const liveQueue = window.__dubDebug();
          result.controls.liveQueue = liveQueue.playing
            && liveQueue.deckBTitle === 'dubstation-smoke-${process.pid}-1'
            && document.querySelector('#track-title').textContent === 'Midnight Pressure';
          result.controls.metadata = batchMetas[1].title === 'Tagged Smoke Groove'
            && batchMetas[1].artist === 'Codex Sound System'
            && document.querySelector('#library-list').textContent.includes('Tagged Smoke Groove')
            && document.querySelector('#library-list').textContent.includes('Codex Sound System');
          result.controls.batchImport = batchMetas.length === 3
            && [...document.querySelectorAll('#library-list .library-item')].filter(item => item.title.includes('dubstation-smoke-${process.pid}')).length === 3;
          const preparedBTitle = window.__dubDebug().deckBTitle;
          await loadPath(${JSON.stringify(smokeAudioPaths[1])});
          result.controls.preparedDeckProtection = window.__dubDebug().deckBTitle === preparedBTitle
            && window.__dubDebug().playing;
          stopDeckB(true);
          window.__dubTest.loadBuiltInToDeckB();
          document.querySelector('#deck-b-play').click();
          const crossfader = document.querySelector('#crossfader');
          crossfader.value = 100;
          crossfader.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 70));
          const deckBRouting = window.__dubDebug();
          result.controls.deckBRouting = deckBRouting.deckBPlaying
            && deckBRouting.deckBGain > .95 && deckBRouting.deckAGain < .05;
          document.querySelector('#deck-b-take').click();
          await new Promise(resolve => setTimeout(resolve, 180));
          result.controls.takeDeckB = document.querySelector('#track-title').textContent === 'Deck B Test Groove'
            && document.querySelector('#deck-b-play').disabled
            && document.querySelector('#crossfader').value === '-100'
            && window.__dubDebug().playing;

          document.querySelector('#record-set').click();
          await new Promise(resolve => setTimeout(resolve, 120));
          document.querySelector('.pad[data-pad="kick"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          document.querySelector('#record-set').click();
          await new Promise(resolve => setTimeout(resolve, 500));
          const recorderState = window.__dubDebug();
          result.controls.recorder = recorderState.recorderSupported
            && recorderState.recordingState === 'idle'
            && !recorderState.hasPendingRecording;
          const analyzedBeat = window.__dubTest.analyzeBuiltIn();
          result.controls.beatAnalyzer = analyzedBeat.bpm >= 80 && analyzedBeat.bpm <= 95
            && analyzedBeat.beats.length >= 8;
          result.controls.beatGrid = document.querySelectorAll('#beat-grid i').length > 0
            && Math.abs(window.__dubDebug().bpm - 86) < 2;

          document.querySelector('#stop').click();
          result.controls.stop = document.querySelector('#play').textContent === '▶';
          result.ok = Object.values(result.controls).every(Boolean);
          return result;
        })()
      `);
      console.log(`DUBSTATION_SMOKE:${JSON.stringify(result)}`);
      writeSmoke({ stage: 'complete', result });
    } catch (error) {
      console.error('DUBSTATION_SMOKE_FAILED', error);
      writeSmoke({ stage: 'failed', error: String(error) });
    } finally {
      smokeAudioPaths.forEach(filePath => {
        try { fs.unlinkSync(filePath); } catch {}
      });
      for (const extension of ['webm', 'ogg']) {
        try { fs.unlinkSync(path.join(os.tmpdir(), `dubstation-recording-${process.pid}.${extension}`)); } catch {}
      }
      app.quit();
    }
  });

  win.loadFile('index.html');
  if (process.env.DUBSTATION_SMOKE_TEST === '1') {
    setTimeout(() => {
      if (!app.isQuitting) {
        writeSmoke({ stage: 'timeout' });
        app.quit();
      }
    }, 10000);
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existingWindow = BrowserWindow.getAllWindows()[0];
    if (!existingWindow) return;
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.show();
    existingWindow.focus();
  });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
