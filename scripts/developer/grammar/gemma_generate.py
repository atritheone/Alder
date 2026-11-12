"""Complete-service resource/quality trials for pinned native non-thinking E4B."""
from native_generate import main


if __name__=='__main__':
    main(worker_name='gemma_worker.py',extra_sources=('gemma_generate.py','gemma_worker.py'))
