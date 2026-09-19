"""eSpeak NG retrieval API. Loaded only in the Linux speech worker."""
import ctypes as C
import ctypes.util
import os
from pathlib import Path
import hashlib
import wave


class EventId(C.Union):
    _fields_ = [("number", C.c_int), ("name", C.c_char_p), ("string", C.c_char * 8)]


class Event(C.Structure):
    _fields_ = [("type", C.c_int), ("unique_identifier", C.c_uint), ("text_position", C.c_int),
                ("length", C.c_int), ("audio_position", C.c_int), ("sample", C.c_int),
                ("user_data", C.c_void_p), ("id", EventId)]


class Voice(C.Structure):
    _fields_ = [("name", C.c_char_p), ("languages", C.c_void_p), ("identifier", C.c_char_p),
                ("gender", C.c_ubyte), ("age", C.c_ubyte), ("variant", C.c_ubyte),
                ("xx1", C.c_ubyte), ("score", C.c_int), ("spare", C.c_void_p)]


class Engine:
    def __init__(self):
        library = os.environ.get("ALDER_ESPEAK_LIBRARY") or ctypes.util.find_library("espeak-ng")
        if not library:
            raise RuntimeError("eSpeak NG is not installed. Install your distribution's eSpeak NG library and voice data, then restart Alder.")
        self.lib = C.CDLL(library)
        self.lib.espeak_Initialize.argtypes = [C.c_int, C.c_int, C.c_char_p, C.c_int]
        self.lib.espeak_Initialize.restype = C.c_int
        data = os.environ.get("ALDER_ESPEAK_DATA_DIR")
        # API expects the directory containing espeak-ng-data, not the data folder.
        self.rate = self.lib.espeak_Initialize(2, 0, os.fsencode(data) if data else None, 0x8000)
        if self.rate <= 0:
            raise RuntimeError("eSpeak NG voice data is missing or incompatible.")
        self.lib.espeak_ListVoices.argtypes = [C.c_void_p]
        self.lib.espeak_ListVoices.restype = C.POINTER(C.POINTER(Voice))
        self.lib.espeak_SetVoiceByName.argtypes = [C.c_char_p]
        self.lib.espeak_Info.argtypes = [C.POINTER(C.c_char_p)]
        self.lib.espeak_Info.restype = C.c_char_p
        self.lib.espeak_SetParameter.argtypes = [C.c_int, C.c_int, C.c_int]
        self.lib.espeak_Synth.argtypes = [C.c_void_p, C.c_size_t, C.c_uint, C.c_int, C.c_uint,
                                        C.c_uint, C.POINTER(C.c_uint), C.c_void_p]
        self.callback_type = C.CFUNCTYPE(C.c_int, C.POINTER(C.c_short), C.c_int, C.POINTER(Event))
        self.lib.espeak_SetSynthCallback.argtypes = [self.callback_type]

    def request(self, request):
        if request["operation"] == "voices":
            voices = []
            records = self.lib.espeak_ListVoices(None)
            index = 0
            while records[index]:
                voice = records[index].contents
                # The first byte is language priority, followed by the language.
                language = C.string_at(voice.languages + 1).decode() if voice.languages else ""
                voices.append({"nativeId": voice.identifier.decode(), "name": voice.name.decode(), "culture": language})
                index += 1
            data_path = C.c_char_p()
            version = self.lib.espeak_Info(C.byref(data_path)).decode()
            # Voice data can be updated independently of the shared library.
            fingerprint = hashlib.sha256()
            if data_path.value:
                root = Path(os.fsdecode(data_path.value))
                for path in sorted(root.rglob("*")):
                    if path.is_file():
                        stat = path.stat()
                        fingerprint.update(f"{path.relative_to(root)}:{stat.st_size}:{stat.st_mtime_ns}".encode())
            return {"voices": voices, "version": version + ":" + fingerprint.hexdigest()}
        if self.lib.espeak_SetVoiceByName(request["voice"].encode()):
            raise ValueError("This eSpeak NG voice is no longer installed. Restart Alder.")
        if request["operation"] == "prepare":
            return {"ready": True}
        text, chunks, words, errors = request["text"], [], [], []
        # Fresh absolute parameters prevent controls leaking between requests.
        for parameter, value in ((1, round(175 * 2 ** (request["rate"] / 10))),
                                 (2, request["volume"]), (3, 50 + request["pitch"] * 5)):
            if self.lib.espeak_SetParameter(parameter, value, 0):
                raise RuntimeError("eSpeak NG rejected the voice controls.")
        def receive(samples, count, events):
            try:
                if samples and count:
                    chunks.append(C.string_at(samples, count * 2))
                i = 0
                while events and events[i].type:
                    event = events[i]
                    if event.type == 1:
                        start = max(0, event.text_position - 1)
                        token = text[start:start + event.length]
                        words.append({"text": token, "start": len(text[:start].encode("utf-16-le")) // 2,
                                      "length": len(token.encode("utf-16-le")) // 2, "seconds": event.audio_position / 1000})
                    i += 1
                return 0
            except Exception as exc:
                errors.append(str(exc))
                return 1
        callback = self.callback_type(receive)
        self.lib.espeak_SetSynthCallback(callback)
        encoded = text.encode("utf-8") + b"\0"
        if self.lib.espeak_Synth(encoded, len(encoded), 0, 1, 0, 1, None, None) or errors:
            raise RuntimeError("eSpeak NG synthesis failed: " + "; ".join(errors))
        with wave.open(request["path"], "wb") as output:
            output.setparams((1, 2, self.rate, 0, "NONE", "not compressed"))
            output.writeframes(b"".join(chunks))
        return {"words": words, "timingSource": "espeak-events"}
