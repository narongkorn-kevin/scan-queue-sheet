/** @type {AudioContext | null} */
let sharedCtx = null;

function getAudioContext() {
  if (!sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

/** เรียกหลัง user gesture (เช่น กดเริ่มกล้อง) เพื่อให้เล่นเสียงบน Safari/iOS ได้ */
export function primeScanSound() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

/** เสียงสั้นเมื่อสแกนติด — ถ้าเบราว์เซอร์บล็อกจะเงียบไปเอง */
export function playScanBeep() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 920;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.14);
  } catch {
    /* ignore */
  }
}
