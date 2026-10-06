/**
 * Entry point.
 *
 * The on-screen error log starts first; the app itself is then imported
 * dynamically, so even an error while its modules load is caught and shown
 * on the phone (there is no Safari Web Inspector on Windows).
 */
import { installDemoHook } from './demo/devHook';
import { installErrorCapture, logError, mountErrorLog, showBootFailure } from './ui/errorLog';

// Tells the boot script in index.html that this file loaded (it reports problems itself from here on).
document.documentElement.dataset.booting = '1';
installErrorCapture();
try {
  mountErrorLog();
} catch (err) {
  console.error(err);
}

import('./app')
  .then(({ App }) => {
    const app = new App();
    app.start();
    document.documentElement.dataset.booted = '1';
    // Dev server only: lets you poke at the app from a desktop browser's console (`pushupApp`),
    // and run the demo frame by frame (`__demo.start()`, `__demo.step(30)`, `__demo.state()`).
    if (import.meta.env.DEV) {
      (window as Window & { pushupApp?: unknown }).pushupApp = app;
      installDemoHook(app.demoHook());
    }
  })
  .catch((err: unknown) => {
    logError('startup', err);
    showBootFailure(err);
  });
