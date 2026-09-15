import { useEffect, useRef, type RefObject } from "react";
import { SpeechTransport } from "./speechTransport";
export function useSpeechTransport(
  audio: RefObject<HTMLAudioElement | null>,
  onDisplaced: () => void,
) {
  const displaced = useRef(onDisplaced);
  displaced.current = onDisplaced;
  const transport = useRef<SpeechTransport | null>(null);
  if (!transport.current)
    transport.current = new SpeechTransport(
      () => audio.current,
      () => displaced.current(),
    );
  useEffect(() => () => transport.current?.stop(), []);
  return transport.current;
}
