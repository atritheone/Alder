import { useCallback, useEffect, useRef, type RefObject } from "react";

/** One media source per element; gain above HTMLAudioElement's 100% ceiling. */
export function useNarrationGain(
  audio: RefObject<HTMLAudioElement | null>,
  volume = 2,
) {
  const graph = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const level = useRef(volume);
  level.current = volume;
  useEffect(
    () => () => {
      void graph.current?.context.close();
    },
    [],
  );
  const resume = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (!graph.current) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(element);
      const gain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -6;
      compressor.knee.value = 6;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      source.connect(gain).connect(compressor).connect(context.destination);
      graph.current = { context, gain };
    }
    graph.current.gain.gain.setTargetAtTime(
      level.current,
      graph.current.context.currentTime,
      0.025,
    );
    void graph.current.context.resume();
  }, [audio]);
  useEffect(() => {
    if (graph.current)
      graph.current.gain.gain.setTargetAtTime(
        volume,
        graph.current.context.currentTime,
        0.025,
      );
  }, [volume]);
  return resume;
}
