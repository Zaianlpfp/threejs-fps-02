// Procedural sound. One job: every sound the game makes, synthesized with
// WebAudio — no audio files, no network. The sim never calls this directly;
// main.js polls state for fresh events and plays them.
export function createAudio() {
  let ctx = null, master = null, muted = false;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, freq, gain, type = "lowpass", when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  function tone(freq, dur, gain, type = "sine", slideTo = 0, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }

  return {
    unlock() { if (ensure() && ctx.state === "suspended") ctx.resume(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    shot(kind, dist) {
      if (!ensure()) return;
      const v = Math.max(0.08, 1 - dist / 60);
      if (kind === "sniper") { noise(0.28, 900, 0.9 * v); tone(160, 0.18, 0.5 * v, "sine", 50); }
      else if (kind === "rifle") { noise(0.12, 1800, 0.7 * v); tone(220, 0.08, 0.35 * v, "square", 90); }
      else if (kind === "smg") { noise(0.08, 2400, 0.5 * v); tone(280, 0.05, 0.25 * v, "square", 120); }
      else { noise(0.09, 1500, 0.55 * v); tone(200, 0.06, 0.3 * v, "square", 80); }
    },
    reload() { if (!ensure()) return; tone(900, 0.05, 0.15, "square"); tone(600, 0.05, 0.15, "square", 0, 0.12); tone(1200, 0.06, 0.18, "square", 0, 0.45); },
    dryFire() { if (!ensure()) return; tone(1400, 0.03, 0.12, "square"); },
    step(run) { if (!ensure()) return; noise(0.05, run ? 700 : 420, run ? 0.10 : 0.06); },
    hit() { if (!ensure()) return; tone(2100, 0.05, 0.2, "sine"); },
    kill() { if (!ensure()) return; tone(1800, 0.06, 0.25, "sine"); tone(2400, 0.09, 0.22, "sine", 0, 0.07); },
    hurt() { if (!ensure()) return; tone(140, 0.15, 0.35, "sawtooth", 70); },
    plant() { if (!ensure()) return; tone(880, 0.09, 0.25, "sine"); tone(880, 0.09, 0.25, "sine", 0, 0.16); },
    beep() { if (!ensure()) return; tone(1180, 0.07, 0.18, "sine"); },
    explosion() {
      if (!ensure()) return;
      noise(1.1, 300, 1.0); tone(70, 0.9, 0.8, "sine", 28); noise(0.5, 3000, 0.4, "highpass");
    },
    roundWin() { if (!ensure()) return; tone(523, 0.14, 0.25); tone(659, 0.14, 0.25, "sine", 0, 0.14); tone(784, 0.3, 0.3, "sine", 0, 0.28); },
    roundLose() { if (!ensure()) return; tone(392, 0.16, 0.25); tone(330, 0.16, 0.25, "sine", 0, 0.16); tone(262, 0.34, 0.28, "sine", 0, 0.32); },
    buy() { if (!ensure()) return; tone(1046, 0.07, 0.2, "sine"); tone(1318, 0.1, 0.2, "sine", 0, 0.07); },
    denied() { if (!ensure()) return; tone(220, 0.12, 0.2, "square", 160); },
  };
}
