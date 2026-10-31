/*
 * Tiny WebAudio engine, no asset files: a slow detuned drone + a soft "tick" when the active card changes.
 * Browsers only allow audio after a user gesture, so nothing is created until enable() is called from a click.
 */
export type SiteAudio = {
  readonly on: boolean;
  enable(): void;
  disable(): void;
  tick(): void;
  levels(n: number): number[];
  dispose(): void;
};

export function createAudio(): SiteAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let bins: Uint8Array<ArrayBuffer> | null = null;
  let srcs: AudioScheduledSourceNode[] = [];
  let on = false;

  const build = () => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    analyser = ctx.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.82;
    bins = new Uint8Array(analyser.frequencyBinCount);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 6;
    lp.connect(master); master.connect(analyser); analyser.connect(ctx.destination);
    const mk = (type: OscillatorType, f: number, g: number) => {
      const o = ctx!.createOscillator(); o.type = type; o.frequency.value = f;
      const v = ctx!.createGain(); v.gain.value = g; o.connect(v); v.connect(lp); o.start(); srcs.push(o);
    };
    mk("sawtooth", 55, 0.5); mk("sawtooth", 55.45, 0.5); mk("sine", 110.2, 0.6); mk("triangle", 164.8, 0.18);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 240; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); srcs.push(lfo);
  };

  return {
    get on() { return on; },
    enable() {
      if (!ctx) build();
      void ctx!.resume();
      master!.gain.cancelScheduledValues(ctx!.currentTime);
      master!.gain.linearRampToValueAtTime(0.1, ctx!.currentTime + 1.4);
      on = true;
    },
    disable() {
      on = false;
      if (ctx && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4); }
    },
    tick() {
      if (!on || !ctx || !master) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(920, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.14);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    },
    levels(n) {
      const out = new Array<number>(n).fill(0);
      if (!on || !analyser || !bins) return out;
      analyser.getByteFrequencyData(bins);
      const per = Math.max(1, Math.floor((bins.length * 0.6) / n));
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < per; j++) s += bins[i * per + j] ?? 0; out[i] = s / per / 255; }
      return out;
    },
    dispose() {
      srcs.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
      srcs = []; void ctx?.close(); ctx = null; master = null; analyser = null; on = false;
    },
  };
}