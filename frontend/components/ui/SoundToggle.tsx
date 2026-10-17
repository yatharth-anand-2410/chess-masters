"use client";

import React, { useEffect, useState } from "react";
import { isSoundEnabled, playSound, subscribeSound, toggleSound } from "../../lib/sound";

type SoundToggleProps = {
  /** Show the "Sound ON / Muted" label next to the icon. */
  withLabel?: boolean;
  className?: string;
};

/**
 * Interface-sound switch shared by the top bar and the bottom dock.
 * The preference lives in localStorage (`cm_sound_enabled`) via lib/sound.
 */
export default function SoundToggle({
  withLabel = false,
  className = "",
}: SoundToggleProps) {
  // Read the persisted preference synchronously so a muted user never sees a
  // flash of "sound on" before the effect below re-syncs.
  const [on, setOn] = useState(() => isSoundEnabled());

  useEffect(() => {
    setOn(isSoundEnabled());
    return subscribeSound(setOn);
  }, []);

  return (
    <button
      type="button"
      className={`sound-toggle ${withLabel ? "" : "sound-toggle-icon"} ${className}`.trim()}
      aria-pressed={on}
      aria-label={on ? "Mute interface sounds" : "Unmute interface sounds"}
      title={on ? "Mute interface sounds" : "Unmute interface sounds"}
      onClick={() => {
        toggleSound();
        playSound("click");
      }}
    >
      <span aria-hidden="true">{on ? "🔊" : "🔇"}</span>
      {withLabel && <span>{on ? "Sound ON" : "Muted"}</span>}
    </button>
  );
}
