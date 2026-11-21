// Solara Bay — procedural sound. Everything is synthesized with WebAudio:
// an engine hum that follows speed, a two-tone siren, crash noise, punch
// thuds and mission jingles. No audio files, no network, and M mutes it all.
let ctx = null;
let master = null;
let muted = false;
let engineOsc = null;
let engineGain = null;
let sirenOsc = null;
let sirenGain = null;
let sirenTimer = 0;
let sirenHigh = false;

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 660;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

/** Call every frame: engine pitch follows speed, siren wails while wanted. */
export function updateAudio(dt, speed, wanted, driving) {
  if (!ctx) return;
  if (engineOsc && engineGain) {
    const target = driving ? 0.05 + Math.min(0.16, Math.abs(speed) / 3200) : 0;
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    engineOsc.frequency.setTargetAtTime(52 + Math.abs(speed) * 0.16, ctx.currentTime, 0.08);
  }
  if (sirenOsc && sirenGain) {
    if (wanted > 0) {
      sirenTimer -= dt;
      if (sirenTimer <= 0) {
        sirenTimer = 0.42;
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.setTargetAtTime(sirenHigh ? 880 : 660, ctx.currentTime, 0.02);
      }
      sirenGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.1);
    } else {
      sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
  }
}

function blip(freq, dur, type, vol, slideTo) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

function noiseBurst(dur, vol, cutoff) {
  if (!ctx || !master) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start();
}

export function playCrash(strength) {
  noiseBurst(0.25, Math.min(0.5, 0.15 + strength * 0.25), 900);
  blip(90, 0.2, 'sine', 0.3, 45);
}

export function playPunch() {
  noiseBurst(0.08, 0.3, 1400);
  blip(140, 0.1, 'sine', 0.25, 70);
}

export function playPickup() {
  blip(880, 0.12, 'sine', 0.22);
  blip(1320, 0.16, 'sine', 0.18);
}

export function playJingle() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => {
    setTimeout(() => blip(n, 0.22, 'triangle', 0.22), i * 110);
  });
}

export function playFail() {
  blip(330, 0.25, 'sawtooth', 0.18, 220);
  blip(220, 0.4, 'sawtooth', 0.18, 140);
}

export function playClick() {
  blip(660, 0.06, 'square', 0.12);
}

export function playHorn() {
  blip(370, 0.18, 'square', 0.12);
  blip(440, 0.18, 'square', 0.1);
}
