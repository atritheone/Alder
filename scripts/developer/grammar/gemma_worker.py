"""Pinned Gemma 4 E4B research adapter; production instructions/guards unchanged."""
import importlib.util
from pathlib import Path

# The production supervisor launches this file with Python -I, which excludes
# its directory from sys.path. Load the verified sibling explicitly.
_spec=importlib.util.spec_from_file_location('alder_gemma_native_worker',Path(__file__).with_name('native_worker.py'))
_native=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_native)
main=_native.main

TEMPLATE_SHA256='0a2c8073c878ab1da004bee933a998606537bbb62016310352c7285c3f01c5b5'


if __name__=='__main__':
    main(gemma_nonthinking=True,template_sha256=TEMPLATE_SHA256)
