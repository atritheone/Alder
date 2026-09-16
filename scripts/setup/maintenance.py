"""Installed uninstaller, independent of the original checkout."""
import argparse
import json
import sys
from pathlib import Path
from install import uninstall
from common import SetupError, installation_lock

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['uninstall'])
    parser.add_argument('--install-dir',type=Path,required=True)
    args=parser.parse_args()
    try:
        with installation_lock(args.install_dir):
            print(json.dumps(uninstall(args.install_dir),indent=2))
    except SetupError as error:
        print(error.code+': '+str(error),file=sys.stderr);sys.exit(1)
