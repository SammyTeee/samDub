const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Keep runtime state beside the app so restricted Windows profiles do not fail
// while Electron tries to create its cache under AppData.
app.setPath('userData', path.join(__dirname, '.electron-data'));
app.commandLine.appendSwitch('no-sandbox');

function createWindow() {
  const smokePath = path.join(__dirname, '.smoke-result.json');
  const writeSmoke = value => {
    if (process.env.DUBSTATION_SMOKE_TEST === '1') fs.writeFileSync(smokePath, JSON.stringify(value, null, 2));
  };
  writeSmoke({ stage: 'window-starting' });
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0b0d0e',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.webContents.on('did-fail-load', (_event, code, description) => console.error('LOAD_FAILED', code, description));
  win.webContents.on('render-process-gone', (_event, details) => console.error('RENDER_GONE', details.reason));
  win.webContents.on('did-finish-load', async () => {
    if (process.env.DUBSTATION_CAPTURE === '1') {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'dubstation-preview.png'), image.toPNG());
        app.quit();
      }, 500);
      return;
    }
    if (process.env.DUBSTATION_SMOKE_TEST !== '1') return;
    writeSmoke({ stage: 'renderer-loaded' });
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const result = { controls: {} };
          document.querySelector('#play').click();
          await new Promise(resolve => setTimeout(resolve, 120));
          result.controls.play = document.querySelector('#play').textContent === 'Ⅱ';
          result.dryStart = window.__dubDebug();
          document.querySelector('[data-control="delay"].fx-range').value = 62;
          document.querySelector('[data-control="delay"].fx-range').dispatchEvent(new Event('input', { bubbles: true }));
          result.controls.delay = document.querySelector('.fx[data-fx="delay"] .readout').textContent === '62%';
          const delayKnob = document.querySelector('.knob[data-control="delay"]');
          delayKnob.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, clientX: 100, clientY: 200 }));
          window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 120, clientY: 150 }));
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 120, clientY: 150 }));
          result.controls.knob = Number(delayKnob.dataset.value) > 62;
          document.querySelector('#bypass').click();
          await new Promise(resolve => setTimeout(resolve, 100));
          result.controls.bypass = document.querySelector('#bypass').textContent === 'RESTORE FX'
            && [...document.querySelectorAll('.fx .power')].every(button => !button.classList.contains('on'));
          result.bypassed = window.__dubDebug();
          document.querySelector('#bypass').click();
          await new Promise(resolve => setTimeout(resolve, 100));
          result.controls.restore = document.querySelector('#bypass').textContent === 'BYPASS ALL'
            && [...document.querySelectorAll('.fx .power')].every(button => button.classList.contains('on'));
          result.restored = window.__dubDebug();
          result.controls.audioBypass = result.bypassed.delayWet < 0.001
            && result.bypassed.delayFeedback < 0.001
            && result.bypassed.reverbWet < 0.001;
          result.controls.audioRestore = result.restored.delayWet > 0.1
            && result.restored.delayFeedback > 0.2;
          result.controls.fxOverview = document.querySelector('#fx-summary').textContent.includes('DELAY')
            && document.querySelector('.overview-fx[data-overview-fx="delay"]').classList.contains('active');
          document.querySelector('#top-bypass').click();
          result.controls.topBypass = document.querySelector('#top-bypass').textContent === 'RESTORE PREVIOUS FX'
            && document.querySelector('#fx-summary').textContent.includes('ALL FX BYPASSED');
          document.querySelector('#top-bypass').click();
          const filterPower = document.querySelector('.fx[data-fx="filter"] .power');
          filterPower.click();
          result.controls.fxPower = !filterPower.classList.contains('on');
          filterPower.click();
          document.querySelector('.pad[data-pad="kick"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          result.controls.pad = document.querySelector('#status').textContent.includes('KICK');
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
    }, 8000);
  }
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
