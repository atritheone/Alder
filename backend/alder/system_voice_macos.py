"""Apple speech buffers and markers via the packaged PyObjC bridge.

This module is imported exclusively by the main thread of the native worker.
The backend and Electron never import Cocoa or share its run loop.
"""
import platform
import threading
import time


class Engine:
    def __init__(self):
        try:
            import AVFoundation as AV
            import Foundation as F
        except ImportError as exc:
            raise RuntimeError("Alder's macOS speech bridge is missing. Repair its bundled resources.") from exc
        self.AV, self.F = AV, F
        self.synth = AV.AVSpeechSynthesizer.alloc().init()

    def request(self, request):
        AV, F = self.AV, self.F
        if request["operation"] == "voices":
            return {"voices": [{"nativeId": str(v.identifier()), "name": str(v.name()),
                                "culture": str(v.language())} for v in AV.AVSpeechSynthesisVoice.speechVoices()],
                    "version": platform.mac_ver()[0]}
        voice = AV.AVSpeechSynthesisVoice.voiceWithIdentifier_(request["voice"])
        if voice is None:
            raise ValueError("This macOS voice is no longer installed. Download it in System Settings, then restart Alder.")
        if request["operation"] == "prepare":
            return {"ready": True}
        utterance = AV.AVSpeechUtterance.speechUtteranceWithString_(request["text"])
        utterance.setVoice_(voice)
        utterance.setRate_(min(AV.AVSpeechUtteranceMaximumSpeechRate, max(AV.AVSpeechUtteranceMinimumSpeechRate,
            AV.AVSpeechUtteranceDefaultSpeechRate * 2 ** (request["rate"] / 10))))
        utterance.setPitchMultiplier_(2 ** (request["pitch"] / 12))
        utterance.setVolume_(request["volume"] / 100)
        done = threading.Event()
        lock = threading.RLock()
        state = {"file": None, "format": None, "markers": [], "errors": []}
        def buffer_callback(buffer):
            with lock:
                try:
                    if buffer.frameLength() == 0:
                        done.set()
                        return
                    if state["file"] is None:
                        fmt = buffer.format()
                        widths = {AV.AVAudioPCMFormatFloat32: 4, AV.AVAudioPCMFormatFloat64: 8,
                                  AV.AVAudioPCMFormatInt16: 2, AV.AVAudioPCMFormatInt32: 4}
                        frame_bytes = widths[fmt.commonFormat()] * (int(fmt.channelCount()) if fmt.isInterleaved() else 1)
                        state["format"] = (float(fmt.sampleRate()), frame_bytes)
                        settings = {AV.AVFormatIDKey: AV.kAudioFormatLinearPCM, AV.AVSampleRateKey: fmt.sampleRate(),
                                    AV.AVNumberOfChannelsKey: fmt.channelCount(), AV.AVLinearPCMBitDepthKey: 16,
                                    AV.AVLinearPCMIsFloatKey: False, AV.AVLinearPCMIsBigEndianKey: False,
                                    AV.AVLinearPCMIsNonInterleaved: False}
                        output, error = AV.AVAudioFile.alloc().initForWriting_settings_commonFormat_interleaved_error_(
                            F.NSURL.fileURLWithPath_(request["path"]), settings, fmt.commonFormat(), fmt.isInterleaved(), None)
                        if error or output is None:
                            raise RuntimeError(str(error or "Could not open speech audio."))
                        state["file"] = output
                    ok, error = state["file"].writeFromBuffer_error_(buffer, None)
                    if not ok:
                        raise RuntimeError(str(error))
                except Exception as exc:
                    state["errors"].append(str(exc))
                    done.set()
        def marker_callback(markers):
            with lock:
                try:
                    for marker in markers:
                        if marker.mark() == AV.AVSpeechSynthesisMarkerMarkWord:
                            span = marker.textRange()
                            state["markers"].append((int(span.location), int(span.length), int(marker.byteSampleOffset())))
                except Exception as exc:
                    state["errors"].append(str(exc))
                    done.set()
        self.synth.writeUtterance_toBufferCallback_toMarkerCallback_(utterance, buffer_callback, marker_callback)
        deadline = time.monotonic() + 55
        try:
            while not done.is_set():
                if time.monotonic() > deadline:
                    raise RuntimeError("macOS speech timed out. Check the voice download in System Settings.")
                F.NSRunLoop.currentRunLoop().runUntilDate_(F.NSDate.dateWithTimeIntervalSinceNow_(.01))
            if state["errors"]:
                raise RuntimeError("macOS speech failed: " + "; ".join(state["errors"]))
            if state["format"] is None:
                raise RuntimeError("The selected macOS voice returned no audio.")
            rate, bytes_per_frame = state["format"]
            encoded = request["text"].encode("utf-16-le")
            words = [{"text": encoded[start*2:(start+length)*2].decode("utf-16-le"),
                      "start": start, "length": length, "seconds": offset / (rate * bytes_per_frame)}
                     for start, length, offset in state["markers"] if 0 <= start < start+length <= len(encoded)//2]
            return {"words": words, "timingSource": "macos-markers"}
        finally:
            self.synth.stopSpeakingAtBoundary_(AV.AVSpeechBoundaryImmediate)
            # Release AVAudioFile so its header is flushed before the reply.
            state["file"] = None
