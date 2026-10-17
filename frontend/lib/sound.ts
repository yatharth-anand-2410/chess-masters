/**
 * Chessmasters UI sound engine.
 *
 * Mirrors the showcase synthesizer (design-ideas/full-design-showcase.html):
 * tiny WebAudio oscillator blips for move / check / brilliant feedback, with a
 * persisted mute state so the toggle survives reloads. Sound stays off until
 * the player switches it on — audio never plays without consent.
 */

export type SoundType = "move" | "check" | "brilliant" | "click";

const STORAGE_KEY = "cm_sound_enabled";

let audioCtx: AudioContext | null = null;
let enabled: boolean | null = null; // resolved lazily from localStorage
const listeners = new Set<(enabled: boolean) => void>();

function readStored(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Sounds never play without consent: first-time visitors are muted until
    // they explicitly switch sound on.
    return raw === null ? false : raw !== "0";
  } catch {
    return false;
  }
}

export function isSoundEnabled(): boolean {
  if (enabled === null) {
    enabled = readStored();
  }
  return enabled;
}

export function subscribeSound(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable — keep the in-memory value */
    }
  }
  listeners.forEach((listener) => listener(next));
}

export function toggleSound(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) {
    playSound("click");
  }
  return next;
}

function initAudio(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

/** Play one synthesized blip. Safe to call anywhere — never throws. */
export function playSound(type: SoundType): void {
  if (!isSoundEnabled()) {
    return;
  }
  try {
    const ctx = initAudio();
    if (!ctx) {
      return;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (type === "move") {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.05);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === "check") {
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === "brilliant") {
      osc.frequency.setValueAtTime(587, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      // "click" — soft UI tick for navigation and toggles
      osc.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + 0.03);
      osc.start(now);
      osc.stop(now + 0.03);
    }
  } catch {
    /* audio is a progressive enhancement — never surface failures */
  }
}
