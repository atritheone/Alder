"""Run Alder's local service: python -m alder --port 8765."""
from __future__ import annotations

import argparse
import os


def main():
    parser = argparse.ArgumentParser(description="Alder local language service")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "localhost", "::1"])
    parser.add_argument("--port", type=int, default=int(os.environ.get("ALDER_PORT", "8765")))
    parser.add_argument("--data-dir")
    parser.add_argument("--resources-dir")
    parser.add_argument("--log-level", default="info", choices=["debug", "info", "warning", "error"])
    args = parser.parse_args()
    if args.data_dir:
        os.environ["ALDER_DATA_DIR"] = args.data_dir
    if args.resources_dir:
        os.environ["ALDER_RESOURCES_DIR"] = args.resources_dir
    import uvicorn
    uvicorn.run("alder.app:app", host=args.host, port=args.port, log_level=args.log_level, access_log=False)


if __name__ == "__main__":
    main()
