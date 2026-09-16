try:
    from importlib.metadata import version, PackageNotFoundError
except ImportError:
    from importlib_metadata import version, PackageNotFoundError  # For Python <3.8

try:
    __version__ = version("chatterbox-tts")
except PackageNotFoundError:
    # Alder ships this pinned source tree independently of the development UI package.
    __version__ = "0.1.7"


from .tts import ChatterboxTTS
from .vc import ChatterboxVC
from .mtl_tts import ChatterboxMultilingualTTS, SUPPORTED_LANGUAGES
