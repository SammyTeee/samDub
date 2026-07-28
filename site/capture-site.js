const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mobile = process.env.SAMDUB_SITE_MOBILE === '1';
app.setName('samDub Site Capture');
app.setPath('userData', path.join(os.tmpdir(), `samdub-site-${process.pid}`));
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: mobile ? 430 : 1440,
    height: mobile ? 900 : 1000,
    show: false,
    backgroundColor: '#080b0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, 'samDub', 'index.html'));
  await win.webContents.executeJavaScript(`
    Promise.all([...document.images].map(image => image.decode().catch(() => null)))
  `);
  await new Promise(resolve => setTimeout(resolve, 150));

  const prefix = mobile ? 'mobile' : 'desktop';
  const top = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, `samdub-site-${prefix}.png`), top.toPNG());

  await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)');
  await new Promise(resolve => setTimeout(resolve, 100));
  const bottom = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, `samdub-site-${prefix}-bottom.png`), bottom.toPNG());
  app.quit();
});
