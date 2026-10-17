"use client";

import React, { useEffect, useState } from "react";
import { isSoundEnabled, playSound, subscribeSound, toggleSound } from "../../lib/sound";

type SoundToggleProps = {
  /** Show the "Sound ON / Muted" label next to the icon. */
  withLabel?: boolean;
  className?: string;
};

/**
 * Interface-sound switch used by the top bar and the mobile drawer.
 * The preference lives in localStorage (`cm_sound_enabled`) via lib/sound.
 */
export default function SoundToggle({
  withLabel = false,
  className = "",
}: SoundToggleProps) {
  // SSR determinism: render the server default (muted) on the first pass and
  // sync the persisted preference after mount. Reading localStorage during
  // render made the server HTML disagree with sound-on clients and forced a
  // client-side tree regeneration on every load.
  const [on, setOn] = useState(false);

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
